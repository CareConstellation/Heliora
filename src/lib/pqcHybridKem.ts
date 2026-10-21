/**
 * Post-quantum ready hybrid key exchange: ML-KEM-768 + X25519.
 *
 * Conforming to NIST SP 800-227 §5 (multi-algorithm KEMs), this module
 * implements a hybrid KEM that combines:
 *   1. ML-KEM-768 (FIPS 203) — lattice-based, quantum-resistant.
 *   2. X25519 (RFC 7748)    — classical ECDH, battle-tested.
 *
 * The combined shared secret is derived per SP 800-227 guidance: the two
 * raw shared secrets are concatenated and passed through HKDF-SHA-256 to
 * produce the final key material. This ensures the output is
 * indistinguishable from random even if one primitive is broken.
 *
 * ## Feature flag
 * Guarded behind `NEXT_PUBLIC_PQC_ENABLED`. When the flag is absent or
 * `"false"`, all exports throw at runtime so no PQC code path can be
 * entered accidentally.
 *
 * ## Dependencies
 * - `mlkem` (npm, v2.x) for ML-KEM-768 via the `createMlKem768()` factory
 *   (FIPS 203 compliant, browser-compatible).
 * - Web Crypto API for X25519 (available in modern browsers via the
 *   "X25519" named curve on ECDH).
 *
 * ## Complexity
 * - Key generation: O(1) — constant-time lattice + curve operations.
 * - Encapsulation:  O(1) — one ML-KEM encap + one X25519 DH + one HKDF.
 * - Decapsulation:  O(1) — one ML-KEM decap + one X25519 DH + one HKDF.
 * - Space: O(1) — fixed-size keys and ciphertexts.
 *   ML-KEM-768: 1184-byte encapsulation key, 2400-byte decapsulation key,
 *               1088-byte ciphertext, 32-byte shared secret.
 *   X25519:     32-byte public key, 32-byte private key, 32-byte shared secret.
 *   Combined ciphertext: 1088 + 32 = 1120 bytes.
 */

const PQC_ENABLED = process.env.NEXT_PUBLIC_PQC_ENABLED === 'true';
const HKDF_INFO = new TextEncoder().encode('heliora/pqc-hybrid/v1/mlkem768-x25519');

function assertEnabled(): void {
  if (!PQC_ENABLED) {
    throw new Error('PQC hybrid KEM is disabled. Set NEXT_PUBLIC_PQC_ENABLED=true to enable.');
  }
}

/* ── Key types ────────────────────────────────────────────────────── */

export interface HybridKeyPair {
  publicKey: HybridPublicKey;
  privateKey: HybridPrivateKey;
}

export interface HybridPublicKey {
  mlkem: Uint8Array;
  x25519: Uint8Array;
}

export interface HybridPrivateKey {
  mlkem: Uint8Array;
  x25519: CryptoKey;
}

export interface HybridCiphertext {
  mlkem: Uint8Array;
  x25519: Uint8Array;
}

export interface SerializedHybridPublicKey {
  mlkem: string;
  x25519: string;
}

export interface SerializedHybridCiphertext {
  mlkem: string;
  x25519: string;
}

/* ── Encoding helpers ─────────────────────────────────────────────── */

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ── HKDF-SHA-256 combiner (SP 800-227 §5) ───────────────────────── */

async function hkdfCombine(
  mlkemSecret: Uint8Array,
  x25519Secret: Uint8Array,
): Promise<Uint8Array> {
  const ikm = new Uint8Array(mlkemSecret.length + x25519Secret.length);
  ikm.set(mlkemSecret, 0);
  ikm.set(x25519Secret, mlkemSecret.length);

  const hkdfKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: HKDF_INFO },
    hkdfKey,
    256,
  );
  return new Uint8Array(derived);
}

/* ── X25519 helpers ───────────────────────────────────────────────── */

const X25519_ALGO = { name: 'X25519' } as Algorithm;

async function generateX25519KeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    X25519_ALGO as unknown as EcKeyGenParams,
    false,
    ['deriveBits'],
  ) as Promise<CryptoKeyPair>;
}

async function x25519DH(privateKey: CryptoKey, publicKeyRaw: Uint8Array): Promise<Uint8Array> {
  const importedPub = await crypto.subtle.importKey(
    'raw',
    publicKeyRaw as unknown as ArrayBuffer,
    X25519_ALGO as unknown as EcKeyImportParams,
    true,
    [],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: importedPub } as unknown as EcdhKeyDeriveParams,
    privateKey,
    256,
  );
  return new Uint8Array(bits);
}

