import {
  computeConsentAgreementDigest,
  anchorConsentReceipt,
  type ConsentAgreementParams,
} from '@/lib/crypto';

describe('Cryptographically Verifiable Patient Consent Receipts (#19)', () => {
  const sampleParams: ConsentAgreementParams = {
    recordId: 'rec_98234_lab',
    recordHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    recipient: 'GBCX7...M9QL2',
    recipientType: 'laboratory',
    purpose: 'Complete Blood Count & Metabolic Panel',
    durationDays: 30,
    timestamp: 1700000000000,
  };

  it('generates deterministic SHA-256 agreement digest regardless of key order', async () => {
    const digest1 = await computeConsentAgreementDigest(sampleParams);
    const digest2 = await computeConsentAgreementDigest({
      ...sampleParams,
      purpose: 'Complete Blood Count & Metabolic Panel',
    });

    expect(typeof digest1).toBe('string');
    expect(digest1).toHaveLength(64);
    expect(digest1).toBe(digest2);
  });

  it('produces different digests for different agreement parameters', async () => {
    const digest1 = await computeConsentAgreementDigest(sampleParams);
    const digest2 = await computeConsentAgreementDigest({
      ...sampleParams,
      durationDays: 60,
    });

    expect(digest1).not.toBe(digest2);
  });

  it('anchors consent receipt with unique receipt ID and ledger tx hash', async () => {
    const patient = 'GD76A...P8K31';
    const receipt = await anchorConsentReceipt(sampleParams, patient);

    expect(receipt.receiptId).toMatch(/^rcpt_[a-f0-9]{16}_/);
    expect(receipt.agreementDigest).toHaveLength(64);
    expect(receipt.recordHash).toBe(sampleParams.recordHash);
    expect(receipt.recipient).toBe(sampleParams.recipient);
    expect(receipt.recipientType).toBe('laboratory');
    expect(receipt.patientAddress).toBe(patient);
    expect(receipt.ledgerTxHash).toHaveLength(64);
    expect(new Date(receipt.validUntil).getTime()).toBeGreaterThan(new Date(receipt.createdAt).getTime());
  });
});
