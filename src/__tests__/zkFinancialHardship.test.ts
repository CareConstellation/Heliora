/**
 * @jest-environment node
 *
 * Issue #224 — zero-knowledge financial hardship fee reduction proof.
 */
import fs from 'fs';
import path from 'path';
import {
  FINANCIAL_HARDSHIP_CIRCUIT,
  HARDSHIP_TIERS,
  MAX_HOUSEHOLD_SIZE,
  buildFinancialHardshipInput,
  computeHardshipCommitment,
  generateFinancialHardshipProof,
  hardshipTier,
  parseFinancialHardshipCredential,
  povertyThreshold,
  verifyFinancialHardshipProof,
  type FinancialHardshipCredential,
  type PovertyGuideline,
} from '@/lib/zkEligibility';
import { BN254_SCALAR_FIELD, ZkInputValidationError } from '@/lib/zkInputValidation';
import type { FinancialHardshipProofToken } from '@/types';

jest.setTimeout(30000);

const mockProveInWorker = jest.fn();
jest.mock('@/lib/zkWorker', () => ({
  ...jest.requireActual('@/lib/zkWorker'),
  proveInWorker: (...args: unknown[]) => mockProveInWorker(...args),
}));
const mockVerify = jest.fn(async () => true);
jest.mock('snarkjs', () => ({ groth16: { verify: () => mockVerify() } }));

// HHS 2025 poverty guidelines, 48 contiguous states.
const HHS_2025: PovertyGuideline = { base: 15650, perPerson: 5500 };
const PINS = { wasm: 'a', zkey: 'b', 'vkey.json': 'c' };
const SALT = '918273645546372819';

beforeEach(() => {
  mockProveInWorker.mockReset();
  mockVerify.mockClear();
});

async function credentialFor(householdIncome: number, householdSize: number) {
  return {
    type: 'financialHardship',
    householdIncome,
    householdSize,
    salt: SALT,
    commitment: await computeHardshipCommitment(householdIncome, householdSize, SALT),
  } satisfies FinancialHardshipCredential;
}

describe('circuits/financial_hardship.circom', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, `../../circuits/${FINANCIAL_HARDSHIP_CIRCUIT}.circom`),
    'utf8',
  );

  it('keeps income and household size private and emits the tier', () => {
    expect(code).toMatch(
      /component main \{public \[guidelineBase, guidelinePerPerson, commitment\]\} = FinancialHardship\(\);/,
    );
    expect(code).toContain('signal output subsidizedTier;');
    expect(code).toContain('subsidizedTier <== le100.out + le150.out + le200.out;');
    expect(code).toContain('le200.out === 1;');
  });

  it('range-checks every comparator input', () => {
    expect(code).toContain('incomeBits = Num2Bits(32);');
    expect(code).toContain('baseBits = Num2Bits(32);');
    expect(code).toContain('perPersonBits = Num2Bits(32);');
    expect(code).toContain('sizeBits = Num2Bits(6);');
    expect(code).toContain('emptyHousehold.out === 0;');
    expect(code.match(/LessEqThan\(48\)/g)).toHaveLength(3);
  });

  it('binds the private values to the attested commitment', () => {
    expect(code).toContain('hash.inputs[0] <== householdIncome;');
    expect(code).toContain('hash.inputs[1] <== householdSize;');
    expect(code).toContain('hash.inputs[2] <== salt;');
    expect(code).toContain('hash.out === commitment;');
  });
});

describe('poverty guideline thresholds', () => {
  it('applies the HHS household-size formula', () => {
    expect(povertyThreshold(HHS_2025, 1)).toBe(15650n);
    expect(povertyThreshold(HHS_2025, 4)).toBe(32150n);
    expect(povertyThreshold(HHS_2025, 8)).toBe(54150n);
  });

  // Household of 4: 100% = 32,150; 150% = 48,225; 200% = 64,300.
  it.each([
    [0, HARDSHIP_TIERS.full],
    [32149, HARDSHIP_TIERS.full],
    [32150, HARDSHIP_TIERS.full], // exactly at the guideline
    [32151, HARDSHIP_TIERS.partial],
    [48225, HARDSHIP_TIERS.partial], // exactly 150%
    [48226, HARDSHIP_TIERS.reduced],
    [64300, HARDSHIP_TIERS.reduced], // exactly 200%
    [64301, 0],
    [2 ** 32 - 1, 0],
  ])('household of 4 earning $%i → tier %i', (income, tier) => {
    expect(hardshipTier(income, 4, HHS_2025)).toBe(tier);
  });

  it('compares exactly when the percentage threshold is fractional', () => {
    // 150% of 15,651 = 23,476.5 and 200% = 31,302.
    const g = { base: 15651, perPerson: 0 };
    expect(hardshipTier(23476, 1, g)).toBe(2);
    expect(hardshipTier(23477, 1, g)).toBe(1);
    expect(hardshipTier(31302, 1, g)).toBe(1);
    expect(hardshipTier(31303, 1, g)).toBe(0);
  });

  it('supports the circuit household-size range', () => {
    expect(() => hardshipTier(1000, 1, HHS_2025)).not.toThrow();
    expect(() => hardshipTier(1000, MAX_HOUSEHOLD_SIZE, HHS_2025)).not.toThrow();
    expect(() => hardshipTier(1000, 0, HHS_2025)).toThrow(ZkInputValidationError);
    expect(() => hardshipTier(1000, MAX_HOUSEHOLD_SIZE + 1, HHS_2025)).toThrow(/6 bits/);
  });

  it('rejects amounts the circuit cannot range-check', () => {
    expect(() => hardshipTier(2 ** 32, 1, HHS_2025)).toThrow(/32 bits/);
    expect(() => hardshipTier(-1, 1, HHS_2025)).toThrow(ZkInputValidationError);
    expect(() => hardshipTier(100.5, 1, HHS_2025)).toThrow(ZkInputValidationError);
    expect(() => hardshipTier(100, 1, { base: 2 ** 32, perPerson: 0 })).toThrow(/32 bits/);
  });
});