async function exportX25519Public(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

/* ── ML-KEM-768 dynamic import ────────────────────────────────────── */

async function getMlKem() {
  const { createMlKem768 } = await import('mlkem');
  return createMlKem768();
}

/* ── Public API ──────────────────────────────────────────────────── */

/**
 * Generate a hybrid ML-KEM-768 + X25519 key pair.
 */
export async function generateHybridKeyPair(): Promise<HybridKeyPair> {
  assertEnabled();

  const [mlkem, x25519Pair] = await Promise.all([getMlKem(), generateX25519KeyPair()]);

  const [mlkemEncapKey, mlkemDecapKey] = mlkem.generateKeyPair();
  const x25519Pub = await exportX25519Public(x25519Pair.publicKey);

  return {
    publicKey: { mlkem: mlkemEncapKey, x25519: x25519Pub },
    privateKey: { mlkem: mlkemDecapKey, x25519: x25519Pair.privateKey },
  };
}

/**
 * Encapsulate: generate a shared secret and ciphertext for a recipient's
 * hybrid public key.
 *
 * Returns the combined shared secret (32 bytes) and hybrid ciphertext.
 */
export async function encapsulate(
  recipientPublicKey: HybridPublicKey,
): Promise<{ sharedSecret: Uint8Array; ciphertext: HybridCiphertext }> {
  assertEnabled();

  const mlkem = await getMlKem();
  const [mlkemCt, mlkemSs] = mlkem.encap(recipientPublicKey.mlkem);

  const ephemeralX25519 = await generateX25519KeyPair();
  const x25519Ss = await x25519DH(ephemeralX25519.privateKey, recipientPublicKey.x25519);
  const x25519Pub = await exportX25519Public(ephemeralX25519.publicKey);

  const sharedSecret = await hkdfCombine(new Uint8Array(mlkemSs), x25519Ss);

  return {
    sharedSecret,
    ciphertext: { mlkem: new Uint8Array(mlkemCt), x25519: x25519Pub },
  };
}

/**
 * Decapsulate: recover the shared secret from a hybrid ciphertext using
 * the recipient's private key.
 */
export async function decapsulate(
  ciphertext: HybridCiphertext,
  privateKey: HybridPrivateKey,
): Promise<Uint8Array> {
  assertEnabled();

  const mlkem = await getMlKem();
  const mlkemSs = mlkem.decap(ciphertext.mlkem, privateKey.mlkem);
  const x25519Ss = await x25519DH(privateKey.x25519, ciphertext.x25519);

  return hkdfCombine(new Uint8Array(mlkemSs), x25519Ss);
}

/* ── Serialization ────────────────────────────────────────────────── */

export function serializePublicKey(pk: HybridPublicKey): SerializedHybridPublicKey {
  return { mlkem: toBase64(pk.mlkem), x25519: toBase64(pk.x25519) };
}

export function deserializePublicKey(spk: SerializedHybridPublicKey): HybridPublicKey {
  return { mlkem: fromBase64(spk.mlkem), x25519: fromBase64(spk.x25519) };
}

export function serializeCiphertext(ct: HybridCiphertext): SerializedHybridCiphertext {
  return { mlkem: toBase64(ct.mlkem), x25519: toBase64(ct.x25519) };
}

export function deserializeCiphertext(sct: SerializedHybridCiphertext): HybridCiphertext {
  return { mlkem: fromBase64(sct.mlkem), x25519: fromBase64(sct.x25519) };
}

/**
 * Test utility: measure encapsulation latency and ciphertext size overhead
 * compared to standard ECDH P-256.
 */
export async function benchmarkOverhead(): Promise<{
  hybridEncapMs: number;
  hybridCtBytes: number;
  ecdhEncapMs: number;
  ecdhCtBytes: number;
}> {
  assertEnabled();

  const hybridKp = await generateHybridKeyPair();
  const t0 = performance.now();
  const { ciphertext } = await encapsulate(hybridKp.publicKey);
  const hybridEncapMs = performance.now() - t0;
  const hybridCtBytes = ciphertext.mlkem.length + ciphertext.x25519.length;

  const ecdhKp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const t1 = performance.now();
  await crypto.subtle.deriveBits(
    { name: 'ECDH', public: ecdhKp.publicKey },
    ephemeral.privateKey,
    256,
  );
  const ecdhEncapMs = performance.now() - t1;
  const ecdhPub = await crypto.subtle.exportKey('raw', ephemeral.publicKey);
  const ecdhCtBytes = ecdhPub.byteLength;

  return { hybridEncapMs, hybridCtBytes, ecdhEncapMs, ecdhCtBytes };
}
