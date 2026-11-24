/**
 * @jest-environment node
 *
 * Issue #225 — circuit inputs must be canonical BN254 field elements (0 ≤ x < r).
 */
import {
  BN254_SCALAR_FIELD,
  ZkInputValidationError,
  arePublicSignalsCanonical,
  assertBits,
  assertFieldElement,
  isFieldElement,
  sanitizeCircuitInput,
} from '@/lib/zkInputValidation';
import {
  SNARK_SCALAR_FIELD,
  generateEligibilityProof,
  parseCredential,
  toFieldElement,
  verifyEligibilityProof,
  NullifierTracker,
} from '@/lib/zkEligibility';
import type { EligibilityProofToken } from '@/types';

const mockFullProve = jest.fn();
const mockVerify = jest.fn(async () => true);
jest.mock('snarkjs', () => ({
  groth16: {
    fullProve: (...args: unknown[]) => mockFullProve(...args),
    verify: () => mockVerify(),
  },
}));

const r = BN254_SCALAR_FIELD;

beforeEach(() => {
  mockFullProve.mockReset();
  mockVerify.mockClear();
});

describe('BN254 scalar field bounds', () => {
  it('uses the BN254 scalar field prime', () => {
    expect(r).toBe(SNARK_SCALAR_FIELD);
    expect(r.toString()).toBe(
      '21888242871839275222246405745257275088548364400416034343698204186575808495617',
    );
  });

  it.each([
    ['zero', 0n],
    ['r - 1 (bigint)', r - 1n],
    ['r - 1 (decimal)', (r - 1n).toString()],
    ['r - 1 (hex)', `0x${(r - 1n).toString(16)}`],
    ['safe integer', Number.MAX_SAFE_INTEGER],
  ])('accepts %s', (_label, value) => {
    expect(() => assertFieldElement(value)).not.toThrow();
    expect(isFieldElement(value)).toBe(true);
  });

  it.each([
    ['r', r],
    ['r + 1', r + 1n],
    ['r + 42 (decimal)', (r + 42n).toString()],
    ['2r - 1', 2n * r - 1n],
    ['2^256 - 1 (hex)', `0x${'f'.repeat(64)}`],
    ['r as hex', `0x${r.toString(16)}`],
  ])('rejects modulo-overflow input %s', (_label, value) => {
    expect(() => assertFieldElement(value, 'salt')).toThrow(ZkInputValidationError);
    expect(() => assertFieldElement(value, 'salt')).toThrow(/BN254 scalar field modulus/);
  });

  it.each([
    ['negative bigint', -1n],
    ['negative number', -1],
    ['negative decimal string', '-5'],
    ['fraction', 1.5],
    ['NaN', Number.NaN],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 2],
    ['leading zero', '007'],
    ['whitespace', ' 1'],
    ['plus sign', '+1'],
    ['exponent', '1e3'],
    ['empty string', ''],
    ['text', 'hello'],
    ['null', null],
    ['undefined', undefined],
    ['object', {}],
    ['boolean', true],
  ])('rejects non-canonical input: %s', (_label, value) => {
    expect(() => assertFieldElement(value)).toThrow(ZkInputValidationError);
  });

  it('enforces circuit bit widths', () => {
    expect(assertBits(2 ** 32 - 1, 32, 'date')).toBe(BigInt(2 ** 32 - 1));
    expect(() => assertBits(2 ** 32, 32, 'date')).toThrow(/32 bits/);
  });
});

