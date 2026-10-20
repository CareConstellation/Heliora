/**
 * Client-side AES-256-GCM encryption using the Web Crypto API.
 * Raw file bytes are encrypted before upload; only the content hash
 * and an encrypted metadata pointer are stored on-chain.
 *
 * ## Algorithm
 * AES-256-GCM (authenticated encryption): a single `crypto.subtle.encrypt` call
 * produces ciphertext with an integrity tag, so tampering with the encrypted
 * blob is detectable on decryption rather than silently accepted.
 *
 * ## Key management
 * - No password-based key derivation (e.g. PBKDF2/Argon2) is used. Each call to
 *   {@link encryptFile} generates a fresh random 256-bit `CryptoKey` via
 *   `crypto.subtle.generateKey`, scoped to a single file.
 * - The key is generated as `extractable: true` so it can be exported and sent
 *   to the backend (see {@link exportKey}). As currently wired up in
 *   `MedicalRecordUpload.tsx`, the exported key is uploaded to the server in the
 *   same request as the encrypted file — i.e. the server receives both the
 *   ciphertext and the key needed to decrypt it. This scheme protects the file
 *   in transit/at rest against anyone who does *not* have server access, but it
 *   does **not** protect confidentiality from the backend/storage layer itself.
 *   Any redesign to keep the server from ever seeing plaintext-equivalent
 *   access would need out-of-band key custody (e.g. per-user/per-share keys
 *   not transmitted alongside the ciphertext).
 *
 * ## IV handling
 * A new 96-bit (12-byte) IV is generated per encryption via
 * `crypto.getRandomValues`. 96 bits is the size recommended for AES-GCM.
 * Reusing an IV with the same key would break GCM's confidentiality/integrity
 * guarantees, but since {@link encryptFile} always pairs a fresh IV with a
 * freshly generated key, reuse cannot occur here.
 *
 * ## Integrity hash
 * {@link hashBuffer} computes a SHA-256 hex digest of the *ciphertext*, used as
 * a content hash (e.g. for on-chain reference/dedup), not as a substitute for
 * GCM's built-in authentication tag.
 */

/**
 * Encrypt a file's contents with a freshly generated AES-256-GCM key.
 * @param file - File to encrypt.
 * @returns The ciphertext (`encryptedBuffer`), the random 96-bit IV used, and
 *   the extractable `CryptoKey` (export via {@link exportKey} if it needs to
 *   leave the Web Crypto API, e.g. for upload).
 */
export async function encryptFile(file: File): Promise<{
  encryptedBuffer: ArrayBuffer;
  iv: Uint8Array;
  key: CryptoKey;
}> {
  // extractable: true — required so the key can be exported/uploaded (see module docs above)
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);

  // 96-bit IV, the size recommended for AES-GCM; safe to reuse only because a new key
  // is generated per call, so no (key, iv) pair is ever repeated.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const fileBuffer = await file.arrayBuffer();

  const encryptedBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, fileBuffer);

  return { encryptedBuffer, iv, key };
}

/**
 * Export a `CryptoKey` to a raw byte buffer so it can be transmitted or stored
 * outside the Web Crypto API.
 * @param key - An extractable AES-GCM `CryptoKey`, e.g. from {@link encryptFile}.
 * @returns Raw key bytes.
 */
export async function exportKey(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey('raw', key);
}

/**
 * Compute a SHA-256 hex digest of a buffer, used as a content-integrity hash
 * (e.g. for the on-chain record pointer). This is independent of AES-GCM's own
 * authentication tag, which already guards ciphertext integrity on decrypt.
 * @param buffer - Bytes to hash (typically the encrypted file buffer).
 * @returns Lowercase hex-encoded SHA-256 digest.
 */
