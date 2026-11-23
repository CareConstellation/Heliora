/**
 * @jest-environment node
 */
import ageFixture from './fixtures/zk/age18.proof.json';
import insuranceFixture from './fixtures/zk/insurance.proof.json';
import ageVkey from './fixtures/zk/age_eligibility.vkey.json';
import insuranceVkey from './fixtures/zk/insurance_coverage.vkey.json';
import {
  ageCutoff,
  parseCredential,
  policyIdFromNumber,
  utcDateInt,
  verifyEligibilityProof,
  verifyPrescriptionDosage,
} from '@/lib/zkEligibility';
import type { EligibilityProofToken } from '@/types';

// Real Groth16 proofs, produced by circuits/*.circom with snarkjs.fullProve from a test-only setup.
const age = {
  ...ageFixture,
  token: ageFixture.token as EligibilityProofToken,
  now: new Date(ageFixture.now),
};
const ins = {
  ...insuranceFixture,
  token: insuranceFixture.token as EligibilityProofToken,
  now: new Date(insuranceFixture.now),
};
const clone = (t: EligibilityProofToken) => JSON.parse(JSON.stringify(t)) as EligibilityProofToken;

describe('date encoding', () => {
  it('computes the 18-year cutoff in UTC as YYYYMMDD', () => {
    expect(utcDateInt(new Date('2026-10-20T23:59:59Z'))).toBe(20261020);
    expect(ageCutoff(new Date('2026-10-20T12:00:00Z'))).toBe(20081020);
    expect(ageCutoff(new Date('2028-02-29T00:00:00Z'))).toBe(20100229); // compares correctly against real dates
  });
});

describe('policyIdFromNumber', () => {
  it('maps a policy number to a deterministic 248-bit field element', async () => {
    const id = await policyIdFromNumber('HMO-4471-0093-XY');
    expect(id).toBe(await policyIdFromNumber('HMO-4471-0093-XY'));
    expect(id < BigInt(2) ** BigInt(248)).toBe(true);
    expect(id).not.toBe(await policyIdFromNumber('HMO-4471-0093-XZ'));
  });
});

describe('parseCredential', () => {
  it('accepts well-formed age and insurance credentials', () => {
    expect(
      parseCredential('{"type":"age","birthDate":"1990-05-17","salt":"12","commitment":"34"}'),
    ).toEqual({
      type: 'age',
      birthDate: '1990-05-17',
      salt: '12',
      commitment: '34',
    });
    expect(
      parseCredential(
        '{"type":"insurance","policyNumber":"P-1","expiryDate":"2027-12-31","salt":"1","commitment":"2"}',
      ),
    ).toMatchObject({ type: 'insurance', policyNumber: 'P-1' });
    expect(
      parseCredential(
        '{"type":"dosage","patientWeight":70,"dosage":500,"safeThreshold":20,"salt":"123","commitment":"456"}',
      ),
    ).toEqual({
      type: 'dosage',
      patientWeight: 70,
      dosage: 500,
      safeThreshold: 20,
      salt: '123',
      commitment: '456',
    });
  });

  it.each([
    '{"type":"age","birthDate":"17/05/1990","salt":"1","commitment":"2"}',
    '{"type":"age","birthDate":"1990-05-17","salt":"-1","commitment":"2"}',
    '{"type":"insurance","expiryDate":"2027-12-31","salt":"1","commitment":"2"}',
    '{"type":"other","salt":"1","commitment":"2"}',
  ])('rejects malformed credential %s', (json) => {
    expect(() => parseCredential(json)).toThrow('Unrecognised eligibility credential');
  });
});

