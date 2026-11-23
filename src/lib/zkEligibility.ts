/**
 * Zero-knowledge eligibility proofs (Groth16 on BN254, via snarkjs).
 *
 * The patient proves age ≥ 18, or active insurance cover, against a Poseidon
 * commitment their issuer attested. The birth date, policy number, expiry date
 * and salt stay in the browser; only the proof and its public signals
 * (`[date, commitment]`) are shared. Circuits are in `circuits/`.
 *
 * A third circuit proves that the amount already spent on covered care meets
 * the policy deductible, without revealing the amount or the policy number.
 *
 * Proving runs in a Web Worker (`zkWorker.ts`) with progress reporting, and
 * only after the circuit artifacts' SHA-256 digests match the pins in
 * `NEXT_PUBLIC_ZK_ARTIFACT_SHA256`. Pins are emitted by `circuits/setup.sh`.
 */

import type {
  DeductibleProofToken,
  EligibilityKind,
  EligibilityProofToken,
} from '@/types';
import {
  proveInWorker,
  sha256Hex,
  type ZkArtifactHashes,
  type ZkProofProgress,
  type ZkProveOptions,
} from './zkWorker';

export const MIN_CONSULTATION_AGE = 18;

const CIRCUITS: Record<EligibilityKind, string> = {
  age18: 'age_eligibility',
  insurance: 'insurance_coverage',
};

/** Circuit basename for the deductible proof (`circuits/insurance_deductible.circom`). */
export const DEDUCTIBLE_CIRCUIT = 'insurance_deductible';

/** Base URL serving `<circuit>.wasm`, `<circuit>.zkey` and `<circuit>.vkey.json` from the trusted setup. */
const ARTIFACTS_URL = (process.env.NEXT_PUBLIC_ZK_ARTIFACTS_URL || '/zk').replace(/\/+$/, '');

/**
 * Pinned SHA-256 digests of the trusted-setup artifacts, keyed by circuit.
 *
 * Set `NEXT_PUBLIC_ZK_ARTIFACT_SHA256` to the JSON printed by
 * `circuits/setup.sh`, e.g.
 * `{"age_eligibility":{"wasm":"…","zkey":"…","vkey.json":"…"}}`.
 * Proving is refused for a circuit without pins — an unpinned artifact would
 * let anyone who can serve `public/zk` forge proofs for arbitrary claims.
 */
function parseArtifactPins(raw: string | undefined): Record<string, ZkArtifactHashes> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<ZkArtifactHashes>>;
    const pins: Record<string, ZkArtifactHashes> = {};
    for (const [circuit, hashes] of Object.entries(parsed)) {
      if (hashes?.wasm && hashes.zkey && hashes['vkey.json']) {
        pins[circuit] = {
          wasm: hashes.wasm,
          zkey: hashes.zkey,
          'vkey.json': hashes['vkey.json'],
        };
      }
    }
    return pins;
  } catch {
    return {};
  }
}

export const ARTIFACT_SHA256 = parseArtifactPins(
  process.env.NEXT_PUBLIC_ZK_ARTIFACT_SHA256,
);

/** Resolves the pinned artifact digests for `circuit`, refusing unpinned circuits. */
export function artifactPins(circuit: string): ZkArtifactHashes {
  const pins = ARTIFACT_SHA256[circuit];
  if (!pins) {
    throw new Error(
      `No verified artifacts for "${circuit}": set NEXT_PUBLIC_ZK_ARTIFACT_SHA256 from circuits/setup.sh.`,
    );
  }
  return pins;
}

/**
 * Compares an artifact's runtime digest with its pinned digest.
 * Throws on mismatch so tampered `.wasm`/`.zkey`/`vkey.json` files never reach
 * the prover.
 */
