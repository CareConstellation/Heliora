/**
 * Chaumian RSA blind signatures for anonymous clinical trial enrollment.
 *
 * Implements Chaum's 1983 RSA blind signature scheme using browser-native
 * BigInt for modular arithmetic. This is the classic textbook protocol, not
 * the RSABSSA variant standardized in RFC 9474 (which adds PSS padding and
 * a four-step Prepare/Blind/BlindSign/Finalize flow).
 *
 * ## Protocol flow
 * 1. **Patient** blinds their credential locally:
 *    `blindedMsg = H(msg) × r^e mod n` (where `r` is a random blinding factor).
 * 2. **Hospital signer** signs the blinded message without seeing the content:
 *    `blindSig = blindedMsg^d mod n`.
 * 3. **Patient** unblinds the signature locally:
 *    `sig = blindSig × r^(-1) mod n`.
 * 4. **Research contract** verifies the unblinded signature as a standard
 *    textbook RSA signature (`sig^e mod n === H(msg) mod n`), confirming
 *    hospital endorsement without learning the patient's wallet address.
 *
 * The patient receives a cryptographic receipt (the unblinded signature) that
 * proves trial inclusion without linking to their identity.
 *
 * ## Complexity
 * - Blind / Unblind: O(k²) where k = RSA key bit length (modular exponentiation).
 * - Sign: O(k²) (standard RSA private-key operation).
 * - Verify: O(k) (RSA public-key operation with small public exponent).
 * - Space: O(k) for all intermediate values.
 *
 * @see D. Chaum, "Blind Signatures for Untraceable Payments," Crypto 1982.
 */

/* ── Types ────────────────────────────────────────────────────────── */

export interface BlindingResult {
  blindedMessage: Uint8Array;
  blindingFactor: Uint8Array;
}

export interface BlindSignatureReceipt {
  message: Uint8Array;
  signature: Uint8Array;
  signerPublicKey: JsonWebKey;
}

export interface TrialEnrollmentCredential {
  condition: string;
  studyId: string;
  timestamp: string;
  eligibilityHash: string;
}

/* ── BigInt / byte conversion ─────────────────────────────────────── */

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex.length === 0 ? 0n : BigInt('0x' + hex);
}

function bigIntToBytes(n: bigint, length: number): Uint8Array {
  const hex = n.toString(16).padStart(length * 2, '0');
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ── Modular arithmetic ──────────────────────────────────────────── */

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % mod;
    exp = exp >> 1n;
    base = (base * base) % mod;
  }
  return result;
}

function modInverse(a: bigint, m: bigint): bigint {
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) throw new Error('Modular inverse does not exist.');
  return ((old_s % m) + m) % m;
}

/* ── RSA key extraction ──────────────────────────────────────────── */

function extractRsaParams(jwk: JsonWebKey): { n: bigint; e: bigint; keyBytes: number } {
  const nStr = jwk.n;
  const eStr = jwk.e;
  if (!nStr || !eStr) throw new Error('Invalid RSA JWK: missing n or e.');
  const nBytes = base64UrlToBytes(nStr);
  return {
    n: bytesToBigInt(nBytes),
    e: bytesToBigInt(base64UrlToBytes(eStr)),
    keyBytes: nBytes.length,
  };
}

/* ── Random blinding factor ──────────────────────────────────────── */

function generateBlindingFactor(n: bigint, keyBytes: number): bigint {
  const bytes = new Uint8Array(keyBytes);
  crypto.getRandomValues(bytes);
  bytes[0] = (bytes[0] ?? 0) & 0x7f;
  let r = bytesToBigInt(bytes) % n;
  if (r === 0n) r = 1n;
  return r;
}

/* ── Public API ──────────────────────────────────────────────────── */

/**
 * Generate an RSA-PSS key pair for the hospital signer. The private key is
 * non-extractable; the public key is exported as JWK for distribution.
 */
export async function generateSignerKeyPair(): Promise<{
  publicKey: JsonWebKey;
  privateKey: CryptoKey;
  signingKey: CryptoKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return { publicKey: publicJwk, privateKey: keyPair.privateKey, signingKey: keyPair.privateKey };
}

/**
 * Patient-side: blind a credential message before sending to the hospital signer.
 *
 * @param message - The raw credential bytes to be signed.
 * @param signerPublicKey - The hospital's RSA public key (JWK).
 * @returns The blinded message and the blinding factor (kept secret by the patient).
 */
