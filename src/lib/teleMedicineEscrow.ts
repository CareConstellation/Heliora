/**
 * Soroban escrow contract for telemedicine consultation payments.
 * Releases escrow upon consultation completion (Issue #4, Issue #189).
 */

import { Contract, Address, nativeToScVal } from '@stellar/stellar-sdk';

export const DISPUTE_WINDOW_SECONDS = 72 * 3600; // 72 hours in seconds (259,200s)

export interface TeleMedicineEscrow {
  escrowId: string;
  patientAddress: string;
  doctorAddress: string;
  consultationId: string;
  amountStroops: string;
  status: EscrowStatus;
  createdAt: number;
  releaseCondition: ReleaseCondition;
  releasedAt?: number;
  transactionHash?: string;
}

export enum EscrowStatus {
  Locked = 'locked',
  Released = 'released',
  Refunded = 'refunded',
  Expired = 'expired',
}

export interface ReleaseCondition {
  consultationCompletedAt?: number;
  requiredSignatures: number;
  signedBy: string[];
  expiresAt: number;
  doctorSignedAt?: number;
  patientSignedAt?: number;
  disputeFiled?: boolean;
  disputeWindowExpiresAt?: number;
  noShowReportedAt?: number;
}

/**
 * Creates a new escrow for a telemedicine consultation.
 * Defaults to dual-party signature requirement (both Doctor and Patient).
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function createTeleMedicineEscrow(
  patientAddress: string,
  doctorAddress: string,
  consultationId: string,
  amountStroops: string,
  consultationDurationMinutes: number = 30,
): TeleMedicineEscrow {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + consultationDurationMinutes * 60 + 3600; // 1 hour buffer after consultation

  return {
    escrowId: generateEscrowId(),
    patientAddress,
    doctorAddress,
    consultationId,
    amountStroops,
    status: EscrowStatus.Locked,
    createdAt: now,
    releaseCondition: {
      requiredSignatures: 2, // Dual-party: patient + doctor
      signedBy: [],
      expiresAt,
      disputeFiled: false,
    },
  };
}

/**
 * Marks consultation as completed by a participating party (Doctor or Patient).
 * When Doctor signs, starts the 72-hour dispute-free window.
 * When both Doctor and Patient sign, dual-party completion is achieved.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function completeConsultation(
  escrow: TeleMedicineEscrow,
  signerAddress: string,
  now: number = Math.floor(Date.now() / 1000),
): TeleMedicineEscrow {
  if (escrow.status !== EscrowStatus.Locked) {
    throw new Error(`Cannot complete consultation: escrow status is ${escrow.status}`);
  }

  const updatedEscrow: TeleMedicineEscrow = {
    ...escrow,
    releaseCondition: {
      ...escrow.releaseCondition,
      signedBy: [...escrow.releaseCondition.signedBy],
    },
  };

  if (!updatedEscrow.releaseCondition.signedBy.includes(signerAddress)) {
    updatedEscrow.releaseCondition.signedBy.push(signerAddress);
  }

  if (signerAddress === escrow.doctorAddress) {
    updatedEscrow.releaseCondition.doctorSignedAt = now;
    // Set 72-hour dispute-free window from doctor's completion signature
    updatedEscrow.releaseCondition.disputeWindowExpiresAt = now + DISPUTE_WINDOW_SECONDS;
  }

  if (signerAddress === escrow.patientAddress) {
    updatedEscrow.releaseCondition.patientSignedAt = now;
  }

  const hasBoth =
    updatedEscrow.releaseCondition.signedBy.includes(escrow.doctorAddress) &&
    updatedEscrow.releaseCondition.signedBy.includes(escrow.patientAddress);

  if (hasBoth) {
    updatedEscrow.releaseCondition.consultationCompletedAt = now;
  }

  return updatedEscrow;
}

/**
 * Checks if an escrow can be released based on:
 * 1) Dual-party visit completion (both Doctor & Patient signed), OR
 * 2) 72-hour dispute-free window elapsed following doctor's completion signature without active dispute.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function canReleaseEscrow(
  escrow: TeleMedicineEscrow,
  currentTime: number = Math.floor(Date.now() / 1000),
): boolean {
  if (escrow.status !== EscrowStatus.Locked) {
    return false;
  }

  if (escrow.releaseCondition.disputeFiled) {
    return false;
  }

  // 1. Dual-party visit completion
  const hasDoctorSigned =
    Boolean(escrow.releaseCondition.doctorSignedAt) ||
    escrow.releaseCondition.signedBy.includes(escrow.doctorAddress);
  const hasPatientSigned =
    Boolean(escrow.releaseCondition.patientSignedAt) ||
    escrow.releaseCondition.signedBy.includes(escrow.patientAddress);

  if (hasDoctorSigned && hasPatientSigned) {
    return true;
  }

  // 2. 72-hour dispute-free window elapsed after doctor's completion signature
  if (
    hasDoctorSigned &&
    escrow.releaseCondition.disputeWindowExpiresAt &&
    currentTime >= escrow.releaseCondition.disputeWindowExpiresAt
  ) {
    return true;
  }

  // Backwards compatibility for single-signature configuration
  if (
    escrow.releaseCondition.requiredSignatures === 1 &&
    escrow.releaseCondition.signedBy.length >= 1 &&
    currentTime <= escrow.releaseCondition.expiresAt
  ) {
    return true;
  }

  return false;
}

/**
 * Releases funds from escrow to the doctor.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function releaseEscrowFunds(
  escrow: TeleMedicineEscrow,
  now: number = Math.floor(Date.now() / 1000),
): TeleMedicineEscrow {
  if (!canReleaseEscrow(escrow, now)) {
    throw new Error('Escrow cannot be released at this time');
  }

  return {
    ...escrow,
    status: EscrowStatus.Released,
    releasedAt: now,
  };
}

/**
 * Checks whether a patient can claim a refund due to doctor no-show.
 * Eligible if patient was present, doctor did not sign completion, and no-show is recorded or time expired.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function canRefundDoctorNoShow(
  escrow: TeleMedicineEscrow,
  currentTime: number = Math.floor(Date.now() / 1000),
): boolean {
  if (escrow.status !== EscrowStatus.Locked) {
    return false;
  }

  const doctorSigned =
    Boolean(escrow.releaseCondition.doctorSignedAt) ||
    escrow.releaseCondition.signedBy.includes(escrow.doctorAddress);

  // If doctor already signed completion, no-show refund cannot be claimed directly
  if (doctorSigned) {
    return false;
  }

  // If patient explicitly reported doctor no-show or consultation window expired without doctor
  const reportedNoShow = Boolean(escrow.releaseCondition.noShowReportedAt);
  const isPastExpiry = currentTime > escrow.releaseCondition.expiresAt;

  return reportedNoShow || isPastExpiry;
}

/**
 * Reports doctor no-show by the patient.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function reportDoctorNoShow(
  escrow: TeleMedicineEscrow,
  patientAddress: string,
  now: number = Math.floor(Date.now() / 1000),
): TeleMedicineEscrow {
  if (escrow.status !== EscrowStatus.Locked) {
    throw new Error(`Cannot report no-show: escrow is ${escrow.status}`);
  }

  if (patientAddress !== escrow.patientAddress) {
    throw new Error('Only the patient of this consultation can report a doctor no-show');
  }

  const doctorSigned =
    Boolean(escrow.releaseCondition.doctorSignedAt) ||
    escrow.releaseCondition.signedBy.includes(escrow.doctorAddress);

  if (doctorSigned) {
    throw new Error('Cannot report doctor no-show: doctor has already recorded visit completion');
  }

  return {
    ...escrow,
    releaseCondition: {
      ...escrow.releaseCondition,
      noShowReportedAt: now,
    },
  };
}

/**
 * Executes patient refund for doctor no-show.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function refundPatientOnNoShow(
  escrow: TeleMedicineEscrow,
  patientAddress: string,
  now: number = Math.floor(Date.now() / 1000),
): TeleMedicineEscrow {
  if (patientAddress !== escrow.patientAddress) {
    throw new Error('Refund recipient must be the consultation patient');
  }

  if (!canRefundDoctorNoShow(escrow, now)) {
    throw new Error('Conditions for doctor no-show refund are not satisfied');
  }

  return {
    ...escrow,
    status: EscrowStatus.Refunded,
    releasedAt: now,
  };
}

/**
 * Refunds escrow to patient if consultation is not completed in time or cancelled.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function refundEscrow(
  escrow: TeleMedicineEscrow,
  now: number = Math.floor(Date.now() / 1000),
): TeleMedicineEscrow {
  const isExpired = now > escrow.releaseCondition.expiresAt;

  if (!isExpired && escrow.releaseCondition.signedBy.length > 0 && !canRefundDoctorNoShow(escrow, now)) {
    throw new Error('Cannot refund: consultation was started and active');
  }

  return {
    ...escrow,
    status: isExpired ? EscrowStatus.Expired : EscrowStatus.Refunded,
    releasedAt: now,
  };
}

/**
 * Builds Soroban contract invocation to lock consultation fee in escrow (#189).
 * Method: lock_consultation_fee
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function buildLockConsultationFeeInvocation(
  contractId: string,
  params: {
    patientAddress: string;
    doctorAddress: string;
    consultationId: string;
    amountStroops: string | bigint;
    expiresAt?: number;
    disputeWindowSeconds?: number;
  },
) {
  const contract = new Contract(contractId);
  const patientAddr = new Address(params.patientAddress);
  const doctorAddr = new Address(params.doctorAddress);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = params.expiresAt ?? now + 7200; // 2 hour default
  const disputeWindow = params.disputeWindowSeconds ?? DISPUTE_WINDOW_SECONDS;

  return contract.call(
    'lock_consultation_fee',
    patientAddr.toScVal(),
    doctorAddr.toScVal(),
    nativeToScVal(params.consultationId),
    nativeToScVal(BigInt(params.amountStroops.toString())),
    nativeToScVal(expiresAt),
    nativeToScVal(disputeWindow),
  );
}

/**
 * Builds Soroban contract invocation to lock funds in escrow (backwards compatibility).
 */