export async function verifyArtifactIntegrity(
  bytes: Uint8Array,
  expectedSha256: string,
  label = 'artifact',
): Promise<void> {
  const actual = await sha256Hex(bytes);
  if (!expectedSha256 || actual !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Refusing to prove: ${label} SHA-256 mismatch (expected ${expectedSha256 || 'a pinned hash'}, got ${actual}).`,
    );
  }
}

/** Issuer-provided credential for the age circuit. `commitment` = Poseidon(birthDate, salt). */
export interface AgeCredential {
  type: 'age';
  birthDate: string; // YYYY-MM-DD
  salt: string;
  commitment: string;
}

/** Insurer-provided credential. `commitment` = Poseidon(policyId(policyNumber), expiryDate, salt). */
export interface InsuranceCredential {
  type: 'insurance';
  policyNumber: string;
  expiryDate: string; // YYYY-MM-DD
  salt: string;
  commitment: string;
}

/**
 * Insurer-provided deductible credential.
 * `commitment` = Poseidon(policyId(policyNumber), spend, salt).
 * `spend` and `deductible` are whole cents and must fit in 32 bits.
 */
export interface DeductibleCredential {
  type: 'deductible';
  policyNumber: string;
  spend: number;
  deductible: number;
  salt: string;
  commitment: string;
}

export type EligibilityCredential = AgeCredential | InsuranceCredential;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FIELD_ELEMENT = /^\d{1,78}$/;
const UINT32_MAX = 2 ** 32 - 1;

/** `YYYY-MM-DD` → YYYYMMDD integer (compares like the calendar date). */
function parseDate(value: string): number {
  const m = ISO_DATE.exec(value);
  if (!m) throw new Error(`Invalid date "${value}"; expected YYYY-MM-DD.`);
  return Number(m[1]) * 10_000 + Number(m[2]) * 100 + Number(m[3]);
}

/** Today's UTC date as YYYYMMDD. */
export const utcDateInt = (now: Date) =>
  now.getUTCFullYear() * 10_000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();

/** Latest birth date (YYYYMMDD) that is at least {@link MIN_CONSULTATION_AGE} years before `now` (UTC). */
export const ageCutoff = (now: Date) => utcDateInt(now) - MIN_CONSULTATION_AGE * 10_000;

/**
 * Encodes a policy number as a BN254 field element: the first 31 bytes of
 * SHA-256(UTF-8), big-endian. 248 bits is always below the field modulus.
 * Issuers must use the same encoding when computing the commitment.
 */
export async function policyIdFromNumber(policyNumber: string): Promise<bigint> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(policyNumber)),
  );
  return digest.subarray(0, 31).reduce((acc, b) => (acc << BigInt(8)) | BigInt(b), BigInt(0));
}

/** Validates an untrusted credential file before it is used as circuit input. */
export function parseCredential(json: string): EligibilityCredential {
  const c = JSON.parse(json) as Record<string, unknown>;
  const text = (key: string, pattern?: RegExp) => {
    const v = c[key];
    return typeof v === 'string' && v.length > 0 && (!pattern || pattern.test(v)) ? v : null;
  };
  const salt = text('salt', FIELD_ELEMENT);
  const commitment = text('commitment', FIELD_ELEMENT);
  const birthDate = text('birthDate', ISO_DATE);
  const policyNumber = text('policyNumber');
  const expiryDate = text('expiryDate', ISO_DATE);
  if (salt && commitment && c.type === 'age' && birthDate)
    return { type: 'age', birthDate, salt, commitment };
  if (salt && commitment && c.type === 'insurance' && policyNumber && expiryDate) {
    return { type: 'insurance', policyNumber, expiryDate, salt, commitment };
  }
  throw new Error('Unrecognised eligibility credential.');
}

function cents(value: unknown, field: string): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > UINT32_MAX) {
    throw new Error(`Invalid ${field}; expected whole cents below 2^32.`);
  }
  return n;
}

/** Local pre-check mirroring the circuit's `GreaterEqThan`: spend ≥ deductible. */
export function meetsDeductible(spend: number, deductible: number): boolean {
  return cents(spend, 'spend') >= cents(deductible, 'deductible');
}

/** Validates an untrusted deductible credential file before it becomes circuit input. */
export function parseDeductibleCredential(json: string): DeductibleCredential {
  const c = JSON.parse(json) as Record<string, unknown>;
  const policyNumber = typeof c.policyNumber === 'string' ? c.policyNumber : '';
  const salt =
    typeof c.salt === 'string' && FIELD_ELEMENT.test(c.salt) ? c.salt : '';
  const commitment =
    typeof c.commitment === 'string' && FIELD_ELEMENT.test(c.commitment)
      ? c.commitment
      : '';
  if (c.type !== 'deductible' || !policyNumber || !salt || !commitment) {
    throw new Error('Unrecognised deductible credential.');
  }
  return {
    type: 'deductible',
    policyNumber,
    spend: cents(c.spend, 'spend'),
    deductible: cents(c.deductible, 'deductible'),
    salt,
    commitment,
  };
}

const artifact = (
  circuit: string,
  ext: 'wasm' | 'zkey' | 'vkey.json',
  base = ARTIFACTS_URL,
) => `${base}/${circuit}.${ext}`;

export interface GenerateProofOptions extends ZkProveOptions {
  /** Overrides the pinned artifact digests (tests, or pins fetched at runtime). */
  expectedSha256?: ZkArtifactHashes;
}

/** Builds the job for the worker, enforcing pinned artifacts for `circuit`. */
function proveJob(
  circuit: string,
  input: Record<string, unknown>,
  artifactsUrl: string,
  expectedSha256?: ZkArtifactHashes,
) {
  return {
    circuit,
    input,
    wasmUrl: artifact(circuit, 'wasm', artifactsUrl),
    zkeyUrl: artifact(circuit, 'zkey', artifactsUrl),
    vkeyUrl: artifact(circuit, 'vkey.json', artifactsUrl),
    expectedSha256: expectedSha256 ?? artifactPins(circuit),
  };
}

/**
 * Generates an eligibility proof in a worker. Witness generation fails when
 * the claim is false (too young, policy expired) or the credential doesn't
 * match its commitment. Artifact digests are checked first.
 */
export async function generateEligibilityProof(
  credential: EligibilityCredential,
  now = new Date(),
  artifactsUrl = ARTIFACTS_URL,
  opts: GenerateProofOptions = {},
): Promise<EligibilityProofToken> {
  const kind: EligibilityKind = credential.type === 'age' ? 'age18' : 'insurance';
  const input =
    credential.type === 'age'
      ? {
          birthDate: parseDate(credential.birthDate),
          salt: credential.salt,
          cutoffDate: ageCutoff(now),
          commitment: credential.commitment,
        }
      : {
          policyId: await policyIdFromNumber(credential.policyNumber),
          expiryDate: parseDate(credential.expiryDate),
          salt: credential.salt,
          currentDate: utcDateInt(now),
          commitment: credential.commitment,
        };
  try {
    const { proof, publicSignals } = await proveInWorker(
      proveJob(CIRCUITS[kind], input, artifactsUrl, opts.expectedSha256),
      opts,
    );
    return { kind, proof, publicSignals };
  } catch (err) {
    // The witness calculator reports a false claim as "Assert Failed"; anything else (e.g. artifacts not reachable, digest mismatch) is rethrown.
    if (!String((err as Error)?.message ?? err).includes('Assert Failed')) throw err;
    throw new Error(
      kind === 'age18'
        ? `This credential does not prove you are ${MIN_CONSULTATION_AGE} or older.`
        : 'This credential does not prove active insurance coverage.',
    );
  }
}

/**
 * Proves `spend ≥ deductible` for an insurer-attested policy. The exact spend
 * and policy number stay private; public signals are `[deductible, commitment]`.
 */
export async function generateDeductibleProof(
  credential: DeductibleCredential,
  artifactsUrl = ARTIFACTS_URL,
  opts: GenerateProofOptions = {},
): Promise<DeductibleProofToken> {
  const spend = cents(credential.spend, 'spend');
  const deductible = cents(credential.deductible, 'deductible');
  if (!meetsDeductible(spend, deductible)) {
    throw new Error('This credential does not prove the deductible has been met.');
  }
  const input = {
    policyId: await policyIdFromNumber(credential.policyNumber),
    spend,
    salt: credential.salt,
    deductible,
    commitment: credential.commitment,
  };
  try {
    const { proof, publicSignals } = await proveInWorker(
      proveJob(DEDUCTIBLE_CIRCUIT, input, artifactsUrl, opts.expectedSha256),
      opts,
    );
    return { kind: 'deductible', proof, publicSignals };
  } catch (err) {
    if (!String((err as Error)?.message ?? err).includes('Assert Failed')) throw err;
    throw new Error('This credential does not prove the deductible has been met.');
  }
}

const vkeyCache = new Map<string, Promise<object>>();

function loadVerificationKey(url: string): Promise<object> {
  let cached = vkeyCache.get(url);
  if (!cached) {
    cached = fetch(url).then((res) => {
      if (!res.ok) throw new Error('Could not load the verification key.');
      return res.json() as Promise<object>;
    });
    cached.catch(() => vkeyCache.delete(url));
    vkeyCache.set(url, cached);
  }
  return cached;
}

/**
 * Verifies a proof token against the public verification key. It also checks
 * that its public signals state the required claim: the date is the age cutoff
 * (or earlier) or today (or later), and the commitment is the one the issuer
 * registered for this patient.
 */
export async function verifyEligibilityProof(
  token: EligibilityProofToken,
  expectedCommitment: string,
  now = new Date(),
  verificationKey?: object,
): Promise<boolean> {
  const [date, commitment] = token.publicSignals;
  if (token.publicSignals.length !== 2 || date === undefined || commitment !== expectedCommitment)
    return false;
  const claimHolds =
    token.kind === 'age18'
      ? BigInt(date) <= BigInt(ageCutoff(now))
      : BigInt(date) >= BigInt(utcDateInt(now));
  if (!claimHolds) return false;
  const vkey =
    verificationKey ?? (await loadVerificationKey(artifact(CIRCUITS[token.kind], 'vkey.json')));
  const { groth16 } = await import('snarkjs');
  return groth16.verify(vkey, token.publicSignals, token.proof as Parameters<typeof groth16.verify>[2]);
}

/**
 * Verifies a deductible proof. Rejects unless the public signals carry the
 * expected policy commitment and the expected deductible, so a proof for a
 * lower deductible (or another policy) cannot be reused.
 */
export async function verifyDeductibleProof(
  token: DeductibleProofToken,
  expectedCommitment: string,
  expectedDeductible: number,
  verificationKey?: object,
): Promise<boolean> {
  const [deductible, commitment] = token.publicSignals;
  if (
    token.publicSignals.length !== 2 ||
    commitment !== expectedCommitment ||
    deductible === undefined
  )
    return false;
  if (BigInt(deductible) !== BigInt(cents(expectedDeductible, 'deductible'))) return false;
  const vkey =
    verificationKey ??
    (await loadVerificationKey(artifact(DEDUCTIBLE_CIRCUIT, 'vkey.json')));
  const { groth16 } = await import('snarkjs');
  return groth16.verify(vkey, token.publicSignals, token.proof as Parameters<typeof groth16.verify>[2]);
}

export type { ZkProofProgress };

/* ── On-chain verification (#208) ────────────────────────────────── */

/** Contract ID of the Soroban BN254 verifier (`contracts/zk-verifier`). */
const ZK_VERIFIER_CONTRACT_ID =
  process.env.NEXT_PUBLIC_ZK_VERIFIER_CONTRACT_ID ?? '';

/** A snarkjs Groth16 proof as serialized JSON. */
interface Groth16ProofJson {
  pi_a: [string, string, ...string[]];
  pi_b: [[string, string], [string, string], ...string[][]];
  pi_c: [string, string, ...string[]];
}

const BN254_SCALAR_BYTES = 32;

function fieldBytes(value: string): Uint8Array {
  const n = BigInt(value);
  if (n < BigInt(0) || n >= BigInt(1) << BigInt(256)) {
    throw new Error(`Field element out of range: ${value}`);
  }
  const hex = n.toString(16).padStart(BN254_SCALAR_BYTES * 2, '0');
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) => parseInt(byte, 16));
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Encodes a snarkjs proof into the host's BN254 byte layout:
 * G1 = be(X) || be(Y) (64 bytes); G2 = be(X.c1) || be(X.c0) || be(Y.c1) || be(Y.c0)
 * (128 bytes). snarkjs exports Fp2 coordinates real-first (`[c0, c1]`), while
 * Soroban expects the imaginary component first, so the pairs are swapped.
 */
export function encodeGroth16Proof(proof: unknown): {
  a: Uint8Array;
  b: Uint8Array;
  c: Uint8Array;
} {
  const { pi_a, pi_b, pi_c } = proof as Groth16ProofJson;
  if (!pi_a || !pi_b || !pi_c) throw new Error('Malformed Groth16 proof.');
  const g1 = (point: string[]) => concatBytes(fieldBytes(point[0]!), fieldBytes(point[1]!));
  const g2 = (point: string[][]) =>
    concatBytes(
      fieldBytes(point[0]![1]!),
      fieldBytes(point[0]![0]!),
      fieldBytes(point[1]![1]!),
      fieldBytes(point[1]![0]!),
    );
  return { a: g1(pi_a), b: g2(pi_b), c: g1(pi_c) };
}

export interface OnChainVerifyOptions {
  /** Defaults to `NEXT_PUBLIC_ZK_VERIFIER_CONTRACT_ID`. */
  contractId?: string;
  /** Funded Stellar account used as the (read-only) transaction source. */
  sourceAccount: string;
  sorobanRpcUrl?: string;
  networkPassphrase?: string;
}

/**
 * Verifies an age-eligibility proof against the deployed Soroban verifier by
 * simulating a `verify_age_proof(proof, signals)` call. Simulation is free and
 * needs no signature, so any connected wallet address can run the check.
 *
 * The caller must still check `cutoffDate`/`commitment` off-chain (see
 * {@link verifyEligibilityProof}), because those are circuit inputs, not
 * contract policy.
 */
export async function verifyAgeProofOnChain(
  token: EligibilityProofToken,
  opts: OnChainVerifyOptions,
): Promise<boolean> {
  if (token.kind !== 'age18') throw new Error('Only age-eligibility proofs can be verified on-chain.');
  if (token.publicSignals.length !== 2) throw new Error('Malformed age-eligibility public signals.');

  const contractId = opts.contractId ?? ZK_VERIFIER_CONTRACT_ID;
  if (!contractId) throw new Error('NEXT_PUBLIC_ZK_VERIFIER_CONTRACT_ID is not configured.');

  const { BASE_FEE, Contract, rpc, scValToNative, TransactionBuilder, xdr } = await import(
    '@stellar/stellar-sdk'
  );
  const { STELLAR_CONFIG } = await import('./stellar');
  const rpcUrl = opts.sorobanRpcUrl ?? STELLAR_CONFIG.sorobanRpcUrl;
  if (!rpcUrl) throw new Error('NEXT_PUBLIC_SOROBAN_RPC_URL is not configured.');

  const { a, b, c } = encodeGroth16Proof(token.proof);
  const proofScVal = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('a'), val: xdr.ScVal.scvBytes(Buffer.from(a)) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('b'), val: xdr.ScVal.scvBytes(Buffer.from(b)) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('c'), val: xdr.ScVal.scvBytes(Buffer.from(c)) }),
  ]);
  const signalsScVal = xdr.ScVal.scvVec(
    token.publicSignals.map(
      (signal) => xdr.ScVal.scvU256(new xdr.Uint256(Buffer.from(fieldBytes(signal)))),
    ),
  );

  const server = new rpc.Server(rpcUrl);
  const account = await server.getAccount(opts.sourceAccount);
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: opts.networkPassphrase ?? STELLAR_CONFIG.passphrase,
  })
    .addOperation(contract.call('verify_age_proof', proofScVal, signalsScVal))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(tx);
  if ('error' in simulation) return false;
  // A rejected proof traps the contract call, which surfaces as `error` above;
  // a valid proof returns `true` from the verifier.
  const retval = (simulation as { result?: { retval?: Parameters<typeof scValToNative>[0] } })
    .result?.retval;
  return retval !== undefined && scValToNative(retval) === true;
}

