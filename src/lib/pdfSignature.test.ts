import { verifyPdfSignature } from './pdfSignature';

describe('verifyPdfSignature (#252)', () => {
  it('rejects a signature when the PDF bytes were modified after signing', async () => {
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const original = new TextEncoder().encode('%PDF-1.7 lab result: 4.2 mmol/L');
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      original
    );

    expect(await verifyPdfSignature(original, new Uint8Array(signature), publicKey)).toBe(true);

    const tampered = new TextEncoder().encode('%PDF-1.7 lab result: 9.9 mmol/L');
    expect(await verifyPdfSignature(tampered, new Uint8Array(signature), publicKey)).toBe(false);
  });
});