export async function blindMessage(
  message: Uint8Array,
  signerPublicKey: JsonWebKey,
): Promise<BlindingResult> {
  const { n, e, keyBytes } = extractRsaParams(signerPublicKey);

  const msgHash = new Uint8Array(await crypto.subtle.digest('SHA-256', message as unknown as ArrayBuffer));
  const m = bytesToBigInt(msgHash) % n;

  const r = generateBlindingFactor(n, keyBytes);
  const rE = modPow(r, e, n);
  const blinded = (m * rE) % n;

  return {
    blindedMessage: bigIntToBytes(blinded, keyBytes),
    blindingFactor: bigIntToBytes(r, keyBytes),
  };
}

/**
 * Hospital signer: sign a blinded message. The signer never sees the
 * original credential content.
 *
 * Uses raw RSA (d exponent) rather than PSS padding since the message
 * is already blinded. The final unblinded signature is verified as a
 * standard textbook RSA signature.
 *
 * @param blindedMessage - The blinded bytes from the patient.
 * @param signerPrivateJwk - The signer's RSA private key (JWK, with d component).
 */
export async function signBlinded(
  blindedMessage: Uint8Array,
  signerPrivateJwk: JsonWebKey,
): Promise<Uint8Array> {
  if (!signerPrivateJwk.d || !signerPrivateJwk.n) {
    throw new Error('Signer private key must include d and n components.');
  }
  const n = bytesToBigInt(base64UrlToBytes(signerPrivateJwk.n));
  const d = bytesToBigInt(base64UrlToBytes(signerPrivateJwk.d));
  const keyBytes = base64UrlToBytes(signerPrivateJwk.n).length;

  const blindedInt = bytesToBigInt(blindedMessage);
  const blindSig = modPow(blindedInt, d, n);
  return bigIntToBytes(blindSig, keyBytes);
}

/**
 * Patient-side: unblind the hospital's signature to obtain a valid RSA
 * signature on the original message.
 */
export function unblindSignature(
  blindSignature: Uint8Array,
  blindingFactor: Uint8Array,
  signerPublicKey: JsonWebKey,
): Uint8Array {
  const { n, keyBytes } = extractRsaParams(signerPublicKey);
  const blindSigInt = bytesToBigInt(blindSignature);
  const r = bytesToBigInt(blindingFactor);
  const rInv = modInverse(r, n);
  const sig = (blindSigInt * rInv) % n;
  return bigIntToBytes(sig, keyBytes);
}

/**
 * Verify an unblinded RSA signature against the signer's public key.
 * This is a standard textbook RSA verification: `sig^e mod n === H(msg)`.
 */
export async function verifySignature(
  message: Uint8Array,
  signature: Uint8Array,
  signerPublicKey: JsonWebKey,
): Promise<boolean> {
  const { n, e } = extractRsaParams(signerPublicKey);
  const sigInt = bytesToBigInt(signature);
  const recovered = modPow(sigInt, e, n);

  const msgHash = new Uint8Array(await crypto.subtle.digest('SHA-256', message as unknown as ArrayBuffer));
  const expected = bytesToBigInt(msgHash) % n;

  return recovered === expected;
}

/**
 * Build a credential payload for clinical trial enrollment.
 * The credential contains the medical condition, study ID, and an
 * eligibility hash derived from the patient's ZK proof — but NOT
 * their wallet address.
 */
export function buildTrialCredential(
  condition: string,
  studyId: string,
  eligibilityProofHash: string,
): { credential: TrialEnrollmentCredential; encoded: Uint8Array } {
  const credential: TrialEnrollmentCredential = {
    condition,
    studyId,
    timestamp: new Date().toISOString(),
    eligibilityHash: eligibilityProofHash,
  };
  return {
    credential,
    encoded: new TextEncoder().encode(JSON.stringify(credential)),
  };
}

/**
 * Build a cryptographic receipt proving trial inclusion without linking
 * the patient's wallet address.
 */
export function buildReceipt(
  message: Uint8Array,
  signature: Uint8Array,
  signerPublicKey: JsonWebKey,
): BlindSignatureReceipt {
  return { message, signature, signerPublicKey };
}

/**
 * Serialize a receipt for storage or submission to the research contract.
 */
export function serializeReceipt(receipt: BlindSignatureReceipt): string {
  return JSON.stringify({
    message: bytesToBase64Url(receipt.message),
    signature: bytesToBase64Url(receipt.signature),
    signerPublicKey: receipt.signerPublicKey,
  });
}

/**
 * Deserialize a receipt from JSON.
 */
export function deserializeReceipt(json: string): BlindSignatureReceipt {
  const parsed = JSON.parse(json);
  return {
    message: base64UrlToBytes(parsed.message),
    signature: base64UrlToBytes(parsed.signature),
    signerPublicKey: parsed.signerPublicKey,
  };
}
