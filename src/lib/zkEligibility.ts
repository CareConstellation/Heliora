/**
 * Zero-knowledge eligibility proofs (Groth16 on BN254, via snarkjs).
 *
 * Supports:
 * - Age verification (≥ 18) without revealing birth date
 * - Insurance coverage verification without revealing policy number
 * - Vaccination compliance verification with clinic EdDSA signature and nullifiers
 * - IndexedDB artifact (.wasm and .zkey) caching with download progress
 * - Poseidon hashing and client-side nullifier anti-replay tracking
 * - Clinician subspecialty credential proofs with in-circuit board signature (#223)
 * - Financial-hardship fee tier proofs against the poverty guideline (#224)
 * - Strict BN254 field-element validation of every circuit input (#225)
 */

import { Buffer } from 'buffer';
import type {
  ClinicianCredentialProofToken,
  DeductibleProofToken,
  EligibilityKind,
  EligibilityProofToken,
  FinancialHardshipProofToken,
  GeoResidencyProofToken,
} from '@/types';
import {
  proveInWorker,
  sha256Hex,
  type ZkArtifactHashes,
  type ZkProofProgress,
  type ZkProveOptions,
} from './zkWorker';
import {
  BN254_SCALAR_FIELD,
  ZkInputValidationError,
  arePublicSignalsCanonical,
  assertBits,
  assertFieldElement,
  isFieldElement,
  sanitizeCircuitInput,
} from './zkInputValidation';
import {
  SNARK_SCALAR_FIELD,
  toFieldElement,
  poseidonHash,
  poseidonHashBigInt,
  getPoseidon,
  computeRecordCommitment,
  type PoseidonInput,
} from '@/lib/crypto';
import {
  indexedDbArtifactProvider,
  type ArtifactStorageProvider,
} from '@/lib/encryptedLocalStore';

export {
  SNARK_SCALAR_FIELD,
  toFieldElement,
  poseidonHash,
  poseidonHashBigInt,
  getPoseidon,
  computeRecordCommitment,
  type PoseidonInput,
};

export {
  BN254_SCALAR_FIELD,
  ZkInputValidationError,
  arePublicSignalsCanonical,
  assertFieldElement,
  isFieldElement,
  sanitizeCircuitInput,
};

export const MIN_CONSULTATION_AGE = 18;
export const DEFAULT_CIRCUIT_VERSION =
  process.env.NEXT_PUBLIC_ZK_CIRCUIT_VERSION || '1.0.0';

const CIRCUITS: Record<EligibilityKind, string> = {
  age18: 'age_eligibility',
  insurance: 'insurance_coverage',
  vaccination: 'vaccine_verification',
};

/** Circuit basename for the deductible proof (`circuits/insurance_deductible.circom`). */
export const DEDUCTIBLE_CIRCUIT = 'insurance_deductible';

/** Circuit basename for geographic residency verification (`circuits/geo_residency.circom`, #220). */
export const GEO_RESIDENCY_CIRCUIT = 'geo_residency';
export const GEO_RESIDENCY_TREE_DEPTH = 10;

/** Supported zero-knowledge proving systems (#219). */
export type ProvingSystem = 'groth16' | 'plonk';

/* ── WebAssembly & Device Memory Management (#221) ───────────────── */

export class ZkMemoryError extends Error {
  readonly deviceMemoryGb?: number;

  constructor(message?: string, deviceMemoryGb?: number) {
    super(
      message ||
        'WebAssembly out-of-memory during zero-knowledge proof generation. Your device or browser memory is insufficient. Please use a device with at least 4GB of RAM or close other tabs.',
    );
    this.name = 'ZkMemoryError';
    this.deviceMemoryGb = deviceMemoryGb;
  }
}

export interface DeviceMemoryCheck {
  hasSufficientMemory: boolean;
  deviceMemoryGb?: number;
  warning?: string;
}

/**
 * Inspects navigator.deviceMemory and returns whether the current client device has
 * the recommended >= 4GB of RAM for in-browser client-side proving (#221).
 */
export function checkDeviceMemory(): DeviceMemoryCheck {
  if (typeof navigator !== 'undefined' && 'deviceMemory' in navigator) {
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    if (typeof mem === 'number' && mem > 0) {
      if (mem < 4) {
        return {
          hasSufficientMemory: false,
          deviceMemoryGb: mem,
          warning: `Device memory (${mem}GB) is below the recommended 4GB for in-browser zero-knowledge proving. Proof generation may encounter WebAssembly out-of-memory errors on mobile browsers.`,
        };
      }
      return {
        hasSufficientMemory: true,
        deviceMemoryGb: mem,
      };
    }
  }
  return { hasSufficientMemory: true };
}

/**
 * Identifies whether an error or exception corresponds to a WebAssembly or browser
 * allocation / out-of-memory failure during circuit proving (#221).
 */
export function isWasmMemoryError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof ZkMemoryError) return true;
  const msg = String((err as Error)?.message || err).toLowerCase();
  const name = String((err as Error)?.name || '').toLowerCase();
  return (
    name === 'rangeerror' &&
    (msg.includes('out of memory') ||
      msg.includes('memory') ||
      msg.includes('allocation') ||
      msg.includes('maximum call stack') ||
      msg.includes('webassembly.memory')) ||
    msg.includes('out of memory') ||
    msg.includes('wasm out of memory') ||
    msg.includes('memory allocation failed') ||
    msg.includes('allocation failed') ||
    msg.includes('could not allocate memory')
  );
}

/** Base URL serving `<circuit>.wasm`, `<circuit>.zkey` and `<circuit>.vkey.json`. */
const ARTIFACTS_URL = (process.env.NEXT_PUBLIC_ZK_ARTIFACTS_URL || '/zk').replace(
  /\/+$/,
  '',
);

/* ── Credential Definitions ──────────────────────────────────────── */

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

/** Insurer-provided credential. `commitment` = Poseidon(policyId, expiryDate, salt). */
export interface InsuranceCredential {
  type: 'insurance';
  policyNumber: string;
  expiryDate: string; // YYYY-MM-DD
  salt: string;
  commitment: string;
}

/** Clinic-issued vaccination credential attested with an EdDSA signature. */
export interface VaccinationCredential {
  type: 'vaccination';
  patientSecret: string;
  vaccineCode: string | number;
  validUntil: string; // YYYY-MM-DD
  clinicPublicKey: [string, string]; // [Ax, Ay] in BabyJubjub
  signature: {
    R8: [string, string]; // Point R8 on BabyJubjub
    S: string; // Scalar S
  };
  commitment?: string;
  nullifier?: string;
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

export interface GeoResidencyCredential {
  type: 'geoResidency';
  zipCode: number;
  salt: string;
  commitment: string;
}

export type EligibilityCredential =
  | AgeCredential
  | InsuranceCredential
  | VaccinationCredential
  | GeoResidencyCredential;

export type VaccinationProofToken = EligibilityProofToken;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FIELD_ELEMENT = /^\d{1,78}$/;
const UINT32_MAX = 2 ** 32 - 1;

/** A credential field that must decode to a canonical BN254 field element (`0 ≤ x < r`). */
const isCanonicalField = (v: string) => FIELD_ELEMENT.test(v) && isFieldElement(v);

function cents(value: unknown, field: string): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > UINT32_MAX) {
    throw new Error(`Invalid ${field}; expected whole cents below 2^32.`);
  }
  return n;
}

