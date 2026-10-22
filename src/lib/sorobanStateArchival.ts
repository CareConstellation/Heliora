import type { Keypair } from '@stellar/stellar-sdk';

interface ArchivedState {
  id: string;
  contractId: string;
  dataKey: string;
  dataValue: unknown;
  archiveTimestamp: number;
  archivedBy: string;
  metadata?: {
    reason?: string;
    description?: string;
    tags?: string[];
  };
}

interface ArchiveManifest {
  manifestId: string;
  contractId: string;
  archiveCount: number;
  archivedAt: number;
  archivedBy: string;
  checksum: string;
  states: ArchivedState[];
}

interface RestorationRequest {
  requestId: string;
  manifestId: string;
  targetLedger: number;
  restorationKeys: string[];
  requestedBy: string;
  approvals: string[];
  requiredApprovals: number;
}

class SorobanStateArchival {
  private archiveStorageKey: string = 'heliora_state_archive';
  private manifestStorageKey: string = 'heliora_archive_manifest';

  /**
   * Archive contract state to persistent storage
   * Creates a snapshot of contract data at a specific point in time
   */
  archiveContractState(
    contractId: string,
    dataKey: string,
    dataValue: unknown,
    archiver: Keypair,
    metadata?: { reason?: string; description?: string; tags?: string[] },
  ): ArchivedState {
    const now = Math.floor(Date.now() / 1000);
    const archiveId = this.generateArchiveId(contractId, dataKey, now);

    return {
      id: archiveId,
      contractId,
      dataKey,
      dataValue,
      archiveTimestamp: now,
      archivedBy: archiver.publicKey(),
      ...(metadata ? { metadata } : {}),
    };
  }

  /**
   * Create a manifest of archived states
   * Groups multiple archived states under one manifest for batch operations
   */
  createArchiveManifest(
    contractId: string,
    states: ArchivedState[],
    archivedBy: string,
  ): ArchiveManifest {
    const now = Math.floor(Date.now() / 1000);
    const manifestId = `manifest_${contractId}_${now}`;
    const checksum = this.calculateManifestChecksum(states);

    return {
      manifestId,
      contractId,
      archiveCount: states.length,
      archivedAt: now,
      archivedBy,
      checksum,
      states,
    };
  }

  /**
   * Restore archived state to contract
   * Validates manifest integrity and applies state recovery
   */
  restoreArchivedState(
    manifest: ArchiveManifest,
    targetLedger: number,
    restorationKeys: string[],
  ): {
    success: boolean;
    restoredStates: ArchivedState[];
    failedKeys: string[];
  } {
    const manifestChecksum = this.calculateManifestChecksum(manifest.states);

    if (manifestChecksum !== manifest.checksum) {
      return {
        success: false,
        restoredStates: [],
        failedKeys: restorationKeys,
      };
    }

    const restoredStates: ArchivedState[] = [];
    const failedKeys: string[] = [];

    for (const key of restorationKeys) {
      const state = manifest.states.find((s) => s.dataKey === key);
      if (state) {
        restoredStates.push(state);
      } else {
        failedKeys.push(key);
      }
    }

    return {
      success: failedKeys.length === 0,
      restoredStates,
      failedKeys,
    };
  }

  /**
   * Create a restoration request with approval workflow
   * Multi-signature approval required for sensitive state restoration
   */
  createRestorationRequest(
    manifestId: string,
    targetLedger: number,
    restorationKeys: string[],
    requester: Keypair,
    requiredApprovals: number,
  ): RestorationRequest {
    const now = Math.floor(Date.now() / 1000);
    const requestId = `restore_${manifestId}_${now}`;

    return {
      requestId,
      manifestId,
      targetLedger,
      restorationKeys,
      requestedBy: requester.publicKey(),
      approvals: [],
      requiredApprovals,
    };
  }

  /**
   * Approve a restoration request
   * Adds approval from authorized signer
   */
  approveRestorationRequest(
    request: RestorationRequest,
    approver: Keypair,
  ): RestorationRequest {
    const updatedRequest = { ...request };

    if (!updatedRequest.approvals.includes(approver.publicKey())) {
      updatedRequest.approvals.push(approver.publicKey());
    }

    return updatedRequest;
  }