export function buildLockEscrowInvocation(contractId: string, escrow: TeleMedicineEscrow) {
  const contract = new Contract(contractId);
  const patientAddr = new Address(escrow.patientAddress);
  const doctorAddr = new Address(escrow.doctorAddress);

  return contract.call(
    'lock_consultation_fee',
    patientAddr.toScVal(),
    doctorAddr.toScVal(),
    nativeToScVal(escrow.consultationId),
    nativeToScVal(BigInt(escrow.amountStroops)),
    nativeToScVal(escrow.releaseCondition.expiresAt),
    nativeToScVal(DISPUTE_WINDOW_SECONDS),
  );
}

/**
 * Builds Soroban contract invocation to release escrow fee to doctor (#189).
 * Method: release_fee
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function buildReleaseFeeInvocation(
  contractId: string,
  escrowId: string,
  doctorAddress: string,
) {
  const contract = new Contract(contractId);
  const doctorAddr = new Address(doctorAddress);

  return contract.call('release_fee', nativeToScVal(escrowId), doctorAddr.toScVal());
}

/**
 * Builds Soroban contract invocation to release escrow to doctor (backwards compatibility).
 */
export function buildReleaseEscrowInvocation(
  contractId: string,
  escrowId: string,
  doctorAddress: string,
) {
  return buildReleaseFeeInvocation(contractId, escrowId, doctorAddress);
}

