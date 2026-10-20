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