export async function hashBuffer(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Decrypt an {@link encryptFile} ciphertext.
 * @param ciphertext - AES-256-GCM ciphertext with its authentication tag.
 * @param rawKey - The file's 32-byte raw key.
 * @param iv - The 12-byte IV used at encryption.
 * @returns The plaintext; rejects if the ciphertext or tag was altered.
 */
export async function decryptFile(
  ciphertext: ArrayBuffer,
  rawKey: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
}

/* ── Password-derived recovery key backup ───────────────────────────── */

/** OWASP Password Storage Cheat Sheet: PBKDF2-HMAC-SHA256 with 600,000 iterations (FIPS-140 compliant). */
export const RECOVERY_PBKDF2_ITERATIONS = 600_000;
/** Upper bound accepted when restoring, so a tampered file cannot stall the browser. */
const MAX_RECOVERY_PBKDF2_ITERATIONS = 10_000_000;
const RECOVERY_SALT_BYTES = 32;
const RECOVERY_KEY_BYTES = 32;
export const RECOVERY_BACKUP_EXTENSION = '.reliora-backup';

/** Contents of a `.reliora-backup` file. Every field except `ciphertext` is authenticated as AES-GCM additional data. */
export interface RecoveryBackup {
  format: 'reliora-backup';
  version: 1;
  account: string;
  createdAt: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  /** Base64 AES-256-GCM ciphertext of the recovery key (32 bytes + 16-byte tag). */
  ciphertext: string;
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

/** Generates a high-entropy 256-bit recovery key. */
export function generateRecoveryKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(RECOVERY_KEY_BYTES));
}

/** PBKDF2-HMAC-SHA256 → non-extractable AES-256-GCM key. The passphrase is NFKD-normalised, as BIP-39 requires. */
async function deriveBackupKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase.normalize('NFKD')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Canonical encoding of the backup header, bound to the ciphertext as AES-GCM additional data. */
function backupAad({
  format,
  version,
  account,
  createdAt,
  kdf,
  cipher,
}: RecoveryBackup): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify([
      format,
      version,
      account,
      createdAt,
      kdf.name,
      kdf.hash,
      kdf.iterations,
      kdf.salt,
      cipher.name,
      cipher.iv,
    ]),
  );
}

/**
 * Encrypts `recoveryKey` under a key derived from `passphrase`.
 * Time is dominated by the 600,000 PBKDF2 iterations (O(iterations)); space O(1).
 */
export async function createRecoveryBackup(
  recoveryKey: Uint8Array<ArrayBuffer>,
  passphrase: string,
  account: string,
): Promise<RecoveryBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(RECOVERY_SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const backup: RecoveryBackup = {
    format: 'reliora-backup',
    version: 1,
    account,
    createdAt: new Date().toISOString(),
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: RECOVERY_PBKDF2_ITERATIONS,
      salt: toBase64(salt),
    },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    ciphertext: '',
  };
  const key = await deriveBackupKey(passphrase, salt, RECOVERY_PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: backupAad(backup) },
    key,
    recoveryKey,
  );
  return { ...backup, ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

/**
 * Decrypts a `.reliora-backup` file and returns the recovery key. Rejects files
 * that are malformed, below the OWASP iteration minimum, or tampered with. A
 * wrong passphrase fails AES-GCM authentication.
 */
export async function restoreRecoveryKey(
  fileContents: string,
  passphrase: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const backup = JSON.parse(fileContents) as RecoveryBackup;
  const { kdf, cipher } = backup;
  if (
    backup.format !== 'reliora-backup' ||
    backup.version !== 1 ||
    kdf?.name !== 'PBKDF2' ||
    kdf.hash !== 'SHA-256' ||
    !Number.isSafeInteger(kdf.iterations) ||
    kdf.iterations < RECOVERY_PBKDF2_ITERATIONS ||
    kdf.iterations > MAX_RECOVERY_PBKDF2_ITERATIONS ||
    cipher?.name !== 'AES-GCM'
  ) {
    throw new Error('This is not a valid Heliora recovery backup.');
  }
  const key = await deriveBackupKey(passphrase, fromBase64(kdf.salt), kdf.iterations);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(cipher.iv), additionalData: backupAad(backup) },
      key,
      fromBase64(backup.ciphertext),
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new Error('Incorrect recovery passphrase, or the backup file has been modified.');
  }
}