/** `true` when the spend covers the deductible. Both are whole cents below 2^32. */
export function meetsDeductible(spend: number, deductible: number): boolean {
  return cents(spend, 'spend') >= cents(deductible, 'deductible');
}

/** `YYYY-MM-DD` → YYYYMMDD integer (compares like calendar dates). */
export function parseDate(value: string): number {
  const m = ISO_DATE.exec(value);
  if (!m) throw new Error(`Invalid date "${value}"; expected YYYY-MM-DD.`);
  return Number(m[1]) * 10_000 + Number(m[2]) * 100 + Number(m[3]);
}

/** Today's UTC date as YYYYMMDD integer. */
export const utcDateInt = (now: Date) =>
  now.getUTCFullYear() * 10_000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();

/** Latest birth date (YYYYMMDD) that is at least {@link MIN_CONSULTATION_AGE} years before `now` (UTC). */
export const ageCutoff = (now: Date) =>
  utcDateInt(now) - MIN_CONSULTATION_AGE * 10_000;

/**
 * Encodes a policy number as a BN254 field element: the first 31 bytes of
 * SHA-256(UTF-8), big-endian. 248 bits is always below the field modulus.
 */
export async function policyIdFromNumber(policyNumber: string): Promise<bigint> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(policyNumber)),
  );
  return digest
    .subarray(0, 31)
    .reduce((acc, b) => (acc << BigInt(8)) | BigInt(b), BigInt(0));
}

/** Validates an untrusted credential file before it is used as circuit input. */
export function parseCredential(json: string): EligibilityCredential {
  const c = JSON.parse(json) as Record<string, unknown>;
  const text = (key: string, pattern?: RegExp) => {
    const v = c[key];
    return typeof v === 'string' && v.length > 0 && (!pattern || pattern.test(v))
      ? v
      : null;
  };
  // Salts and commitments must be canonical field elements: a value ≥ r would
  // be reduced modulo r by the witness calculator and alias a different one.
  const field = (key: string) => {
    const v = text(key, FIELD_ELEMENT);
    return v && isCanonicalField(v) ? v : null;
  };

  if (c.type === 'age') {
    const salt = field('salt');
    const commitment = field('commitment');
    const birthDate = text('birthDate', ISO_DATE);
    if (salt && commitment && birthDate) {
      return { type: 'age', birthDate, salt, commitment };
    }
  }

  if (c.type === 'insurance') {
    const salt = field('salt');
    const commitment = field('commitment');
    const policyNumber = text('policyNumber');
    const expiryDate = text('expiryDate', ISO_DATE);
    if (salt && commitment && policyNumber && expiryDate) {
      return { type: 'insurance', policyNumber, expiryDate, salt, commitment };
    }
  }

  if (c.type === 'vaccination') {
    const patientSecret = text('patientSecret');
    const validUntil = text('validUntil', ISO_DATE);
    const clinicPk = Array.isArray(c.clinicPublicKey) ? c.clinicPublicKey : null;
    const sig = typeof c.signature === 'object' && c.signature !== null ? (c.signature as Record<string, unknown>) : null;
    const sigR8 = sig && Array.isArray(sig.R8) ? sig.R8 : null;
    const sigS = sig && typeof sig.S === 'string' ? sig.S : null;
    const allField = (values: unknown[] | null) =>
      !!values && values.every((v) => typeof v === 'string' && isCanonicalField(v));

    if (
      patientSecret &&
      validUntil &&
      clinicPk &&
      clinicPk.length === 2 &&
      sigR8 &&
      sigR8.length === 2 &&
      sigS &&
      allField(clinicPk) &&
      allField(sigR8) &&
      isCanonicalField(sigS)
    ) {
      return {
        type: 'vaccination',
        patientSecret,
        vaccineCode: (c.vaccineCode as string | number) ?? 'COVID-19',
        validUntil,
        clinicPublicKey: [String(clinicPk[0]), String(clinicPk[1])],
        signature: {
          R8: [String(sigR8[0]), String(sigR8[1])],
          S: sigS,
        },
        ...(typeof c.commitment === 'string' ? { commitment: c.commitment } : {}),
      };
    }
  }

  if (c.type === 'geoResidency') {
    const zipCode = typeof c.zipCode === 'number' ? c.zipCode : Number(c.zipCode);
    const salt = field('salt');
    const commitment = field('commitment') || field('residencyCommitment');
    if (salt && commitment && !isNaN(zipCode) && zipCode >= 0 && zipCode <= 99999) {
      return { type: 'geoResidency', zipCode, salt, commitment };
    }
  }

  throw new Error('Unrecognised eligibility credential.');
}

/* ── Nullifier Derivation and Anti-Replay Registry (Issue #215) ───── */

/**
 * Derives a deterministic zero-knowledge nullifier to prevent double-spending or replay.
 * Nullifier = Poseidon(patientSecret, appointmentId)
 */
export async function deriveNullifier(
  patientSecret: PoseidonInput,
  appointmentId: PoseidonInput,
): Promise<string> {
  const secretElem = toFieldElement(patientSecret);
  const appointmentElem = toFieldElement(appointmentId);
  return poseidonHash([secretElem, appointmentElem]);
}

export class NullifierReplayError extends Error {
  constructor(message = 'Duplicate nullifier: proof has already been used.') {
    super(message);
    this.name = 'NullifierReplayError';
  }
}

export interface NullifierRecord {
  nullifier: string;
  contextId?: string | undefined;
  timestamp: number;
}

/**
 * In-memory / client-side registry tracking presented nullifiers to prevent proof replay.
 */
export class NullifierTracker {
  private records = new Map<string, NullifierRecord>();

  has(nullifier: string): boolean {
    return this.records.has(nullifier);
  }

  register(nullifier: string, contextId?: string): void {
    if (this.records.has(nullifier)) {
      throw new NullifierReplayError(
        `Duplicate nullifier: ${nullifier} has already been presented.`,
      );
    }
    this.records.set(nullifier, {
      nullifier,
      contextId,
      timestamp: Date.now(),
    });
  }

  verifyAndRegister(nullifier: string, contextId?: string): boolean {
    if (this.records.has(nullifier)) return false;
    this.records.set(nullifier, {
      nullifier,
      contextId,
      timestamp: Date.now(),
    });
    return true;
  }

  clear(): void {
    this.records.clear();
  }

  get size(): number {
    return this.records.size;
  }
}

export const globalNullifierTracker = new NullifierTracker();

/* ── IndexedDB Artifact Caching & Streaming Loader (Issue #213) ──── */

export interface ArtifactProgress {
  circuit: string;
  extension: string;
  loaded: number;
  total: number;
  percent: number;
}

export type ArtifactProgressCallback = (progress: ArtifactProgress) => void;

export interface ArtifactLoaderOptions {
  onProgress?: ArtifactProgressCallback;
  bypassCache?: boolean;
  version?: string;
  artifactsUrl?: string;
  storageProvider?: ArtifactStorageProvider;
}

const artifact = (
  circuit: string,
  ext: 'wasm' | 'zkey' | 'vkey.json',
  base = ARTIFACTS_URL,
) => `${base}/${circuit}.${ext}`;

const artifactUrl = (
  kind: EligibilityKind,
  ext: 'wasm' | 'zkey' | 'vkey.json',
  base = ARTIFACTS_URL,
) => artifact(CIRCUITS[kind], ext, base);

export interface GenerateProofOptions extends ZkProveOptions {
  /** Overrides the pinned artifact digests (tests, or pins fetched at runtime). */
  expectedSha256?: ZkArtifactHashes;
}

