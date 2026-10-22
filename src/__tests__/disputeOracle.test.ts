/**
 * @jest-environment node
 */
import { Keypair, StrKey, nativeToScVal, scValToNative, type xdr } from '@stellar/stellar-sdk';
import type { AppointmentAttendance, DailyParticipant, DisputeAttestation } from '@/types';

const oracle = Keypair.random();
const contractId = StrKey.encodeContract(Buffer.alloc(32, 7));
process.env.NEXT_PUBLIC_DISPUTE_ORACLE_PUBLIC_KEY = oracle.publicKey();
process.env.NEXT_PUBLIC_ARBITRATION_CONTRACT_ID = contractId;

// Loaded after the env vars above, because DISPUTE_CONFIG reads them at import time.
const {
  DOCTOR_JOIN_GRACE_SECONDS,
  buildResolveNoShowOperation,
  evaluateAttendance,
  verifyDisputeAttestation,
} = require('@/lib/disputeOracle') as typeof import('@/lib/disputeOracle');

const START = 1_800_000_000;
const END = START + 30 * 60;
const DOCTOR_ID = '1f0e2c4a-0000-4000-8000-000000000001';
const PATIENT_ID = '1f0e2c4a-0000-4000-8000-000000000002';
const doctor = Keypair.random().publicKey();
const patient = Keypair.random().publicKey();

const session = (user_id: string, join_time: number, duration: number): DailyParticipant => ({
  user_id,
  participant_id: `${user_id}-${join_time}`,
  user_name: null,
  join_time,
  duration,
});

const attendance = (participants: DailyParticipant[]): AppointmentAttendance => ({
  appointmentId: 'appt-42',
  doctorAddress: doctor,
  patientAddress: patient,
  scheduledStart: new Date(START * 1000).toISOString(),
  scheduledEnd: new Date(END * 1000).toISOString(),
  doctorUserId: DOCTOR_ID,
  patientUserId: PATIENT_ID,
  participants,
});

