import {
  generateDeletionChallenge,
  verifyStellarDeletionSignature,
  verifyTotpDeletionCode,
} from '@/lib/crypto';

describe('FIDO2/WebAuthn Record Deletion Verification (#30)', () => {
  it('generates a unique deletion challenge with record and user entropy', () => {
    const recordId = 'rec_1001';
    const userAddress = 'GA723...TEST';

    const challenge1 = generateDeletionChallenge(recordId, userAddress);
    const challenge2 = generateDeletionChallenge(recordId, userAddress);

    expect(challenge1.challengeBytes).toBeInstanceOf(Uint8Array);
    expect(challenge1.challengeHex).toMatch(/^[0-9a-f]+$/);
    expect(challenge1.challengeHex).not.toBe(challenge2.challengeHex);
  });

  it('verifies Stellar signature fallback', async () => {
    const isValid = await verifyStellarDeletionSignature('rec_1001', 'GA723...TEST', 'signed_hex_data');
    expect(isValid).toBe(true);

    const isInvalid = await verifyStellarDeletionSignature('rec_1001', 'GA723...TEST', '');
    expect(isInvalid).toBe(false);
  });

  it('rejects invalid or non-numeric TOTP codes', async () => {
    const isInvalid = await verifyTotpDeletionCode('12345', 'MY_SECRET');
    expect(isInvalid).toBe(false);

    const isAlpha = await verifyTotpDeletionCode('abcdef', 'MY_SECRET');
    expect(isAlpha).toBe(false);
  });
});
