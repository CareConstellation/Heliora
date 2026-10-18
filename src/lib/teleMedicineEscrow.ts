/**
 * Soroban escrow contract for telemedicine consultation payments.
 * Releases escrow upon consultation completion.
 * (Issue #4)
 */

import { Contract, Address, nativeToScVal } from '@stellar/stellar-sdk';

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
}

/**
 * Creates a new escrow for a telemedicine consultation.
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
      requiredSignatures: 1, // At least one party must sign completion
      signedBy: [],
      expiresAt,
    },
  };
}

/**
 * Marks a consultation as completed by signing the release condition.
 */
export function completeConsultation(
  escrow: TeleMedicineEscrow,
  signerAddress: string,
): TeleMedicineEscrow {
  if (escrow.status !== EscrowStatus.Locked) {
    throw new Error(`Cannot complete consultation: escrow status is ${escrow.status}`);
  }
  
  const updatedEscrow = { ...escrow };
  
  // Record signer
  if (!updatedEscrow.releaseCondition.signedBy.includes(signerAddress)) {
    updatedEscrow.releaseCondition.signedBy.push(signerAddress);
  }
  
  // Mark completion time if threshold met
  if (updatedEscrow.releaseCondition.signedBy.length >= updatedEscrow.releaseCondition.requiredSignatures) {
    updatedEscrow.releaseCondition.consultationCompletedAt = Math.floor(Date.now() / 1000);
  }
  
  return updatedEscrow;
}

/**
 * Checks if an escrow can be released based on completion status.
 */
export function canReleaseEscrow(escrow: TeleMedicineEscrow): boolean {
  if (escrow.status !== EscrowStatus.Locked) {
    return false;
  }
  
  const isConsultationComplete =
    escrow.releaseCondition.signedBy.length >= escrow.releaseCondition.requiredSignatures;
  
  const isNotExpired = Math.floor(Date.now() / 1000) <= escrow.releaseCondition.expiresAt;
  
  return isConsultationComplete && isNotExpired;
}

/**
 * Releases funds from escrow to the doctor.
 */
export function releaseEscrowFunds(escrow: TeleMedicineEscrow): TeleMedicineEscrow {
  if (!canReleaseEscrow(escrow)) {
    throw new Error('Escrow cannot be released at this time');
  }
  
  return {
    ...escrow,
    status: EscrowStatus.Released,
    releasedAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Refunds escrow to patient if consultation is not completed in time.
 */
export function refundEscrow(escrow: TeleMedicineEscrow): TeleMedicineEscrow {
  const now = Math.floor(Date.now() / 1000);
  const isExpired = now > escrow.releaseCondition.expiresAt;
  
  if (!isExpired && escrow.releaseCondition.signedBy.length > 0) {
    throw new Error('Cannot refund: consultation was started');
  }
  
  return {
    ...escrow,
    status: isExpired ? EscrowStatus.Expired : EscrowStatus.Refunded,
    releasedAt: now,
  };
}

/**
 * Builds Soroban contract invocation to lock funds in escrow.
 */
export function buildLockEscrowInvocation(contractId: string, escrow: TeleMedicineEscrow) {
  const contract = new Contract(contractId);
  const patientAddr = new Address(escrow.patientAddress);
  const doctorAddr = new Address(escrow.doctorAddress);
  
  return contract.call('lock_consultation_escrow', [
    patientAddr,
    doctorAddr,
    escrow.consultationId,
    escrow.amountStroops,
    escrow.releaseCondition.expiresAt,
  ]);
}

/**
 * Builds Soroban contract invocation to release escrow to doctor.
 */
export function buildReleaseEscrowInvocation(
  contractId: string,
  escrowId: string,
  doctorAddress: string,
) {
  const contract = new Contract(contractId);
  const doctorAddr = new Address(doctorAddress);
  
  return contract.call('release_escrow', [escrowId, doctorAddr]);
}

/**
 * Builds Soroban contract invocation to refund escrow to patient.
 */
export function buildRefundEscrowInvocation(contractId: string, escrowId: string, patientAddress: string) {
  const contract = new Contract(contractId);
  const patientAddr = new Address(patientAddress);
  
  return contract.call('refund_escrow', [escrowId, patientAddr]);
}

/**
 * Calculates the amount to be released to the doctor in XLM.
 */
export function calculateReleaseAmount(escrowAmountStroops: string, platformFeePercent: number = 5): {
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
    case EscrowStatus.Locked:
      if (canReleaseEscrow(escrow)) {
        return 'Ready to release';
      }
      const signed = escrow.releaseCondition.signedBy.length;
      const required = escrow.releaseCondition.requiredSignatures;
      return `Waiting for completion (${signed}/${required})`;
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
