/**
 * Strict validation of Groth16 circuit inputs and public signals (BN254).
 *
 * Every signal in a Circom circuit is an element of the BN254 scalar field
 * `F_r`. snarkjs/witness calculators silently reduce out-of-range values modulo
 * `r`, so an input `x + r` produces exactly the same witness as `x`. Accepting
 * such aliases lets a caller smuggle a value past off-circuit checks (e.g. a
 * "large" income that wraps to a small one) or present several distinct
 * encodings of the same public signal, which breaks equality-based checks such
 * as nullifier replay detection.
 *
 * This module refuses anything that is not a canonical field element
 * `0 ≤ x < r` before it reaches the prover or verifier.
 */

/** BN254 (alt_bn128) scalar field prime `r`. */
export const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Thrown when a circuit input or public signal is not a canonical BN254 field element. */
export class ZkInputValidationError extends Error {
  /** Dotted path of the offending signal, e.g. `sigR8[1]`. */
  readonly signal: string;

  constructor(signal: string, message: string) {
    super(`Invalid circuit input "${signal}": ${message}`);
    this.name = 'ZkInputValidationError';
    this.signal = signal;
  }
}

const DECIMAL = /^(0|[1-9]\d*)$/;
const HEX = /^0x[0-9a-fA-F]+$/;

/**
 * Parses `value` as a canonical BN254 field element.
 *
 * Accepts bigints, safe non-negative integers, canonical decimal strings and
 * `0x` hex strings. Rejects negatives, fractions, unsafe integers (which have
 * already lost precision), non-numeric strings, leading zeros / signs /
 * whitespace (non-canonical encodings) and anything `≥ r`.
 */
export function assertFieldElement(value: unknown, signal = 'input'): bigint {
  let n: bigint;
  if (typeof value === 'bigint') {
    n = value;
  } else if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new ZkInputValidationError(signal, `${value} is not an integer.`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new ZkInputValidationError(
        signal,
        `${value} exceeds Number.MAX_SAFE_INTEGER and may have lost precision; pass a bigint or decimal string.`,
      );
    }
    n = BigInt(value);
  } else if (typeof value === 'string') {
    if (DECIMAL.test(value) || HEX.test(value)) {
      n = BigInt(value);
    } else {
      throw new ZkInputValidationError(
        signal,
        `"${value.length > 90 ? `${value.slice(0, 90)}…` : value}" is not a canonical decimal or 0x-hex integer.`,
      );
    }
  } else {
    throw new ZkInputValidationError(
      signal,
      `unsupported type ${value === null ? 'null' : typeof value}.`,
    );
  }

  if (n < 0n) {
    throw new ZkInputValidationError(signal, 'negative values are not field elements.');
  }
  if (n >= BN254_SCALAR_FIELD) {
    throw new ZkInputValidationError(
      signal,
      'value is ≥ the BN254 scalar field modulus r and would silently wrap modulo r.',
    );
  }
  return n;
}

/** Returns `true` when `value` is a canonical BN254 field element. */
export function isFieldElement(value: unknown): boolean {
  try {
    assertFieldElement(value);
    return true;
  } catch {
    return false;
  }
}

/** Optional upper bound for a signal that the circuit range-checks with `Num2Bits(bits)`. */
export function assertBits(value: unknown, bits: number, signal = 'input'): bigint {
  const n = assertFieldElement(value, signal);
  if (n >= 1n << BigInt(bits)) {
    throw new ZkInputValidationError(signal, `value does not fit in ${bits} bits.`);
  }
  return n;
}

export type CircuitInputValue = bigint | number | string | CircuitInputValue[];
export type SanitizedCircuitInput = Record<string, string | SanitizedValue[]>;
type SanitizedValue = string | SanitizedValue[];

function sanitizeValue(value: unknown, path: string): SanitizedValue {
  if (Array.isArray(value)) {
    return value.map((item, i) => sanitizeValue(item, `${path}[${i}]`));
  }
  return assertFieldElement(value, path).toString();
}

/**
 * Validates every signal of a circuit input object and returns a copy with all
 * values normalised to canonical decimal strings (the format snarkjs expects).
 *
 * @throws {ZkInputValidationError} on the first non-canonical or overflowing signal.
 */
export function sanitizeCircuitInput(input: Record<string, unknown>): SanitizedCircuitInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ZkInputValidationError('input', 'expected an object of named signals.');
  }
  const out: SanitizedCircuitInput = {};
  for (const [name, value] of Object.entries(input)) {
    out[name] = sanitizeValue(value, name);
  }
  return out;
}

/**
 * Validates public signals returned with a proof. Returns `false` (instead of
 * throwing) so verifiers can treat malformed tokens as simply invalid.
 */
export function arePublicSignalsCanonical(signals: unknown): signals is string[] {
  return (
    Array.isArray(signals) &&
    signals.every((s) => typeof s === 'string' && DECIMAL.test(s) && isFieldElement(s))
  );
}