/**
 * Builds Soroban contract invocation to refund patient on doctor no-show (#189).
 * Method: refund_patient
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function buildRefundPatientInvocation(
  contractId: string,
  escrowId: string,
  patientAddress: string,
  reason: string = 'doctor_no_show',
) {
  const contract = new Contract(contractId);
  const patientAddr = new Address(patientAddress);

  return contract.call(
    'refund_patient',
    nativeToScVal(escrowId),
    patientAddr.toScVal(),
    nativeToScVal(reason),
  );
}

/**
 * Builds Soroban contract invocation to refund escrow to patient (backwards compatibility).
 */
export function buildRefundEscrowInvocation(
  contractId: string,
  escrowId: string,
  patientAddress: string,
) {
  return buildRefundPatientInvocation(contractId, escrowId, patientAddress, 'refund_requested');
}

/**
 * Calculates the amount to be released to the doctor in XLM.
 */
export function calculateReleaseAmount(
  escrowAmountStroops: string,
  platformFeePercent: number = 5,
): {
  doctorAmount: string;
  platformFee: string;
} {
  const amount = BigInt(escrowAmountStroops);
  const feeAmount = (amount * BigInt(platformFeePercent)) / BigInt(100);
  const doctorAmount = amount - feeAmount;

  return {
    doctorAmount: doctorAmount.toString(),
    platformFee: feeAmount.toString(),
  };
}

/**
 * Generates a unique escrow ID.
 */
function generateEscrowId(): string {
  return `escrow_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Formats escrow status for display.
 */
export function formatEscrowStatus(escrow: TeleMedicineEscrow): string {
  switch (escrow.status) {
    case EscrowStatus.Locked: {
      if (canReleaseEscrow(escrow)) {
        return 'Ready to release';
      }
      const hasDoc = Boolean(escrow.releaseCondition.doctorSignedAt);
      const hasPat = Boolean(escrow.releaseCondition.patientSignedAt);
      if (hasDoc && !hasPat) {
        return 'Doctor completed; awaiting patient or 72h dispute window';
      }
      if (!hasDoc && hasPat) {
        return 'Patient completed; awaiting doctor confirmation';
      }
      return 'Waiting for consultation completion (0/2)';
    }
    case EscrowStatus.Released:
      return `Released on ${new Date(escrow.releasedAt! * 1000).toLocaleDateString()}`;
    case EscrowStatus.Refunded:
      return `Refunded on ${new Date(escrow.releasedAt! * 1000).toLocaleDateString()}`;
    case EscrowStatus.Expired:
      return 'Expired - automatic refund triggered';
    default:
      return escrow.status;
  }
}