/**
 * Builds the job for the worker, enforcing pinned artifacts for `circuit`.
 * Every input signal is validated as a canonical BN254 field element first.
 *
 * @throws {ZkInputValidationError} if any signal is negative, malformed or ≥ r.
 */
function proveJob(
  circuit: string,
  input: Record<string, unknown>,
  artifactsUrl: string,
  expectedSha256?: ZkArtifactHashes,
) {
  return {
    circuit,
    input: sanitizeCircuitInput(input),
    wasmUrl: artifact(circuit, 'wasm', artifactsUrl),
    zkeyUrl: artifact(circuit, 'zkey', artifactsUrl),
    vkeyUrl: artifact(circuit, 'vkey.json', artifactsUrl),
    expectedSha256: expectedSha256 ?? artifactPins(circuit),
  };
}

/**
 * Loads a circuit artifact (.wasm, .zkey, or .vkey.json), leveraging IndexedDB caching.
 * On cache misses, streams from the remote server, emitting progress events.
 */
export async function loadCircuitArtifact(
  kind: EligibilityKind,
  ext: 'wasm' | 'zkey' | 'vkey.json',
  options: ArtifactLoaderOptions = {},
): Promise<ArrayBuffer | object> {
  const circuitName = CIRCUITS[kind];
  const url = artifactUrl(kind, ext, options.artifactsUrl);
  const version = options.version || DEFAULT_CIRCUIT_VERSION;

  if (ext === 'vkey.json') {
    return loadVerificationKey(url);
  }

  const provider = options.storageProvider ?? indexedDbArtifactProvider;
  const cacheKey = `${circuitName}:${ext}`;

  // 1. Check IndexedDB cache unless bypassCache is requested
  if (!options.bypassCache) {
    try {
      const cached = await provider.get(cacheKey, version);
      if (cached?.buffer) {
        options.onProgress?.({
          circuit: circuitName,
          extension: ext,
          loaded: cached.buffer.byteLength,
          total: cached.buffer.byteLength,
          percent: 100,
        });
        return cached.buffer;
      }
    } catch {
      // Fallback to fetch on cache read error
    }
  }

  // 2. Fetch from network with download progress tracking
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not load ${ext} artifact from ${url}: HTTP ${res.status}`);
  }

  const contentLengthHeader = res.headers.get('content-length');
  const total = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
  let buffer: ArrayBuffer;

  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.length;
        const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
        options.onProgress?.({
          circuit: circuitName,
          extension: ext,
          loaded,
          total,
          percent,
        });
      }
    }

    const merged = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    buffer = merged.buffer;
  } else {
    buffer = await res.arrayBuffer();
    options.onProgress?.({
      circuit: circuitName,
      extension: ext,
      loaded: buffer.byteLength,
      total: buffer.byteLength,
      percent: 100,
    });
  }

  // 3. Compute buffer SHA-256 and store in IndexedDB
  try {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const hash = Buffer.from(digest).toString('hex');
    await provider.set(cacheKey, buffer, version, hash);
  } catch {
    // Non-critical if storage fails
  }

  return buffer;
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

/* ── Vaccination EdDSA Issuance Helper (Issue #211) ───────────────── */

/**
 * Health clinic helper: signs a patient's vaccination credential using BabyJubjub EdDSA.
 */
export async function signVaccinationCredential(
  clinicPrivateKey: Uint8Array | Buffer | string,
  params: {
    patientSecret: PoseidonInput;
    vaccineCode: string | number;
    validUntil: string; // YYYY-MM-DD
  },
): Promise<VaccinationCredential> {
  const { buildEddsa, buildPoseidon } = await import('circomlibjs');
  const eddsa = await buildEddsa();
  const poseidon = await buildPoseidon();

  const privKey =
    typeof clinicPrivateKey === 'string'
      ? Buffer.from(clinicPrivateKey.replace(/^0x/, ''), 'hex')
      : Buffer.from(clinicPrivateKey);

  const pubKey = eddsa.prv2pub(privKey);
  const clinicAx = eddsa.F.toString(pubKey[0]);
  const clinicAy = eddsa.F.toString(pubKey[1]);

  const patientSecretElem = toFieldElement(params.patientSecret);
  const vaccineCodeElem = toFieldElement(params.vaccineCode);
  const validUntilInt = BigInt(parseDate(params.validUntil));

  // In-circuit message M = Poseidon(patientSecret, vaccineCode, validUntil)
  const msgHash = poseidon([patientSecretElem, vaccineCodeElem, validUntilInt]);
  const sig = eddsa.signPoseidon(privKey, msgHash);

  const commitment = poseidon.F.toString(
    poseidon([patientSecretElem, vaccineCodeElem, validUntilInt]),
  );

  return {
    type: 'vaccination',
    patientSecret: patientSecretElem.toString(),
    vaccineCode: params.vaccineCode,
    validUntil: params.validUntil,
    clinicPublicKey: [clinicAx, clinicAy],
    signature: {
      R8: [eddsa.F.toString(sig.R8[0]), eddsa.F.toString(sig.R8[1])],
      S: sig.S.toString(),
    },
    commitment,
  };
}

/* ── Proof Generation & Verification ─────────────────────────────── */

export interface ProofGenerationOptions extends ArtifactLoaderOptions {
  appointmentId?: string | bigint;
  externalNullifier?: string | bigint;
  provingSystem?: ProvingSystem;
}

/**
 * Generates a zero-knowledge eligibility proof in the browser.
 * Supports both Groth16 and PLONK proving systems (#219).
 * Gracefully handles WebAssembly out-of-memory errors (#221).
 */
export async function generateEligibilityProof(
  credential: EligibilityCredential,
  now = new Date(),
  artifactsUrl = ARTIFACTS_URL,
  options: ProofGenerationOptions = {},
): Promise<EligibilityProofToken> {
  let kind: EligibilityKind;
  let input: Record<string, unknown>;
  let nullifierValue: string | undefined;

  const externalNullifierInput =
    options.externalNullifier ?? options.appointmentId ?? 0n;

  if (credential.type === 'age') {
    kind = 'age18';
    input = {
      birthDate: parseDate(credential.birthDate),
      salt: credential.salt,
      cutoffDate: ageCutoff(now),
      commitment: credential.commitment,
    };
    if (options.appointmentId) {
      nullifierValue = await deriveNullifier(credential.salt, options.appointmentId);
    }
  } else if (credential.type === 'insurance') {
    kind = 'insurance';
    input = {
      policyId: await policyIdFromNumber(credential.policyNumber),
      expiryDate: parseDate(credential.expiryDate),
      salt: credential.salt,
      currentDate: utcDateInt(now),
      commitment: credential.commitment,
    };
    if (options.appointmentId) {
      nullifierValue = await deriveNullifier(credential.salt, options.appointmentId);
    }
  } else if (credential.type === 'vaccination') {
    kind = 'vaccination';
    const patientSecretElem = toFieldElement(credential.patientSecret);
    const extNullElem = toFieldElement(externalNullifierInput);
    nullifierValue = await deriveNullifier(patientSecretElem, extNullElem);

    input = {
      patientSecret: patientSecretElem.toString(),
      vaccineCode: toFieldElement(credential.vaccineCode).toString(),
      validUntil: parseDate(credential.validUntil),
      clinicAx: credential.clinicPublicKey[0],
      clinicAy: credential.clinicPublicKey[1],
      sigR8x: credential.signature.R8[0],
      sigR8y: credential.signature.R8[1],
      sigS: credential.signature.S,
      currentDate: utcDateInt(now),
      expectedClinicAx: credential.clinicPublicKey[0],
      expectedClinicAy: credential.clinicPublicKey[1],
      externalNullifier: extNullElem.toString(),
    };
  } else {
    throw new Error('Unsupported credential type.');
  }

  // Refuse out-of-field or malformed values before they reach the witness
  // calculator, which would otherwise silently reduce them modulo r.
  const sanitizedInput = sanitizeCircuitInput(input);

  const zkeyExt = options.provingSystem === 'plonk' ? 'plonk.zkey' : 'zkey';
  const wasmArtifact = await loadCircuitArtifact(kind, 'wasm', {
    ...options,
    artifactsUrl,
  });
  const zkeyArtifact = await loadCircuitArtifact(kind, zkeyExt as any, {
    ...options,
    artifactsUrl,
  });

  try {
    const wasmInput =
      wasmArtifact instanceof ArrayBuffer ? new Uint8Array(wasmArtifact) : wasmArtifact;
    const zkeyInput =
      zkeyArtifact instanceof ArrayBuffer ? new Uint8Array(zkeyArtifact) : zkeyArtifact;

    let proof: unknown;
    let publicSignals: string[];

    if (options.provingSystem === 'plonk') {
      const { plonk } = await import('snarkjs');
      const res = await plonk.fullProve(
        sanitizedInput,
        wasmInput as any,
        zkeyInput as any,
      );
      proof = res.proof;
      publicSignals = res.publicSignals;
    } else {
      const { groth16 } = await import('snarkjs');
      const res = await groth16.fullProve(
        sanitizedInput,
        wasmInput as any,
        zkeyInput as any,
      );
      proof = res.proof;
      publicSignals = res.publicSignals;
    }

    // For vaccination circuit, publicSignals[4] is the in-circuit nullifier output
    if (kind === 'vaccination' && publicSignals.length >= 5) {
      nullifierValue = publicSignals[4];
    }

    return {
      kind,
      proof,
      publicSignals,
      protocol: options.provingSystem ?? 'groth16',
      ...(nullifierValue !== undefined ? { nullifier: nullifierValue } : {}),
    };
  } catch (err) {
    if (isWasmMemoryError(err)) {
      const memCheck = checkDeviceMemory();
      throw new ZkMemoryError(undefined, memCheck.deviceMemoryGb);
    }
    if (!String((err as Error)?.message ?? err).includes('Assert Failed')) {
      throw err;
    }
    if (kind === 'age18') {
      throw new Error(`This credential does not prove you are ${MIN_CONSULTATION_AGE} or older.`);
    }
    if (kind === 'insurance') {
      throw new Error('This credential does not prove active insurance coverage.');
    }
    throw new Error('This credential does not prove active, valid vaccination compliance.');
  }
}

export interface VerificationOptions {
  verificationKey?: object;
  now?: Date;
  nullifierTracker?: NullifierTracker;
  appointmentId?: string;
  provingSystem?: ProvingSystem;
}

/**
 * Verifies a proof token against the public verification key and validates public claims:
 * - Date validity (age cutoff, current insurance date, or vaccination validity)
 * - Issuer commitment / clinic authenticity check
 * - Anti-replay nullifier verification
 * Supports both Groth16 and PLONK proof verification (#219).
 */
export async function verifyEligibilityProof(
  token: EligibilityProofToken,
  expectedCommitment: string,
  now = new Date(),
  verificationKey?: object,
  options?: VerificationOptions,
): Promise<boolean> {
  const tracker = options?.nullifierTracker ?? globalNullifierTracker;

  // 0. Non-canonical public signals (≥ r, signed, padded) alias canonical ones
  //    and would defeat the equality checks below.
  if (!arePublicSignalsCanonical(token.publicSignals)) return false;
  if (token.nullifier !== undefined && !isFieldElement(token.nullifier)) return false;

  // 1. Anti-Replay Nullifier Presentation Check
  if (token.nullifier) {
    if (tracker.has(token.nullifier)) {
      return false; // Replay detected!
    }
  }

  const vkeyPath =
    options?.provingSystem === 'plonk' || token.protocol === 'plonk'
      ? `${artifactUrl(token.kind, 'vkey.json').replace('.vkey.json', '_plonk.vkey.json')}`
      : artifactUrl(token.kind, 'vkey.json');

  if (token.kind === 'vaccination') {
    if (token.publicSignals.length < 5) return false;
    const [currentDateStr, clinicAx, clinicAy, , circuitNullifier] = token.publicSignals;
    const currentDate = Number(currentDateStr);

    if (currentDate < utcDateInt(now)) {
      return false;
    }

    // Verify expected clinic commitment/Ax match
    if (clinicAx !== expectedCommitment && `${clinicAx}:${clinicAy}` !== expectedCommitment) {
      return false;
    }

    if (token.nullifier && circuitNullifier && token.nullifier !== circuitNullifier) {
      return false;
    }

    const vkey =
      verificationKey ??
      options?.verificationKey ??
      (await loadVerificationKey(vkeyPath));

    const isPlonk =
      options?.provingSystem === 'plonk' ||
      token.protocol === 'plonk' ||
      (vkey as any)?.protocol === 'plonk';

    let valid: boolean;
    if (isPlonk) {
      const { plonk } = await import('snarkjs');
      valid = await plonk.verify(vkey, token.publicSignals, token.proof as any);
    } else {
      const { groth16 } = await import('snarkjs');
      valid = await groth16.verify(
        vkey,
        token.publicSignals,
        token.proof as Parameters<typeof groth16.verify>[2],
      );
    }

    if (valid && token.nullifier) {
      tracker.register(token.nullifier, options?.appointmentId);
    }
    return valid;
  }

  // Handle age18 and insurance
  const [date, commitment] = token.publicSignals;
  if (token.publicSignals.length !== 2 || date === undefined || commitment !== expectedCommitment) {
    return false;
  }

  const claimHolds =
    token.kind === 'age18'
      ? BigInt(date) <= BigInt(ageCutoff(now))
      : BigInt(date) >= BigInt(utcDateInt(now));

  if (!claimHolds) return false;

  const vkey =
    verificationKey ??
    options?.verificationKey ??
    (await loadVerificationKey(vkeyPath));

  const isPlonk =
    options?.provingSystem === 'plonk' ||
    token.protocol === 'plonk' ||
    (vkey as any)?.protocol === 'plonk';

  let valid: boolean;
  if (isPlonk) {
    const { plonk } = await import('snarkjs');
    valid = await plonk.verify(vkey, token.publicSignals, token.proof as any);
  } else {
    const { groth16 } = await import('snarkjs');
    valid = await groth16.verify(
      vkey,
      token.publicSignals,
      token.proof as Parameters<typeof groth16.verify>[2],
    );
  }

  if (valid && token.nullifier) {
    tracker.register(token.nullifier, options?.appointmentId);
  }
  return valid;
}

/* ── Groth16 helpers shared by the credential circuits below ─────── */

async function proveCircuit(
  circuit: string,
  input: Record<string, unknown>,
  artifactsUrl: string,
  opts: GenerateProofOptions,
) {
  return proveInWorker(proveJob(circuit, input, artifactsUrl, opts.expectedSha256), opts);
}

async function groth16Verify(
  circuit: string,
  publicSignals: string[],
  proof: unknown,
  verificationKey?: object,
): Promise<boolean> {
  const vkey = verificationKey ?? (await loadVerificationKey(artifact(circuit, 'vkey.json')));
  const { groth16 } = await import('snarkjs');
  return groth16.verify(vkey, publicSignals, proof as Parameters<typeof groth16.verify>[2]);
}

const isAssertFailure = (err: unknown) =>
  String((err as Error)?.message ?? err).includes('Assert Failed');

type BabyJubPoint = [string, string];

interface EdDSASignature {
  R8: BabyJubPoint;
  S: string;
}

/** Verifies an EdDSA-Poseidon signature with circomlibjs, mirroring `EdDSAPoseidonVerifier`. */
async function verifyEdDSAPoseidon(
  message: bigint,
  signature: EdDSASignature,
  publicKey: BabyJubPoint,
): Promise<boolean> {
  try {
    const { buildEddsa } = await import('circomlibjs');
    const eddsa = await buildEddsa();
    const F = eddsa.F;
    const point = (p: BabyJubPoint) => [
      F.e(assertFieldElement(p[0], 'x')),
      F.e(assertFieldElement(p[1], 'y')),
    ];
    return eddsa.verifyPoseidon(
      F.e(message),
      { R8: point(signature.R8), S: assertFieldElement(signature.S, 'S') },
      point(publicKey),
    );
  } catch {
    return false;
  }
}

async function eddsaKeyPair(privateKey: Uint8Array | Buffer | string) {
  const { buildEddsa } = await import('circomlibjs');
  const eddsa = await buildEddsa();
  const privKey =
    typeof privateKey === 'string'
      ? Buffer.from(privateKey.replace(/^0x/, ''), 'hex')
      : Buffer.from(privateKey);
  const pub = eddsa.prv2pub(privKey);
  return {
    eddsa,
    privKey,
    publicKey: [eddsa.F.toString(pub[0]), eddsa.F.toString(pub[1])] as BabyJubPoint,
  };
}

const parsePoint = (v: unknown): BabyJubPoint | null =>
  Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string' && isCanonicalField(x))
    ? [v[0] as string, v[1] as string]
    : null;

const parseSignature = (v: unknown): EdDSASignature | null => {
  if (typeof v !== 'object' || v === null) return null;
  const sig = v as Record<string, unknown>;
  const R8 = parsePoint(sig.R8);
  return R8 && typeof sig.S === 'string' && isCanonicalField(sig.S) ? { R8, S: sig.S } : null;
};

/* ── Clinician Subspecialty Credential Proof (Issue #223) ────────── */

/** Circuit basename (`circuits/clinician_credential.circom`). */
export const CLINICIAN_CREDENTIAL_CIRCUIT = 'clinician_credential';

/**
 * Medical-board certification of a clinician in a subspecialty, signed by the
 * board with EdDSA-Poseidon over BabyJubjub:
 * `signature = sign(Poseidon(licenseId(licenseNumber), specialty(specialtyCode), expiryDate))`.
 *
 * `licenseNumber` (the state license ID) never leaves the device: the proof
 * reveals only the subspecialty, the board's public key and the check date.
 */
export interface ClinicianCredential {
  type: 'clinician';
  licenseNumber: string;
  /** Subspecialty identifier, e.g. a NUCC taxonomy code such as `207RC0000X`. */
  specialtyCode: string;
  expiryDate: string; // YYYY-MM-DD
  issuerPublicKey: BabyJubPoint;
  signature: EdDSASignature;
}

export type ClinicianCredentialFailure =
  | 'expired'
  | 'invalid-signature'
  | 'wrong-issuer'
  | 'wrong-specialty';

export interface ClinicianCredentialCheck {
  valid: boolean;
  reason?: ClinicianCredentialFailure;
}

/** Encodes a state license number as a 248-bit field element (SHA-256, first 31 bytes). */
export const licenseIdFromNumber = (licenseNumber: string): Promise<bigint> =>
  policyIdFromNumber(licenseNumber);

/**
 * Encodes a subspecialty code as a field element: purely numeric codes are used
 * as-is, anything else (e.g. NUCC `207RC0000X`) via SHA-256 truncated to 248 bits.
 */
export function specialtyCodeToField(specialtyCode: string | number): bigint {
  return toFieldElement(typeof specialtyCode === 'number' ? specialtyCode : specialtyCode.trim());
}

async function clinicianMessage(
  licenseNumber: string,
  specialtyCode: string,
  expiryDate: string,
): Promise<bigint> {
  return poseidonHashBigInt([
    await licenseIdFromNumber(licenseNumber),
    specialtyCodeToField(specialtyCode),
    BigInt(parseDate(expiryDate)),
  ]);
}

/** Board-side helper: issues a signed subspecialty credential. */
export async function signClinicianCredential(
  boardPrivateKey: Uint8Array | Buffer | string,
  params: { licenseNumber: string; specialtyCode: string; expiryDate: string },
): Promise<ClinicianCredential> {
  if (!params.licenseNumber) throw new Error('licenseNumber is required.');
  const { eddsa, privKey, publicKey } = await eddsaKeyPair(boardPrivateKey);
  const msg = await clinicianMessage(params.licenseNumber, params.specialtyCode, params.expiryDate);
  const sig = eddsa.signPoseidon(privKey, eddsa.F.e(msg));
  return {
    type: 'clinician',
    licenseNumber: params.licenseNumber,
    specialtyCode: params.specialtyCode,
    expiryDate: params.expiryDate,
    issuerPublicKey: publicKey,
    signature: {
      R8: [eddsa.F.toString(sig.R8[0]), eddsa.F.toString(sig.R8[1])],
      S: sig.S.toString(),
    },
  };
}

/** Validates an untrusted clinician credential file. */
export function parseClinicianCredential(json: string): ClinicianCredential {
  const c = JSON.parse(json) as Record<string, unknown>;
  const issuerPublicKey = parsePoint(c.issuerPublicKey);
  const signature = parseSignature(c.signature);
  if (
    c.type === 'clinician' &&
    typeof c.licenseNumber === 'string' &&
    c.licenseNumber.length > 0 &&
    typeof c.specialtyCode === 'string' &&
    c.specialtyCode.trim().length > 0 &&
    typeof c.expiryDate === 'string' &&
    ISO_DATE.test(c.expiryDate) &&
    issuerPublicKey &&
    signature
  ) {
    return {
      type: 'clinician',
      licenseNumber: c.licenseNumber,
      specialtyCode: c.specialtyCode,
      expiryDate: c.expiryDate,
      issuerPublicKey,
      signature,
    };
  }
  throw new Error('Unrecognised clinician credential.');
}

/**
 * Off-circuit reference check with the same constraints as
 * `clinician_credential.circom`. Used to fail fast with a clear reason before
 * spending seconds on a proof that the circuit would reject anyway.
 */
export async function checkClinicianCredential(
  credential: ClinicianCredential,
  now = new Date(),
  expected: { specialtyCode?: string; issuerPublicKey?: BabyJubPoint } = {},
): Promise<ClinicianCredentialCheck> {
  if (
    expected.issuerPublicKey &&
    (expected.issuerPublicKey[0] !== credential.issuerPublicKey[0] ||
      expected.issuerPublicKey[1] !== credential.issuerPublicKey[1])
  ) {
    return { valid: false, reason: 'wrong-issuer' };
  }
  if (
    expected.specialtyCode !== undefined &&
    specialtyCodeToField(expected.specialtyCode) !== specialtyCodeToField(credential.specialtyCode)
  ) {
    return { valid: false, reason: 'wrong-specialty' };
  }
  if (parseDate(credential.expiryDate) < utcDateInt(now)) {
    return { valid: false, reason: 'expired' };
  }
  const msg = await clinicianMessage(
    credential.licenseNumber,
    credential.specialtyCode,
    credential.expiryDate,
  );
  if (!(await verifyEdDSAPoseidon(msg, credential.signature, credential.issuerPublicKey))) {
    return { valid: false, reason: 'invalid-signature' };
  }
  return { valid: true };
}

/** Builds the (sanitised) witness input for `clinician_credential.circom`. */
export async function buildClinicianCredentialInput(
  credential: ClinicianCredential,
  now = new Date(),
) {
  return sanitizeCircuitInput({
    specialtyCode: specialtyCodeToField(credential.specialtyCode),
    currentDate: assertBits(utcDateInt(now), 32, 'currentDate'),
    issuerAx: credential.issuerPublicKey[0],
    issuerAy: credential.issuerPublicKey[1],
    licenseId: await licenseIdFromNumber(credential.licenseNumber),
    expiryDate: assertBits(parseDate(credential.expiryDate), 32, 'expiryDate'),
    sigR8x: credential.signature.R8[0],
    sigR8y: credential.signature.R8[1],
    sigS: credential.signature.S,
  });
}

const CLINICIAN_FAILURE_MESSAGES: Record<ClinicianCredentialFailure, string> = {
  expired: 'This board certification has expired.',
  'invalid-signature': 'This credential was not signed by the certifying board (tampered or forged).',
  'wrong-issuer': 'This credential was issued by a different certifying board.',
  'wrong-specialty': 'This credential certifies a different subspecialty.',
};

/**
 * Proves current board certification in `credential.specialtyCode`. Public
 * signals are `[specialtyCode, currentDate, issuerAx, issuerAy]`; the license
 * ID and exact expiry stay private.
 */
export async function generateClinicianCredentialProof(
  credential: ClinicianCredential,
  now = new Date(),
  artifactsUrl = ARTIFACTS_URL,
  opts: GenerateProofOptions = {},
): Promise<ClinicianCredentialProofToken> {
  const check = await checkClinicianCredential(credential, now);
  if (!check.valid) throw new Error(CLINICIAN_FAILURE_MESSAGES[check.reason!]);
  const input = await buildClinicianCredentialInput(credential, now);
  try {
    const { proof, publicSignals } = await proveCircuit(
      CLINICIAN_CREDENTIAL_CIRCUIT,
      input,
      artifactsUrl,
      opts,
    );
    return { kind: 'clinicianCredential', proof, publicSignals };
  } catch (err) {
    if (!isAssertFailure(err)) throw err;
    throw new Error('This credential does not prove a current board certification.');
  }
}

/**
 * Verifies a clinician credential proof for the expected subspecialty and
 * certifying board. The proof must have been generated for today (UTC) or
 * later, so a stale proof made before the certification lapsed is rejected.
 */
export async function verifyClinicianCredentialProof(
  token: ClinicianCredentialProofToken,
  expected: { specialtyCode: string; issuerPublicKey: BabyJubPoint },
  now = new Date(),
  verificationKey?: object,
): Promise<boolean> {
  if (token.kind !== 'clinicianCredential') return false;
  if (token.publicSignals.length !== 4 || !arePublicSignalsCanonical(token.publicSignals)) {
    return false;
  }
  const [specialty, date, ax, ay] = token.publicSignals as [string, string, string, string];
  if (BigInt(specialty) !== specialtyCodeToField(expected.specialtyCode)) return false;
  if (ax !== expected.issuerPublicKey[0] || ay !== expected.issuerPublicKey[1]) return false;
  if (BigInt(date) < BigInt(utcDateInt(now))) return false;
  return groth16Verify(CLINICIAN_CREDENTIAL_CIRCUIT, token.publicSignals, token.proof, verificationKey);
}

/* ── Financial Hardship Fee Reduction Proof (Issue #224) ─────────── */

/** Circuit basename (`circuits/financial_hardship.circom`). */
export const FINANCIAL_HARDSHIP_CIRCUIT = 'financial_hardship';

/** Subsidised fee tiers emitted by the circuit, keyed by maximum % of the poverty guideline. */
export const HARDSHIP_TIERS = {
  /** ≤ 100% of guideline: full fee waiver. */
  full: 3,
  /** ≤ 150% of guideline. */
  partial: 2,
  /** ≤ 200% of guideline. */
  reduced: 1,
} as const;

export type SubsidizedTier = 1 | 2 | 3;

/** Maximum household size the circuit accepts (`Num2Bits(6)`). */
export const MAX_HOUSEHOLD_SIZE = 63;

/** Poverty guideline parameters (whole dollars / year), e.g. HHS 2025 contiguous US: 15650 + 5500/person. */
export interface PovertyGuideline {
  base: number;
  perPerson: number;
}

/**
 * Income attestation from a trusted verifier (benefits office, tax authority).
 * `commitment = Poseidon(householdIncome, householdSize, salt)`.
 */
export interface FinancialHardshipCredential {
  type: 'financialHardship';
  householdIncome: number; // whole dollars / year
  householdSize: number;
  salt: string;
  commitment: string;
}

const uint = (value: unknown, bits: number, name: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ZkInputValidationError(name, 'expected a non-negative whole number.');
  }
  assertBits(value, bits, name);
  return value;
};

function checkGuideline(g: PovertyGuideline): PovertyGuideline {
  return {
    base: uint(g.base, 32, 'guidelineBase'),
    perPerson: uint(g.perPerson, 32, 'guidelinePerPerson'),
  };
}

function checkHouseholdSize(size: unknown): number {
  const n = uint(size, 6, 'householdSize');
  if (n < 1) throw new ZkInputValidationError('householdSize', 'a household has at least one person.');
  return n;
}

/** Poverty guideline for a household of `size` people (whole dollars). */
export function povertyThreshold(guideline: PovertyGuideline, size: number): bigint {
  const g = checkGuideline(guideline);
  return BigInt(g.base) + BigInt(g.perPerson) * BigInt(checkHouseholdSize(size) - 1);
}

/**
 * Reference implementation of the circuit's tier logic. Returns `0` when the
 * household is above 200% of the guideline (no proof can be produced).
 */
export function hardshipTier(
  householdIncome: number,
  householdSize: number,
  guideline: PovertyGuideline,
): SubsidizedTier | 0 {
  const income = BigInt(uint(householdIncome, 32, 'householdIncome')) * 100n;
  const threshold = povertyThreshold(guideline, householdSize);
  if (income <= threshold * 100n) return 3;
  if (income <= threshold * 150n) return 2;
  if (income <= threshold * 200n) return 1;
  return 0;
}

/** Verifier-side helper: computes the commitment to attest for a household. */
export async function computeHardshipCommitment(
  householdIncome: number,
  householdSize: number,
  salt: string | bigint,
): Promise<string> {
  return poseidonHash([
    BigInt(uint(householdIncome, 32, 'householdIncome')),
    BigInt(checkHouseholdSize(householdSize)),
    assertFieldElement(salt, 'salt'),
  ]);
}

/** Validates an untrusted financial-hardship credential file. */
export function parseFinancialHardshipCredential(json: string): FinancialHardshipCredential {
  const c = JSON.parse(json) as Record<string, unknown>;
  if (
    c.type === 'financialHardship' &&
    typeof c.householdIncome === 'number' &&
    typeof c.householdSize === 'number' &&
    typeof c.salt === 'string' &&
    isCanonicalField(c.salt) &&
    typeof c.commitment === 'string' &&
    isCanonicalField(c.commitment)
  ) {
    uint(c.householdIncome, 32, 'householdIncome');
    checkHouseholdSize(c.householdSize);
    return {
      type: 'financialHardship',
      householdIncome: c.householdIncome,
      householdSize: c.householdSize,
      salt: c.salt,
      commitment: c.commitment,
    };
  }
  throw new Error('Unrecognised financial hardship credential.');
}

/** Builds the (sanitised) witness input for `financial_hardship.circom`. */
export function buildFinancialHardshipInput(
  credential: FinancialHardshipCredential,
  guideline: PovertyGuideline,
) {
  const g = checkGuideline(guideline);
  return sanitizeCircuitInput({
    householdIncome: uint(credential.householdIncome, 32, 'householdIncome'),
    householdSize: checkHouseholdSize(credential.householdSize),
    salt: credential.salt,
    guidelineBase: g.base,
    guidelinePerPerson: g.perPerson,
    commitment: credential.commitment,
  });
}

/**
 * Proves the household income is at or below 200% of the poverty guideline
 * without revealing income, household size or tax documents. Public signals
 * are `[subsidizedTier, guidelineBase, guidelinePerPerson, commitment]`.
 */
export async function generateFinancialHardshipProof(
  credential: FinancialHardshipCredential,
  guideline: PovertyGuideline,
  artifactsUrl = ARTIFACTS_URL,
  opts: GenerateProofOptions = {},
): Promise<FinancialHardshipProofToken> {
  const input = buildFinancialHardshipInput(credential, guideline);
  if (hardshipTier(credential.householdIncome, credential.householdSize, guideline) === 0) {
    throw new Error('Household income is above 200% of the poverty guideline.');
  }
  if (
    (await computeHardshipCommitment(
      credential.householdIncome,
      credential.householdSize,
      credential.salt,
    )) !== credential.commitment
  ) {
    throw new Error('This credential does not match its income attestation.');
  }
  try {
    const { proof, publicSignals } = await proveCircuit(
      FINANCIAL_HARDSHIP_CIRCUIT,
      input,
      artifactsUrl,
      opts,
    );
    return { kind: 'financialHardship', proof, publicSignals };
  } catch (err) {
    if (!isAssertFailure(err)) throw err;
    throw new Error('This credential does not prove financial hardship eligibility.');
  }
}

/**
 * Verifies a hardship proof against the attested commitment and the current
 * guideline. Returns the proven subsidised tier, or `null` when invalid.
 */
export async function verifyFinancialHardshipProof(
  token: FinancialHardshipProofToken,
  expectedCommitment: string,
  guideline: PovertyGuideline,
  verificationKey?: object,
): Promise<SubsidizedTier | null> {
  if (token.kind !== 'financialHardship') return null;
  if (token.publicSignals.length !== 4 || !arePublicSignalsCanonical(token.publicSignals)) {
    return null;
  }
  const g = checkGuideline(guideline);
  const [tier, base, perPerson, commitment] = token.publicSignals as [string, string, string, string];
  if (commitment !== expectedCommitment) return null;
  if (BigInt(base) !== BigInt(g.base) || BigInt(perPerson) !== BigInt(g.perPerson)) return null;
  if (tier !== '1' && tier !== '2' && tier !== '3') return null;
  const valid = await groth16Verify(
    FINANCIAL_HARDSHIP_CIRCUIT,
    token.publicSignals,
    token.proof,
    verificationKey,
  );
  return valid ? (Number(tier) as SubsidizedTier) : null;
}

/* ── QR Export Helpers for Vaccination Proofs ────────────────────── */

export async function generateVProof(
  credential: VaccinationCredential,
  now = new Date(),
  options: ProofGenerationOptions = {},
): Promise<VaccinationProofToken> {
  return generateEligibilityProof(credential, now, ARTIFACTS_URL, options);
}

export function encodeProofPayload(token: EligibilityProofToken): string {
  return JSON.stringify(token);
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
  if (token.publicSignals.length !== 2 || !arePublicSignalsCanonical(token.publicSignals)) {
    throw new ZkInputValidationError('publicSignals', 'malformed age-eligibility public signals.');
  }

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

/* ── PLONK Proving System Support (#219) ─────────────────────────── */

/**
 * Generates a zero-knowledge proof using the snarkjs PLONK proving system.
 *
 * ## Architectural Trade-offs: Groth16 vs. PLONK
 *
 * 1. Proof Size:
 *    - Groth16: Constant 3 group elements (2 in G1, 1 in G2) on BN254 (~128-256 bytes).
 *      Optimal for on-chain Soroban storage and minimum gas fees.
 *    - PLONK: Variable polynomial commitments and evaluations (~400-800 bytes).
 *      Slightly larger footprint on-chain and in transport tokens.
 *
 * 2. Verification Latency:
 *    - Groth16: ~1-3 ms off-chain; exactly 3 pairing operations and small multi-scalar multiplication.
 *    - PLONK: ~5-10 ms off-chain; requires evaluating Kate opening proofs and linearization polynomials.
 *
 * 3. Proving Latency:
 *    - Groth16: Fast client-side prover execution (~1.5x to 2x faster than PLONK for equivalent R1CS).
 *    - PLONK: Moderate client-side proving overhead due to quotient polynomial interpolation and FFT passes.
 *
 * 4. Trusted Setup Maintenance:
 *    - Groth16: Requires circuit-specific Phase 2 ceremony for EVERY circuit change. Any modified constraint
 *      necessitates a new ceremony and beacon distribution.
 *    - PLONK: Universal setup (SRS / Powers of Tau). A single universal ceremony supports arbitrary circuits
 *      up to the constraint upper bound, dramatically simplifying DevOps and circuit upgrades.
 */
export async function provePlonk(
  circuitWasm: Uint8Array | ArrayBuffer | string,
  zkey: Uint8Array | ArrayBuffer | string,
  input: Record<string, unknown>,
): Promise<{ proof: unknown; publicSignals: string[] }> {
  try {
    const { plonk } = await import('snarkjs');
    const sanitized = sanitizeCircuitInput(input);
    const wasmInput =
      circuitWasm instanceof ArrayBuffer ? new Uint8Array(circuitWasm) : circuitWasm;
    const zkeyInput = zkey instanceof ArrayBuffer ? new Uint8Array(zkey) : zkey;
    return await plonk.fullProve(sanitized, wasmInput as any, zkeyInput as any);
  } catch (err) {
    if (isWasmMemoryError(err)) {
      const mem = checkDeviceMemory();
      throw new ZkMemoryError(undefined, mem.deviceMemoryGb);
    }
    throw err;
  }
}

/**
 * Verifies a PLONK zero-knowledge proof against a PLONK verification key.
 */
export async function verifyPlonkProof(
  vkey: object,
  publicSignals: string[],
  proof: unknown,
): Promise<boolean> {
  if (!arePublicSignalsCanonical(publicSignals)) return false;
  const { plonk } = await import('snarkjs');
  return plonk.verify(vkey, publicSignals, proof as any);
}

/* ── Zero-Knowledge Geographic Residency Verification (#220) ─────── */

export interface ZipCodeMerkleProof {
  root: bigint;
  siblings: bigint[];
  pathIndices: number[];
}

/**
 * Hashes a 5-digit ZIP code leaf using Poseidon.
 */
export function computeZipCodeLeaf(zipCode: number | bigint): bigint {
  const z = BigInt(zipCode);
  if (z < 0n || z > 99999n) {
    throw new Error(`Invalid ZIP code ${zipCode}: must be an integer between 00000 and 99999.`);
  }
  return poseidonHashBigInt([z]);
}

/**
 * Computes patient residency commitment: Poseidon(zipCode, salt).
 */
export function computeResidencyCommitment(
  zipCode: number | bigint,
  salt: bigint | string,
): bigint {
  const z = BigInt(zipCode);
  const s = typeof salt === 'string' ? BigInt(salt) : salt;
  return poseidonHashBigInt([z, s]);
}

/**
 * Builds a fixed-depth Merkle tree of approved ZIP codes for an authorized healthcare jurisdiction.
 */
export function buildZipCodeMerkleTree(
  zipCodes: Array<number | bigint>,
  depth = GEO_RESIDENCY_TREE_DEPTH,
) {
  const leafCount = 1 << depth;
  if (zipCodes.length > leafCount) {
    throw new Error(
      `Too many ZIP codes (${zipCodes.length}) for tree depth ${depth} (capacity: ${leafCount}).`,
    );
  }

  const zeroLeaf = 0n;
  const leaves: bigint[] = [];
  for (let i = 0; i < leafCount; i++) {
    if (i < zipCodes.length && zipCodes[i] !== undefined) {
      leaves.push(computeZipCodeLeaf(zipCodes[i]!));
    } else {
      leaves.push(zeroLeaf);
    }
  }

  const tree: bigint[][] = [leaves];
  for (let d = 0; d < depth; d++) {
    const currentLevel = tree[d]!;
    const nextLevel: bigint[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i]!;
      const right = currentLevel[i + 1]!;
      nextLevel.push(poseidonHashBigInt([left, right]));
    }
    tree.push(nextLevel);
  }

  const root = tree[depth]![0]!;

  function getProof(zipCodeOrIndex: number | bigint): ZipCodeMerkleProof {
    let index = -1;
    if (
      typeof zipCodeOrIndex === 'number' &&
      zipCodeOrIndex < zipCodes.length &&
      zipCodes[zipCodeOrIndex] !== undefined
    ) {
      index = zipCodeOrIndex;
    } else {
      const targetLeaf = computeZipCodeLeaf(zipCodeOrIndex);
      index = leaves.findIndex((l) => l === targetLeaf);
    }

    if (index === -1) {
      throw new Error(`ZIP code ${zipCodeOrIndex} is not in the authorized jurisdiction tree.`);
    }

    const siblings: bigint[] = [];
    const pathIndices: number[] = [];

    let currentIndex = index;
    for (let d = 0; d < depth; d++) {
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
      siblings.push(tree[d]![siblingIndex]!);
      pathIndices.push(isRight ? 1 : 0);
      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      root,
      siblings,
      pathIndices,
    };
  }

  return {
    root,
    tree,
    getProof,
  };
}

/**
 * Validates a Merkle membership proof against the authorized jurisdiction root.
 */
export function verifyZipCodeMerkleProof(
  leaf: bigint,
  siblings: bigint[],
  pathIndices: number[],
  expectedRoot: bigint,
): boolean {
  if (siblings.length !== pathIndices.length) return false;
  let current = leaf;
  for (let i = 0; i < siblings.length; i++) {
    const isRight = pathIndices[i] === 1;
    const left = isRight ? siblings[i]! : current;
    const right = isRight ? current : siblings[i]!;
    current = poseidonHashBigInt([left, right]);
  }
  return current === expectedRoot;
}

/**
 * Generates a zero-knowledge geographic residency proof without revealing the patient's ZIP code.
 */
export async function generateGeoResidencyProof(
  zipCode: number,
  salt: string | bigint,
  merkleProof: ZipCodeMerkleProof,
  artifactsUrl = ARTIFACTS_URL,
  options: GenerateProofOptions = {},
): Promise<GeoResidencyProofToken> {
  const saltBigInt = typeof salt === 'string' ? BigInt(salt) : salt;
  const commitment = computeResidencyCommitment(zipCode, saltBigInt);

  const circuitInput = {
    zipCode,
    salt: saltBigInt.toString(),
    siblings: merkleProof.siblings.map((s) => s.toString()),
    pathIndices: merkleProof.pathIndices,
    authorizedRoot: merkleProof.root.toString(),
    residencyCommitment: commitment.toString(),
  };

  const sanitized = sanitizeCircuitInput(circuitInput);
  const wasmArtifact = await loadCircuitArtifact(GEO_RESIDENCY_CIRCUIT, 'wasm', {
    ...options,
    artifactsUrl,
  });
  const zkeyExt = options.provingSystem === 'plonk' ? 'plonk.zkey' : 'zkey';
  const zkeyArtifact = await loadCircuitArtifact(GEO_RESIDENCY_CIRCUIT, zkeyExt as any, {
    ...options,
    artifactsUrl,
  });

  const wasmInput =
    wasmArtifact instanceof ArrayBuffer ? new Uint8Array(wasmArtifact) : wasmArtifact;
  const zkeyInput =
    zkeyArtifact instanceof ArrayBuffer ? new Uint8Array(zkeyArtifact) : zkeyArtifact;

  try {
    let proof: unknown;
    let publicSignals: string[];

    if (options.provingSystem === 'plonk') {
      const { plonk } = await import('snarkjs');
      const res = await plonk.fullProve(sanitized, wasmInput as any, zkeyInput as any);
      proof = res.proof;
      publicSignals = res.publicSignals;
    } else {
      const { groth16 } = await import('snarkjs');
      const res = await groth16.fullProve(sanitized, wasmInput as any, zkeyInput as any);
      proof = res.proof;
      publicSignals = res.publicSignals;
    }

    return {
      kind: 'geoResidency',
      proof,
      publicSignals,
      protocol: options.provingSystem ?? 'groth16',
    };
  } catch (err) {
    if (isWasmMemoryError(err)) {
      const mem = checkDeviceMemory();
      throw new ZkMemoryError(undefined, mem.deviceMemoryGb);
    }
    throw err;
  }
}

/**
 * Verifies a geographic residency proof against the expected authorized jurisdiction root and commitment.
 */
export async function verifyGeoResidencyProof(
  token: GeoResidencyProofToken,
  expectedAuthorizedRoot: string | bigint,
  expectedCommitment: string | bigint,
  verificationKey?: object,
  options?: VerificationOptions,
): Promise<boolean> {
  if (!arePublicSignalsCanonical(token.publicSignals)) return false;
  if (token.publicSignals.length < 2) return false;

  const [authorizedRootSignal, commitmentSignal] = token.publicSignals;
  const expectedRootStr = expectedAuthorizedRoot.toString();
  const expectedCommitmentStr = expectedCommitment.toString();

  if (authorizedRootSignal !== expectedRootStr || commitmentSignal !== expectedCommitmentStr) {
    return false;
  }

  const vkey =
    verificationKey ??
    options?.verificationKey ??
    (await loadVerificationKey(artifact(GEO_RESIDENCY_CIRCUIT, 'vkey.json')));

  const isPlonk =
    options?.provingSystem === 'plonk' ||
    token.protocol === 'plonk' ||
    (vkey as any)?.protocol === 'plonk';

  if (isPlonk) {
    const { plonk } = await import('snarkjs');
    return plonk.verify(vkey, token.publicSignals, token.proof as any);
  }

  const { groth16 } = await import('snarkjs');
  return groth16.verify(
    vkey,
    token.publicSignals,
    token.proof as Parameters<typeof groth16.verify>[2],
  );
}