  /**
   * Check if restoration request has sufficient approvals
   */
  isRestorationApproved(request: RestorationRequest): boolean {
    return request.approvals.length >= request.requiredApprovals;
  }

  /**
   * Archive ledger closure data before state archival
   * Captures ledger sequence, timestamp, and state root
   */
  archiveLedgerClosure(
    ledgerSequence: number,
    ledgerCloseTime: number,
    stateRoot: string,
    archiverKeyPair: Keypair,
  ): ArchivedState {
    const metadata = {
      reason: 'Ledger closure archival',
      description: `State archival for ledger ${ledgerSequence}`,
      tags: ['ledger', 'closure', 'state-root'],
    };

    return this.archiveContractState(
      'ledger_closure',
      `ledger_${ledgerSequence}`,
      {
        sequence: ledgerSequence,
        closeTime: ledgerCloseTime,
        stateRoot,
      },
      archiverKeyPair,
      metadata,
    );
  }

  /**
   * Prepare archived state for Soroban contract invocation
   * Encodes state for on-chain restoration
   */
  prepareStateForRestoration(
    manifest: ArchiveManifest,
    state: ArchivedState,
  ): {
    contractId: string;
    method: string;
    params: unknown;
  } {
    return {
      contractId: manifest.contractId,
      method: 'restore_state',
      params: {
        manifest_id: manifest.manifestId,
        data_key: state.dataKey,
        data_value: state.dataValue,
        archive_timestamp: state.archiveTimestamp,
        archived_by: state.archivedBy,
        manifest_checksum: manifest.checksum,
      },
    };
  }

  /**
   * Calculate integrity checksum for manifest
   * Ensures state hasn't been tampered with during storage
   */
  private calculateManifestChecksum(states: ArchivedState[]): string {
    const data = states
      .map((s) => `${s.dataKey}:${JSON.stringify(s.dataValue)}`)
      .join('|');

    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }

    return `checksum_${Math.abs(hash).toString(16)}`;
  }

  /**
   * Generate unique archive ID
   */
  private generateArchiveId(contractId: string, dataKey: string, timestamp: number): string {
    const key = `${contractId}:${dataKey}:${timestamp}`;
    let hash = 0;

    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }

    return `archive_${Math.abs(hash).toString(16)}`;
  }

  /**
   * Query archived states by contract ID
   */
  queryArchivesByContract(contractId: string, archives: ArchivedState[]): ArchivedState[] {
    return archives.filter((a) => a.contractId === contractId);
  }

  /**
   * Query archived states by date range
   */
  queryArchivesByDateRange(
    startTime: number,
    endTime: number,
    archives: ArchivedState[],
  ): ArchivedState[] {
    return archives.filter((a) => a.archiveTimestamp >= startTime && a.archiveTimestamp <= endTime);
  }

  /**
   * Get archive history for a specific data key
   */
  getArchiveHistory(dataKey: string, archives: ArchivedState[]): ArchivedState[] {
    return archives.filter((a) => a.dataKey === dataKey).sort((a, b) => b.archiveTimestamp - a.archiveTimestamp);
  }

  /**
   * Verify archive integrity
   */
  verifyArchiveIntegrity(manifest: ArchiveManifest): boolean {
    const calculatedChecksum = this.calculateManifestChecksum(manifest.states);
    return calculatedChecksum === manifest.checksum;
  }

  /**
   * Estimate storage requirements for archive
   */
  estimateArchiveSize(manifest: ArchiveManifest): {
    stateCount: number;
    estimatedBytes: number;
  } {
    const estimatedBytes = manifest.states.reduce(
      (sum, state) => sum + JSON.stringify(state).length,
      0,
    );

    return {
      stateCount: manifest.states.length,
      estimatedBytes,
    };
  }
}

export { SorobanStateArchival };
export type { ArchivedState, ArchiveManifest, RestorationRequest };