describe('credential handling', () => {
  it('builds a sanitised witness without tax documents', async () => {
    const cred = await credentialFor(30000, 3);
    expect(buildFinancialHardshipInput(cred, HHS_2025)).toEqual({
      householdIncome: '30000',
      householdSize: '3',
      salt: SALT,
      guidelineBase: '15650',
      guidelinePerPerson: '5500',
      commitment: cred.commitment,
    });
  });

  it('parses well-formed credentials and rejects overflowing values', async () => {
    const cred = await credentialFor(30000, 3);
    expect(parseFinancialHardshipCredential(JSON.stringify(cred))).toEqual(cred);
    expect(() =>
      parseFinancialHardshipCredential(
        JSON.stringify({ ...cred, salt: (BigInt(SALT) + BN254_SCALAR_FIELD).toString() }),
      ),
    ).toThrow(/Unrecognised/);
    expect(() =>
      parseFinancialHardshipCredential(JSON.stringify({ ...cred, householdSize: 0 })),
    ).toThrow(ZkInputValidationError);
  });

  it('commits to income and household size', async () => {
    const a = await computeHardshipCommitment(30000, 3, SALT);
    expect(a).toBe(await computeHardshipCommitment(30000, 3, SALT));
    expect(a).not.toBe(await computeHardshipCommitment(30001, 3, SALT));
    expect(a).not.toBe(await computeHardshipCommitment(30000, 4, SALT));
  });
});

describe('proof generation', () => {
  it('proves the subsidised tier without exposing income', async () => {
    const cred = await credentialFor(32150, 4);
    const publicSignals = ['3', '15650', '5500', cred.commitment];
    mockProveInWorker.mockResolvedValue({ proof: {}, publicSignals });
    const token = await generateFinancialHardshipProof(cred, HHS_2025, '/zk', {
      expectedSha256: PINS,
    });
    expect(token).toEqual({ kind: 'financialHardship', proof: {}, publicSignals });
    const job = mockProveInWorker.mock.calls[0][0];
    expect(job.circuit).toBe('financial_hardship');
    expect(job.zkeyUrl).toBe('/zk/financial_hardship.zkey');
    expect(job.input.householdIncome).toBe('32150');
  });

  it('refuses households above 200% of the guideline', async () => {
    await expect(
      generateFinancialHardshipProof(await credentialFor(64301, 4), HHS_2025, '/zk', {
        expectedSha256: PINS,
      }),
    ).rejects.toThrow(/above 200%/);
    expect(mockProveInWorker).not.toHaveBeenCalled();
  });

  it('refuses a credential whose income differs from the attestation', async () => {
    const cred = { ...(await credentialFor(70000, 4)), householdIncome: 20000 };
    await expect(
      generateFinancialHardshipProof(cred, HHS_2025, '/zk', { expectedSha256: PINS }),
    ).rejects.toThrow(/does not match its income attestation/);
    expect(mockProveInWorker).not.toHaveBeenCalled();
  });
});

describe('proof verification', () => {
  const token = (tier: string, commitment: string): FinancialHardshipProofToken => ({
    kind: 'financialHardship',
    proof: {},
    publicSignals: [tier, '15650', '5500', commitment],
  });

  it.each(['1', '2', '3'])('returns proven tier %s', async (tier) => {
    await expect(verifyFinancialHardshipProof(token(tier, '42'), '42', HHS_2025, {})).resolves.toBe(
      Number(tier),
    );
  });

  it('rejects a mismatched commitment, guideline, tier or aliased signal', async () => {
    await expect(
      verifyFinancialHardshipProof(token('3', '42'), '43', HHS_2025, {}),
    ).resolves.toBeNull();
    await expect(
      verifyFinancialHardshipProof(token('3', '42'), '42', { base: 15060, perPerson: 5380 }, {}),
    ).resolves.toBeNull();
    await expect(
      verifyFinancialHardshipProof(token('0', '42'), '42', HHS_2025, {}),
    ).resolves.toBeNull();
    await expect(
      verifyFinancialHardshipProof(token('4', '42'), '42', HHS_2025, {}),
    ).resolves.toBeNull();
    const aliased = token('3', '42');
    aliased.publicSignals[1] = (15650n + BN254_SCALAR_FIELD).toString();
    await expect(verifyFinancialHardshipProof(aliased, '42', HHS_2025, {})).resolves.toBeNull();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('returns null when the Groth16 proof is invalid', async () => {
    mockVerify.mockResolvedValueOnce(false);
    await expect(
      verifyFinancialHardshipProof(token('3', '42'), '42', HHS_2025, {}),
    ).resolves.toBeNull();
  });
});
