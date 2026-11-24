import { blindMessage, buildReceipt, generateSignerKeyPair, signBlinded, unblindSignature, verifySignature } from '@/lib/blindSignature';

describe('blindSignature', () => {
  it('supports blind sign unblind and verify flow', async () => {
    const signer = await generateSignerKeyPair();
    const privateJwk = await crypto.subtle.exportKey('jwk', signer.signingKey);
    const message = new TextEncoder().encode(JSON.stringify({ appointmentId: 'apt-1', rating: 5 }));

    const { blindedMessage, blindingFactor } = await blindMessage(message, signer.publicKey);
    const blindSig = await signBlinded(blindedMessage, privateJwk);
    const signature = unblindSignature(blindSig, blindingFactor, signer.publicKey);

    await expect(verifySignature(message, signature, signer.publicKey)).resolves.toBe(true);
    const receipt = buildReceipt(message, signature, signer.publicKey);
    expect(receipt.signature).toBeInstanceOf(Uint8Array);
  });
});
