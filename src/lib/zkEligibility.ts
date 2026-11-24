/**
 * Zero-knowledge eligibility proofs (Groth16 on BN254, via snarkjs).
 *
 * Supports:
 * - Age verification (≥ 18) without revealing birth date
 * - Insurance coverage verification without revealing policy number
 * - Vaccination compliance verification with clinic EdDSA signature and nullifiers
 * - IndexedDB artifact (.wasm and .zkey) caching with download progress
 * - Poseidon hashing and client-side nullifier anti-replay tracking
 */

import { Buffer } from 'buffer';
import type { EligibilityKind, EligibilityProofToken } from '@/types';
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
  createMemoryArtifactProvider,
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

export const MIN_CONSULTATION_AGE = 18;
export const DEFAULT_CIRCUIT_VERSION =
  process.env.NEXT_PUBLIC_ZK_CIRCUIT_VERSION || '1.0.0';

const CIRCUITS: Record<EligibilityKind, string> = {
  age18: 'age_eligibility',
  insurance: 'insurance_coverage',
  vaccination: 'vaccine_verification',
};

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

export type EligibilityCredential =
  | AgeCredential
  | InsuranceCredential
  | VaccinationCredential;

export type VaccinationProofToken = EligibilityProofToken;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FIELD_ELEMENT = /^\d{1,78}$/;
const UINT32_MAX = 2 ** 32 - 1;

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

  if (c.type === 'age') {
    const salt = text('salt', FIELD_ELEMENT);
    const commitment = text('commitment', FIELD_ELEMENT);
    const birthDate = text('birthDate', ISO_DATE);
    if (salt && commitment && birthDate) {
      return { type: 'age', birthDate, salt, commitment };
    }
  }

  if (c.type === 'insurance') {
    const salt = text('salt', FIELD_ELEMENT);
    const commitment = text('commitment', FIELD_ELEMENT);
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

    if (
      patientSecret &&
      validUntil &&
      clinicPk &&
      clinicPk.length === 2 &&
      sigR8 &&
      sigR8.length === 2 &&
      sigS
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
        commitment: typeof c.commitment === 'string' ? c.commitment : undefined,
      };
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
  contextId?: string;
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

const artifactUrl = (
  kind: EligibilityKind,
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
}

/**
 * Generates a zero-knowledge eligibility proof in the browser.
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

  const { groth16 } = await import('snarkjs');
  const wasmArtifact = await loadCircuitArtifact(kind, 'wasm', {
    ...options,
    artifactsUrl,
  });
  const zkeyArtifact = await loadCircuitArtifact(kind, 'zkey', {
    ...options,
    artifactsUrl,
  });

  try {
    const wasmInput =
      wasmArtifact instanceof ArrayBuffer ? new Uint8Array(wasmArtifact) : wasmArtifact;
    const zkeyInput =
      zkeyArtifact instanceof ArrayBuffer ? new Uint8Array(zkeyArtifact) : zkeyArtifact;

    const { proof, publicSignals } = await groth16.fullProve(
      input,
      wasmInput as any,
      zkeyInput as any,
    );

    // For vaccination circuit, publicSignals[4] is the in-circuit nullifier output
    if (kind === 'vaccination' && publicSignals.length >= 5) {
      nullifierValue = publicSignals[4];
    }

    return {
      kind,
      proof,
      publicSignals,
      nullifier: nullifierValue,
    };
  } catch (err) {
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
}

/**
 * Verifies a proof token against the public verification key and validates public claims:
 * - Date validity (age cutoff, current insurance date, or vaccination validity)
 * - Issuer commitment / clinic authenticity check
 * - Anti-replay nullifier verification
 */
export async function verifyEligibilityProof(
  token: EligibilityProofToken,
  expectedCommitment: string,
  now = new Date(),
  verificationKey?: object,
  options?: VerificationOptions,
): Promise<boolean> {
  const tracker = options?.nullifierTracker ?? globalNullifierTracker;

  // 1. Anti-Replay Nullifier Presentation Check
  if (token.nullifier) {
    if (tracker.has(token.nullifier)) {
      return false; // Replay detected!
    }
  }

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
      (await loadVerificationKey(artifactUrl(token.kind, 'vkey.json')));

    const { groth16 } = await import('snarkjs');
    const valid = await groth16.verify(
      vkey,
      token.publicSignals,
      token.proof as Parameters<typeof groth16.verify>[2],
    );

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
    (await loadVerificationKey(artifactUrl(token.kind, 'vkey.json')));

  const { groth16 } = await import('snarkjs');
  const valid = await groth16.verify(
    vkey,
    token.publicSignals,
    token.proof as Parameters<typeof groth16.verify>[2],
  );

  if (valid && token.nullifier) {
    tracker.register(token.nullifier, options?.appointmentId);
  }
  return valid;
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

