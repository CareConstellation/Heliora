import { Contract, Address, nativeToScVal } from '@stellar/stellar-sdk';

export interface CollaboratorRevocation {
  collaboratorId: string;
  collaboratorAddress: string;
  recordIds: string[];
}

export interface BatchRevocationConfig {
  contractId: string;
  ownerAddress: string;
  revocations: CollaboratorRevocation[];
  estimatedFee?: number;
}

const BASE_OPERATION_FEE = 100; // stroops
const FEE_PER_REVOCATION = 50; // stroops

export function calculateResourceSavings(revocationCount: number): {
  batchCost: number;
  individualCost: number;
  savings: number;
  percentSavings: number;
} {
  const batchCost = BASE_OPERATION_FEE + revocationCount * FEE_PER_REVOCATION;
  const individualCost = revocationCount * BASE_OPERATION_FEE * 2; // 2 operations per revocation

  return {
    batchCost,
    individualCost,
    savings: individualCost - batchCost,
    percentSavings: Math.round(((individualCost - batchCost) / individualCost) * 100),
  };
}

export function buildBatchRevocationOperation(config: BatchRevocationConfig): any {
  const contract = new Contract(config.contractId);
  const ownerAddress = new Address(config.ownerAddress);

  const revokeAllInvocations = config.revocations.map(revocation => {
    const collaboratorAddress = new Address(revocation.collaboratorAddress);

    return contract.call(
      'revoke_record_access',
      ownerAddress.toScVal(),
      collaboratorAddress.toScVal(),
      nativeToScVal(revocation.recordIds),
    );
  });

  return revokeAllInvocations;
}

export function estimateBatchRevocationFee(collaboratorCount: number, recordsPerCollaborator: number): number {
  const totalRecords = collaboratorCount * recordsPerCollaborator;
  const { batchCost } = calculateResourceSavings(totalRecords);
  return batchCost;
}

export interface BatchRevocationResult {
  transactionHash: string;
  ledgerSequence: number;
  revokedCount: number;
  failedCount: number;
}

export function formatBatchRevocationSummary(
  revocationCount: number,
  resourceSavings: ReturnType<typeof calculateResourceSavings>
): string {
  return `Revoke ${revocationCount} permission(s) in a single transaction. Save approximately ${resourceSavings.percentSavings}% in fees (${(resourceSavings.savings / 1e7).toFixed(4)} XLM).`;
}
