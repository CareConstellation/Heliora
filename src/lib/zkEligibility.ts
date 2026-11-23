/**
 * Zero-knowledge eligibility proofs (Groth16 on BN254, via snarkjs).
 *
 * The patient proves age ≥ 18, or active insurance cover, against a Poseidon
 * commitment their issuer attested. The birth date, policy number, expiry date
 * and salt stay in the browser; only the proof and its public signals
 * (`[date, commitment]`) are shared. Circuits are in `circuits/`.
 */

import type { EligibilityKind, EligibilityProofToken } from '@/types';

export const MIN_CONSULTATION_AGE = 18;

const CIRCUITS: Record<EligibilityKind, string> = {
  age18: 'age_eligibility',
  insurance: 'insurance_coverage',
  dosage: 'prescription_dosage',
};

/** Base URL serving `<circuit>.wasm`, `<circuit>.zkey` and `<circuit>.vkey.json` from the trusted setup. */
const ARTIFACTS_URL = (process.env.NEXT_PUBLIC_ZK_ARTIFACTS_URL || '/zk').replace(/\/+$/, '');

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

/** Attested patient weight credential for ZK dosage boundary check (#214). */
export interface PrescriptionDosageCredential {
  type: 'dosage';
  patientWeight: number; // private: patient weight in kg
  dosage: number;        // public: prescribed dosage in mg
  safeThreshold: number; // public: safe limit in mg/kg
  salt: string;
  commitment: string;    // public: Poseidon(patientWeight, salt)
}

export type EligibilityCredential = AgeCredential | InsuranceCredential | PrescriptionDosageCredential;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FIELD_ELEMENT = /^\d{1,78}$/;

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
  const num = (key: string) => {
    const v = c[key];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  };
  const salt = text('salt', FIELD_ELEMENT);
  const commitment = text('commitment', FIELD_ELEMENT);
  const birthDate = text('birthDate', ISO_DATE);
  const policyNumber = text('policyNumber');
  const expiryDate = text('expiryDate', ISO_DATE);
  const patientWeight = num('patientWeight');
  const dosage = num('dosage');
  const safeThreshold = num('safeThreshold');

  if (salt && commitment && c.type === 'age' && birthDate)
    return { type: 'age', birthDate, salt, commitment };
  if (salt && commitment && c.type === 'insurance' && policyNumber && expiryDate) {
    return { type: 'insurance', policyNumber, expiryDate, salt, commitment };
  }
  if (salt && commitment && c.type === 'dosage' && patientWeight && dosage && safeThreshold) {
    return { type: 'dosage', patientWeight, dosage, safeThreshold, salt, commitment };
  }
  throw new Error('Unrecognised eligibility credential.');
}

/**
 * Validates that prescribed dosage does not exceed patientWeight * safeThreshold.
 * Pure mathematical boundary check.
 * Time: O(1)
 * Space: O(1)
 */
export function verifyPrescriptionDosage(
  dosage: number,
  patientWeight: number,
  safeThreshold: number,
): boolean {
  if (dosage <= 0 || patientWeight <= 0 || safeThreshold <= 0) {
    return false;
  }
  return dosage <= patientWeight * safeThreshold;
}

const artifact = (
  kind: EligibilityKind,
  ext: 'wasm' | 'zkey' | 'vkey.json',
  base = ARTIFACTS_URL,
) => `${base}/${CIRCUITS[kind]}.${ext}`;

/**
 * Generates a proof in the browser. Witness generation fails when the claim is
 * false (too young, policy expired, or dosage exceeds safe threshold) or the credential
 * doesn't match its commitment.
 */
export async function generateEligibilityProof(
  credential: EligibilityCredential,
  now = new Date(),
  artifactsUrl = ARTIFACTS_URL,
): Promise<EligibilityProofToken> {
  const kind: EligibilityKind =
    credential.type === 'age'
      ? 'age18'
      : credential.type === 'insurance'
        ? 'insurance'
        : 'dosage';

  let input: Record<string, unknown>;
  if (credential.type === 'age') {
    input = {
      birthDate: parseDate(credential.birthDate),
      salt: credential.salt,
      cutoffDate: ageCutoff(now),
      commitment: credential.commitment,
    };
  } else if (credential.type === 'insurance') {
    input = {
      policyId: await policyIdFromNumber(credential.policyNumber),
      expiryDate: parseDate(credential.expiryDate),
      salt: credential.salt,
      currentDate: utcDateInt(now),
      commitment: credential.commitment,
    };
  } else {
    input = {
      patientWeight: credential.patientWeight,
      salt: credential.salt,
      dosage: credential.dosage,
      safeThreshold: credential.safeThreshold,
      commitment: credential.commitment,
    };
  }

  const { groth16 } = await import('snarkjs');
  try {
    const { proof, publicSignals } = await groth16.fullProve(
      input,
      artifact(kind, 'wasm', artifactsUrl),
      artifact(kind, 'zkey', artifactsUrl),
    );
    return { kind, proof, publicSignals };
  } catch (err) {
    if (!String((err as Error)?.message ?? err).includes('Assert Failed')) throw err;
    if (kind === 'age18') {
      throw new Error(`This credential does not prove you are ${MIN_CONSULTATION_AGE} or older.`);
    }
    if (kind === 'insurance') {
      throw new Error('This credential does not prove active insurance coverage.');
    }
    throw new Error('Prescribed dosage exceeds safe weight-adjusted boundary.');
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
 * Verifies a proof token against the public verification key.
 * For dosage proofs, it checks that the public commitment matches and that
 * the verified public dosage signal satisfies the safety boundary.
 */
export async function verifyEligibilityProof(
  token: EligibilityProofToken,
  expectedCommitment: string,
  now = new Date(),
  verificationKey?: object,
): Promise<boolean> {
  if (token.kind === 'dosage') {
    // Public signals: [dosage, safeThreshold, commitment]
    const [dosage, safeThreshold, commitment] = token.publicSignals;
    if (
      token.publicSignals.length !== 3 ||
      dosage === undefined ||
      safeThreshold === undefined ||
      commitment !== expectedCommitment
    ) {
      return false;
    }
    const vkey = verificationKey ?? (await loadVerificationKey(artifact('dosage', 'vkey.json')));
    const { groth16 } = await import('snarkjs');
    return groth16.verify(vkey, token.publicSignals, token.proof as Parameters<typeof groth16.verify>[2]);
  }

  const [date, commitment] = token.publicSignals;
  if (token.publicSignals.length !== 2 || date === undefined || commitment !== expectedCommitment)
    return false;
  const claimHolds =
    token.kind === 'age18'
      ? BigInt(date) <= BigInt(ageCutoff(now))
      : BigInt(date) >= BigInt(utcDateInt(now));
  if (!claimHolds) return false;
  const vkey = verificationKey ?? (await loadVerificationKey(artifact(token.kind, 'vkey.json')));
  const { groth16 } = await import('snarkjs');
  return groth16.verify(vkey, token.publicSignals, token.proof as Parameters<typeof groth16.verify>[2]);
}