/** Signs the attestation the way the oracle service does: ed25519 over the contracttype ScVal XDR. */
function sign(a: DisputeAttestation) {
  const scVal = nativeToScVal(
    {
      appointment_id: a.appointmentId,
      arbitration_contract: a.arbitrationContract,
      doctor: a.doctor,
      doctor_joined_at: a.doctorJoinedAt === null ? null : BigInt(a.doctorJoinedAt),
      issued_at: BigInt(a.issuedAt),
      patient: a.patient,
      patient_joined_at: a.patientJoinedAt === null ? null : BigInt(a.patientJoinedAt),
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
  return { attestation: a, signature: oracle.sign(scVal.toXDR()).toString('hex') };
}

const noShowAttestation = (overrides: Partial<DisputeAttestation> = {}): DisputeAttestation => ({
  appointmentId: 'appt-42',
  arbitrationContract: contractId,
  doctor,
  patient,
  scheduledStart: START,
  doctorJoinedAt: null,
  patientJoinedAt: START + 60,
  verdict: 'DOCTOR_NO_SHOW',
  issuedAt: START + 3600,
  ...overrides,
});

describe('evaluateAttendance', () => {
  const afterEnd = END + 1;

  it('flags a doctor no-show when the doctor never joins within 15 minutes', () => {
    const result = evaluateAttendance(
      attendance([session(PATIENT_ID, START + 60, 1700)]),
      afterEnd,
    );
    expect(result).toEqual({
      verdict: 'DOCTOR_NO_SHOW',
      doctorJoinedAt: null,
      patientJoinedAt: START + 60,
    });
  });

  it('treats a doctor joining after the 15-minute grace as a no-show', () => {
    const late = START + DOCTOR_JOIN_GRACE_SECONDS + 15;
    const result = evaluateAttendance(
      attendance([session(DOCTOR_ID, late, 600), session(PATIENT_ID, START, 1800)]),
      afterEnd,
    );
    expect(result.verdict).toBe('DOCTOR_NO_SHOW');
  });

  it('accepts a doctor joining exactly at the grace deadline', () => {
    const result = evaluateAttendance(
      attendance([
        session(DOCTOR_ID, START + DOCTOR_JOIN_GRACE_SECONDS, 600),
        session(PATIENT_ID, START, 1800),
      ]),
      afterEnd,
    );
    expect(result.verdict).toBe('ATTENDED');
  });

  it('counts a doctor who joined early and stayed, but not one who left before the start', () => {
    const stayed = evaluateAttendance(
      attendance([session(DOCTOR_ID, START - 300, 900), session(PATIENT_ID, START, 60)]),
      afterEnd,
    );
    const left = evaluateAttendance(
      attendance([session(DOCTOR_ID, START - 600, 300), session(PATIENT_ID, START, 60)]),
      afterEnd,
    );

    expect(stayed).toEqual({
      verdict: 'ATTENDED',
      doctorJoinedAt: START - 300,
      patientJoinedAt: START,
    });
    expect(left.verdict).toBe('DOCTOR_NO_SHOW');
  });

  it('uses the earliest qualifying session across reconnects and ignores unknown participants', () => {
    const result = evaluateAttendance(
      attendance([
        session(DOCTOR_ID, START + 400, 100),
        session('someone-else', START, 1800),
        session(DOCTOR_ID, START + 120, 100),
        session(PATIENT_ID, START + 30, 1800),
      ]),
      afterEnd,
    );
    expect(result).toEqual({
      verdict: 'ATTENDED',
      doctorJoinedAt: START + 120,
      patientJoinedAt: START + 30,
    });
  });

  it('flags a patient no-show only after the appointment ends', () => {
    const log = attendance([session(DOCTOR_ID, START, 1800)]);
    expect(evaluateAttendance(log, END - 1).verdict).toBe('PENDING');
    expect(evaluateAttendance(log, END).verdict).toBe('PATIENT_NO_SHOW');
  });

  it('stays pending until the grace window has passed', () => {
    const log = attendance([]);
    expect(evaluateAttendance(log, START + DOCTOR_JOIN_GRACE_SECONDS - 1).verdict).toBe('PENDING');
    expect(evaluateAttendance(log, START + DOCTOR_JOIN_GRACE_SECONDS).verdict).toBe(
      'DOCTOR_NO_SHOW',
    );
  });
});

describe('verifyDisputeAttestation', () => {
  const log = attendance([session(PATIENT_ID, START + 60, 1700)]);
  const evaluation = evaluateAttendance(log, END + 1);

  it('accepts an oracle-signed attestation that matches the call log', () => {
    expect(() =>
      verifyDisputeAttestation(sign(noShowAttestation()), log, evaluation),
    ).not.toThrow();
  });

  it('rejects a signature from a key other than the oracle', () => {
    const forged = {
      ...sign(noShowAttestation()),
      signature: Keypair.random().sign(Buffer.from('x')).toString('hex'),
    };
    expect(() => verifyDisputeAttestation(forged, log, evaluation)).toThrow(
      'not from the Heliora oracle',
    );
  });

  it('rejects an attestation altered after signing', () => {
    const signed = sign(noShowAttestation());
    const altered = { ...signed, attestation: { ...signed.attestation, patientJoinedAt: null } };
    expect(() => verifyDisputeAttestation(altered, log, evaluation)).toThrow(
      'not from the Heliora oracle',
    );
  });

  it('rejects a validly signed attestation for another contract or a different verdict', () => {
    const otherContract = sign(
      noShowAttestation({ arbitrationContract: StrKey.encodeContract(Buffer.alloc(32, 9)) }),
    );
    const attended = sign(noShowAttestation({ verdict: 'ATTENDED' }));
    expect(() => verifyDisputeAttestation(otherContract, log, evaluation)).toThrow(
      'does not match',
    );
    expect(() => verifyDisputeAttestation(attended, log, evaluation)).toThrow('does not match');
  });
});

describe('buildResolveNoShowOperation', () => {
  it('invokes resolve_no_show(attestation, signature) on the arbitration contract', () => {
    const signed = sign(noShowAttestation());
    const op = buildResolveNoShowOperation(signed);

    const invoke = op.body().invokeHostFunctionOp().hostFunction().invokeContract();
    const [attestationArg, signatureArg] = invoke.args() as [xdr.ScVal, xdr.ScVal];

    expect(invoke.functionName().toString()).toBe('resolve_no_show');
    expect(StrKey.encodeContract(invoke.contractAddress().contractId() as unknown as Buffer)).toBe(
      contractId,
    );
    expect(scValToNative(attestationArg)).toEqual({
      appointment_id: 'appt-42',
      arbitration_contract: contractId,
      doctor,
      doctor_joined_at: null,
      issued_at: BigInt(START + 3600),
      patient,
      patient_joined_at: BigInt(START + 60),
      scheduled_start: BigInt(START),
      verdict: 'DOCTOR_NO_SHOW',
    });
    expect(Buffer.from(scValToNative(signatureArg)).toString('hex')).toBe(signed.signature);
    expect(signatureArg.bytes()).toHaveLength(64);
  });
});
