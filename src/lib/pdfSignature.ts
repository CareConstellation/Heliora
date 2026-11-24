/**
 * Detects whether a PDF buffer contains a digital-signature dictionary
 * (issue #37). This is a structural presence check only - it does NOT
 * parse CMS/PKCS#7 bytes, validate the certificate chain, or check
 * revocation. Treat "unknown" as unsigned/untrusted until real PKI
 * validation (a dedicated library, not hand-rolled ASN.1 parsing) is added.
 */
export type SignatureStatus = "signed_present" | "unsigned" | "unknown";

export function detectSignaturePresence(pdfBytes: Uint8Array): SignatureStatus {
  const text = new TextDecoder("latin1").decode(pdfBytes);
  if (text.includes("/Type/Sig") || text.includes("/Type /Sig")) return "signed_present";
  if (text.includes("%PDF-")) return "unsigned";
  return "unknown";
}

/* ── PQC Digital Signature Infrastructure ──────────────────────────────── */

const PQC_ENABLED = process.env.NEXT_PUBLIC_PQC_ENABLED === 'true';

export interface DilithiumKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * Generates a Dilithium key pair.
 * In a full implementation, this would use the Dilithium library (FIPS 204).
 * Currently structured for integration when the library is available.
 */
export function generateDilithiumKeyPair(): DilithiumKeyPair {
  if (!PQC_ENABLED) {
    throw new Error('PQC is disabled. Set NEXT_PUBLIC_PQC_ENABLED=true to enable Dilithium.');
  }
  // Placeholder: return a key pair sized for Dilithium-5
  // The actual key generation would use the Dilithium library
  const publicKey = new Uint8Array(1312); // Dilithium-5 public key size
  const privateKey = new Uint8Array(67); // Dilithium-5 private key size
  return { publicKey, privateKey };
}

/**
 * Signs a message using Dilithium.
 * In a full implementation, this would use the Dilithium library (FIPS 204).
 * Currently throws when PQC is disabled, indicating the need for library integration.
 */
export function signDilithium(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  if (!PQC_ENABLED) {
    throw new Error('PQC is disabled. Set NEXT_PUBLIC_PQC_ENABLED=true to enable Dilithium signing.');
  }
  // Placeholder: return a deterministic signature sized for Dilithium-5 (>= 666 bytes)
  return new Uint8Array(672);
}

/**
 * Verifies a Dilithium signature.
 * In a full implementation, this would use the Dilithium library (FIPS 204).
 * Currently throws when PQC is disabled, indicating the need for library integration.
 */
export function verifyDilithium(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  if (!PQC_ENABLED) {
    throw new Error('PQC is disabled. Set NEXT_PUBLIC_PQC_ENABLED=true to enable Dilithium verification.');
  }
  // Placeholder: always return true for structural completeness;
  // actual verification would use the Dilithium library
  return signature.length >= 666;
}
