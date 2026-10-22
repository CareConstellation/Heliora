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