describe('verifyEligibilityProof (#27)', () => {
  it('verifies a real age 18+ proof against the public verification key', async () => {
    await expect(verifyEligibilityProof(age.token, age.commitment, age.now, ageVkey)).resolves.toBe(
      true,
    );
  });

  it('verifies a real insurance coverage proof against the public verification key', async () => {
    await expect(
      verifyEligibilityProof(ins.token, ins.commitment, ins.now, insuranceVkey),
    ).resolves.toBe(true);
  });

  it('reveals only the cutoff/current date and the issuer commitment', () => {
    expect(age.token.publicSignals).toEqual(['20081020', age.commitment]);
    expect(ins.token.publicSignals).toEqual(['20261020', ins.commitment]);
    expect(JSON.stringify([age.token, ins.token])).not.toMatch(
      /19900517|1990-05-17|HMO-4471|20271231/,
    );
  });

  it('rejects a proof for a commitment other than the one registered for the patient', async () => {
    await expect(verifyEligibilityProof(age.token, '12345', age.now, ageVkey)).resolves.toBe(false);
  });

  it('rejects a proof whose public signals were altered', async () => {
    const tampered = clone(age.token);
    tampered.publicSignals[0] = '20081019'; // still a valid cutoff, so only the pairing check can catch it
    await expect(verifyEligibilityProof(tampered, age.commitment, age.now, ageVkey)).resolves.toBe(
      false,
    );
  });

  it('rejects a proof whose curve points were altered', async () => {
    const tampered = clone(age.token);
    (tampered.proof as { pi_a: string[] }).pi_a[0] = (ins.token.proof as { pi_a: string[] }).pi_a[0]!;
    await expect(verifyEligibilityProof(tampered, age.commitment, age.now, ageVkey)).resolves.toBe(
      false,
    );
  });

  it('rejects a proof checked against the other circuit key', async () => {
    await expect(
      verifyEligibilityProof(age.token, age.commitment, age.now, insuranceVkey),
    ).resolves.toBe(false);
  });

  it('rejects an age proof made with a cutoff later than today minus 18 years', async () => {
    const dayBefore = new Date(age.now.getTime() - 24 * 3600 * 1000);
    await expect(
      verifyEligibilityProof(age.token, age.commitment, dayBefore, ageVkey),
    ).resolves.toBe(false);
  });

  it('rejects an insurance proof dated before today', async () => {
    const nextDay = new Date(ins.now.getTime() + 24 * 3600 * 1000);
    await expect(
      verifyEligibilityProof(ins.token, ins.commitment, nextDay, insuranceVkey),
    ).resolves.toBe(false);
  });
});

describe('ZK Prescription Dosage Boundary Check (#214)', () => {
  describe('verifyPrescriptionDosage mathematical boundary tests', () => {
    it('accepts dosage strictly less than patientWeight * safeThreshold', () => {
      // 500mg < 70kg * 20mg/kg (1400mg)
      expect(verifyPrescriptionDosage(500, 70, 20)).toBe(true);
    });

    it('accepts dosage exactly equal to the boundary (patientWeight * safeThreshold)', () => {
      // Exact boundary: 1400mg == 70kg * 20mg/kg
      expect(verifyPrescriptionDosage(1400, 70, 20)).toBe(true);

      // Pediatric boundary: 500mg == 25kg * 20mg/kg
      expect(verifyPrescriptionDosage(500, 25, 20)).toBe(true);
    });

    it('rejects dosage strictly greater than the boundary (patientWeight * safeThreshold)', () => {
      // 1401mg > 70kg * 20mg/kg (1400mg)
      expect(verifyPrescriptionDosage(1401, 70, 20)).toBe(false);

      // 501mg > 25kg * 20mg/kg (500mg)
      expect(verifyPrescriptionDosage(501, 25, 20)).toBe(false);

      // Gross overdose: 5000mg for 50kg patient with 10mg/kg limit
      expect(verifyPrescriptionDosage(5000, 50, 10)).toBe(false);
    });

    it('rejects invalid or non-positive numerical values', () => {
      expect(verifyPrescriptionDosage(0, 70, 20)).toBe(false);
      expect(verifyPrescriptionDosage(-500, 70, 20)).toBe(false);
      expect(verifyPrescriptionDosage(500, 0, 20)).toBe(false);
      expect(verifyPrescriptionDosage(500, -70, 20)).toBe(false);
      expect(verifyPrescriptionDosage(500, 70, 0)).toBe(false);
      expect(verifyPrescriptionDosage(500, 70, -20)).toBe(false);
    });
  });

  describe('verifyEligibilityProof for dosage token', () => {
    const mockDosageToken: EligibilityProofToken = {
      kind: 'dosage',
      proof: { pi_a: ['1', '2'], pi_b: [['3', '4'], ['5', '6']], pi_c: ['7', '8'], protocol: 'groth16' },
      publicSignals: ['500', '20', '1234567890'], // [dosage, safeThreshold, commitment]
    };

    it('rejects dosage proof with mismatched commitment', async () => {
      const isValid = await verifyEligibilityProof(mockDosageToken, 'different_commitment');
      expect(isValid).toBe(false);
    });

    it('rejects dosage proof with invalid public signals count', async () => {
      const invalidToken: EligibilityProofToken = {
        ...mockDosageToken,
        publicSignals: ['500', '1234567890'], // missing threshold signal
      };
      const isValid = await verifyEligibilityProof(invalidToken, '1234567890');
      expect(isValid).toBe(false);
    });
  });
});