describe('sanitizeCircuitInput', () => {
  it('normalises every signal to a canonical decimal string', () => {
    expect(sanitizeCircuitInput({ a: 1, b: 2n, c: '0x10', d: [3, ['4', 5n]] })).toEqual({
      a: '1',
      b: '2',
      c: '16',
      d: ['3', ['4', '5']],
    });
  });

  it('names the offending (nested) signal in the error', () => {
    let caught: unknown;
    try {
      sanitizeCircuitInput({ ok: 1, sig: ['1', (r + 1n).toString()] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ZkInputValidationError);
    expect((caught as ZkInputValidationError).signal).toBe('sig[1]');
    expect((caught as Error).message).toContain('"sig[1]"');
  });

  it('rejects non-object inputs', () => {
    expect(() => sanitizeCircuitInput([] as unknown as Record<string, unknown>)).toThrow(
      ZkInputValidationError,
    );
  });

  it('validates public signals without throwing', () => {
    expect(arePublicSignalsCanonical(['0', (r - 1n).toString()])).toBe(true);
    expect(arePublicSignalsCanonical([r.toString()])).toBe(false);
    expect(arePublicSignalsCanonical(['0x01'])).toBe(false);
    expect(arePublicSignalsCanonical(['01'])).toBe(false);
    expect(arePublicSignalsCanonical('1')).toBe(false);
  });
});

describe('toFieldElement', () => {
  it('maps arbitrary text deterministically into the field', () => {
    const a = toFieldElement('appointment-123');
    expect(a).toBe(toFieldElement('appointment-123'));
    expect(a < r).toBe(true);
  });

  it('rejects overflowing numeric strings', () => {
    expect(() => toFieldElement(r.toString())).toThrow(RangeError);
  });
});

describe('credential parsing', () => {
  const age = (salt: string, commitment = '7') =>
    JSON.stringify({ type: 'age', birthDate: '2000-01-01', salt, commitment });

  it('accepts salts and commitments just below r', () => {
    const top = (r - 1n).toString();
    expect(parseCredential(age(top, top))).toMatchObject({ salt: top, commitment: top });
  });

  it('rejects salts and commitments that alias another value modulo r', () => {
    // r + 5 ≡ 5 (mod r): the witness would silently be computed for salt = 5.
    expect(() => parseCredential(age((r + 5n).toString()))).toThrow(/Unrecognised/);
    expect(() => parseCredential(age('5', r.toString()))).toThrow(/Unrecognised/);
  });

  it('rejects vaccination credentials with out-of-field signature values', () => {
    const vacc = (S: string) =>
      JSON.stringify({
        type: 'vaccination',
        patientSecret: 'secret',
        validUntil: '2030-01-01',
        clinicPublicKey: ['1', '2'],
        signature: { R8: ['3', '4'], S },
      });
    expect(parseCredential(vacc('5')).type).toBe('vaccination');
    expect(() => parseCredential(vacc((r + 5n).toString()))).toThrow(/Unrecognised/);
  });
});

describe('proof generation and verification', () => {
  it('throws ZkInputValidationError before proving when an input overflows the field', async () => {
    await expect(
      generateEligibilityProof(
        { type: 'age', birthDate: '2000-01-01', salt: (r + 5n).toString(), commitment: '1' },
        new Date('2026-11-24T00:00:00Z'),
      ),
    ).rejects.toBeInstanceOf(ZkInputValidationError);
    expect(mockFullProve).not.toHaveBeenCalled();
  });

  it('rejects proof tokens whose public signals are aliased modulo r', async () => {
    const commitment = '12345';
    const token: EligibilityProofToken = {
      kind: 'age18',
      proof: {},
      publicSignals: ['20000101', (BigInt(commitment) + r).toString()],
    };
    // Even if the verifier's own commitment check were bypassed, the alias is refused.
    await expect(
      verifyEligibilityProof(
        token,
        token.publicSignals[1]!,
        new Date('2026-11-24'),
        {},
        {
          nullifierTracker: new NullifierTracker(),
        },
      ),
    ).resolves.toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('rejects aliased nullifiers so replay detection cannot be bypassed', async () => {
    const tracker = new NullifierTracker();
    tracker.register('99');
    const token: EligibilityProofToken = {
      kind: 'age18',
      proof: {},
      publicSignals: ['20000101', '1'],
      nullifier: (99n + r).toString(),
    };
    await expect(
      verifyEligibilityProof(token, '1', new Date('2026-11-24'), {}, { nullifierTracker: tracker }),
    ).resolves.toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
  });
});
