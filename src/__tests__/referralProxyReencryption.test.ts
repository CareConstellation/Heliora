/** @jest-environment node */

import { webcrypto } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';

Object.assign(globalThis, { crypto: webcrypto, TextEncoder, TextDecoder });

import {
  decryptReferredRecord,
  encryptForReferralOwner,
  generateReferralReencryptionKey,
  proxyTransformReferralCiphertext,
} from '@/lib/delegatedProxy';

describe('proxy re-encryption for doctor referrals (#248)', () => {
  async function makeKeyPair() {
    return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  }

  it('derives re-encryption key, transforms without plaintext disclosure, specialist decrypts', async () => {
    const owner = await makeKeyPair();
    const specialist = await makeKeyPair();
    const outsider = await makeKeyPair();
    const ownerPub = (await crypto.subtle.exportKey('jwk', owner.publicKey)) as JsonWebKey;
    const specialistPub = (await crypto.subtle.exportKey('jwk', specialist.publicKey)) as JsonWebKey;
    const plaintext = new TextEncoder().encode('confidential referral record');

    const encrypted = await encryptForReferralOwner(plaintext, ownerPub);
    const rekey = await generateReferralReencryptionKey({
      ownerAddress: 'GOWNER',
      ownerKeyPair: owner,
      specialistAddress: 'GSPECIALIST',
      specialistPublicKey: specialistPub,
      ownerCapsule: encrypted.ownerCapsule,
    });

    const transformed = proxyTransformReferralCiphertext(encrypted, rekey);
    expect(transformed.ciphertext).toBe(encrypted.ciphertext);
    expect(transformed.specialistCapsule.wrappedDek).not.toBe(encrypted.ownerCapsule.wrappedDek);
    expect(JSON.stringify(transformed)).not.toContain('confidential referral record');

    const decrypted = await decryptReferredRecord(transformed, specialist);
    expect(new TextDecoder().decode(decrypted)).toBe('confidential referral record');
    await expect(decryptReferredRecord(transformed, outsider)).rejects.toBeDefined();
  });
});
