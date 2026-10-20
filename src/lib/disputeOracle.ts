/**
 * Missed-consultation dispute workflow.
 *
 * 1. {@link evaluateAttendance} compares the appointment window with the
 *    doctor's and patient's Daily (WebRTC) sessions.
 * 2. The Heliora oracle service signs a {@link DisputeAttestation}.
 *    {@link verifyDisputeAttestation} checks the signature, and checks that the
 *    attested facts match the local evaluation.
 * 3. {@link buildResolveNoShowOperation} submits the attestation to the Soroban
 *    arbitration contract. The contract verifies it with `ed25519_verify` and
 *    refunds the patient in full when the doctor did not join within 15 minutes.
 */

import { Buffer } from 'buffer';
import { Contract, Keypair, nativeToScVal, type xdr } from '@stellar/stellar-sdk';
import type {
  AppointmentAttendance,
  AttendanceVerdict,
  DailyParticipant,
  SignedDisputeAttestation,
} from '@/types';

/** The doctor must be in the call within this many seconds of the scheduled start. */
export const DOCTOR_JOIN_GRACE_SECONDS = 15 * 60;

export const DISPUTE_CONFIG = {
  arbitrationContractId: process.env.NEXT_PUBLIC_ARBITRATION_CONTRACT_ID ?? '',
  oraclePublicKey: process.env.NEXT_PUBLIC_DISPUTE_ORACLE_PUBLIC_KEY ?? '',
};

export interface AttendanceEvaluation {
  verdict: AttendanceVerdict;
  /** Earliest join (Unix s) of a doctor session present within the grace window, or null. */
  doctorJoinedAt: number | null;
  /** Earliest join (Unix s) of a patient session present within the appointment window, or null. */
  patientJoinedAt: number | null;
}

const toUnixSeconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

/**
 * Evaluates attendance from the Daily call log in a single pass. Time O(p), space O(1)
 * for p participant sessions.
 *
 * A session counts as present in `[from, to]` when it overlaps that interval:
 * `join_time ≤ to` and `join_time + duration ≥ from`. A doctor who joined early
 * and stayed therefore counts, and one who left before the start does not.
 */
export function evaluateAttendance(
  attendance: AppointmentAttendance,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): AttendanceEvaluation {
  const start = toUnixSeconds(attendance.scheduledStart);
  const end = toUnixSeconds(attendance.scheduledEnd);
  const deadline = start + DOCTOR_JOIN_GRACE_SECONDS;

  let doctorJoinedAt: number | null = null;
  let patientJoinedAt: number | null = null;
  const earliest = (current: number | null, p: DailyParticipant, from: number, to: number) =>
    p.join_time <= to &&
    p.join_time + p.duration >= from &&
    (current === null || p.join_time < current)
      ? p.join_time
      : current;

  for (const p of attendance.participants) {
    if (p.user_id === attendance.doctorUserId)
      doctorJoinedAt = earliest(doctorJoinedAt, p, start, deadline);
    else if (p.user_id === attendance.patientUserId)
      patientJoinedAt = earliest(patientJoinedAt, p, start, end);
  }

  let verdict: AttendanceVerdict;
  if (doctorJoinedAt === null) verdict = nowSeconds >= deadline ? 'DOCTOR_NO_SHOW' : 'PENDING';
  else if (patientJoinedAt !== null) verdict = 'ATTENDED';
  else verdict = nowSeconds >= end ? 'PATIENT_NO_SHOW' : 'PENDING';

  return { verdict, doctorJoinedAt, patientJoinedAt };
}

/**
 * Encodes the attestation exactly as the contract's `#[contracttype] struct DisputeAttestation`:
 * an `ScMap` with symbol keys in sorted order, `Option<u64>` as void or u64.
 * The oracle signs this value's XDR, and the contract recomputes it with `to_xdr`.
 */
function attestationToScVal({ attestation: a }: SignedDisputeAttestation): xdr.ScVal {
  const optionalU64 = (v: number | null) => (v === null ? null : BigInt(v));
  return nativeToScVal(
    {
      appointment_id: a.appointmentId,
      arbitration_contract: a.arbitrationContract,
      doctor: a.doctor,
      doctor_joined_at: optionalU64(a.doctorJoinedAt),
      issued_at: BigInt(a.issuedAt),
      patient: a.patient,
      patient_joined_at: optionalU64(a.patientJoinedAt),
      scheduled_start: BigInt(a.scheduledStart),
      verdict: a.verdict,
    },
    {
      type: {
        appointment_id: ['symbol', 'string'],
        arbitration_contract: ['symbol', 'address'],
        doctor: ['symbol', 'address'],
        doctor_joined_at: ['symbol', 'u64'],
        issued_at: ['symbol', 'u64'],
        patient: ['symbol', 'address'],
        patient_joined_at: ['symbol', 'u64'],
        scheduled_start: ['symbol', 'u64'],
        verdict: ['symbol', 'symbol'],
      },
    },
  );
}

/**
 * Rejects the attestation unless it carries a valid oracle signature, is bound
 * to the configured arbitration contract, describes this appointment and
 * matches the local attendance evaluation.
 */
export function verifyDisputeAttestation(
  signed: SignedDisputeAttestation,
  attendance: AppointmentAttendance,
  evaluation: AttendanceEvaluation,
): void {
  const { attestation: a } = signed;
  const message = attestationToScVal(signed).toXDR();
  if (
    !Keypair.fromPublicKey(DISPUTE_CONFIG.oraclePublicKey).verify(
      message,
      Buffer.from(signed.signature, 'hex'),
    )
  ) {
    throw new Error('Dispute attestation signature is not from the Heliora oracle.');
  }
  const matches =
    a.arbitrationContract === DISPUTE_CONFIG.arbitrationContractId &&
    a.appointmentId === attendance.appointmentId &&
    a.doctor === attendance.doctorAddress &&
    a.patient === attendance.patientAddress &&
    a.scheduledStart === toUnixSeconds(attendance.scheduledStart) &&
    a.doctorJoinedAt === evaluation.doctorJoinedAt &&
    a.patientJoinedAt === evaluation.patientJoinedAt &&
    a.verdict === evaluation.verdict;
  if (!matches)
    throw new Error('Dispute attestation does not match the call log for this appointment.');
}

/** Builds `resolve_no_show(attestation: DisputeAttestation, signature: BytesN<64>)` on the arbitration contract. */
export function buildResolveNoShowOperation(signed: SignedDisputeAttestation): xdr.Operation {
  return new Contract(DISPUTE_CONFIG.arbitrationContractId).call(
    'resolve_no_show',
    attestationToScVal(signed),
    nativeToScVal(Buffer.from(signed.signature, 'hex')),
  );
}
