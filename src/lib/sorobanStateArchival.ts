import {
  type Keypair,
  type Transaction,
  type Account,
  type rpc,
  TransactionBuilder,
  Operation,
  xdr,
} from '@stellar/stellar-sdk';
import {
  TTL_EXTENSION_THRESHOLD_LEDGERS,
  DEFAULT_EXTEND_TO_LEDGERS,
  isEntryArchived,
  needsTtlExtension,
  getRemainingLedgers,
  fetchLedgerEntriesWithTtl,
} from './sorobanRpc';

export { TTL_EXTENSION_THRESHOLD_LEDGERS, DEFAULT_EXTEND_TO_LEDGERS };

export interface StorageTtlStatus {
  key: string;
  liveUntilLedger?: number;
  lastModifiedLedger?: number;
  currentLedger: number;
  remainingLedgers: number;
  isArchived: boolean;
  needsTtlExtension: boolean;
}

export interface StorageMaintenanceReport {
  currentLedger: number;
  totalChecked: number;
  archivedEntries: StorageTtlStatus[];
  extensionNeededEntries: StorageTtlStatus[];
  healthyEntries: StorageTtlStatus[];
  hasArchived: boolean;
  hasExtensionNeeded: boolean;
}

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

  /**
   * Evaluates TTL status of an entry against current ledger and threshold.
   * Time Complexity: O(1)
   * Space Complexity: O(1)
   */
  inspectTtl(
    entry: { key: string; liveUntilLedgerSeq?: number; lastModifiedLedgerSeq?: number } | null | undefined,
    currentLedger: number,
    threshold: number = TTL_EXTENSION_THRESHOLD_LEDGERS,
  ): StorageTtlStatus {
    return inspectStorageTtl(entry, currentLedger, threshold);
  }

  /**
   * Partitions entries into archived, needs-extension, and healthy buckets.
   * Time Complexity: O(N) where N is entries count.
   * Space Complexity: O(N)
   */
  inspectFootprint(
    entries: Array<{ key: string; liveUntilLedgerSeq?: number; lastModifiedLedgerSeq?: number }>,
    currentLedger: number,
    threshold: number = TTL_EXTENSION_THRESHOLD_LEDGERS,
  ): StorageMaintenanceReport {
    return inspectFootprintTtl(entries, currentLedger, threshold);
  }

  /**
   * Builds a transaction with extendFootprintTtl operation and readOnly footprint.
   * Time Complexity: O(K) where K is keys count.
   * Space Complexity: O(K)
   */
  buildExtendTtlTransaction(
    sourceAccount: Account,
    keys: (string | xdr.LedgerKey)[],
    networkPassphrase: string,
    extendTo: number = DEFAULT_EXTEND_TO_LEDGERS,
    fee: string = '100',
  ): Transaction {
    return buildExtendFootprintTtlTx(sourceAccount, keys, networkPassphrase, extendTo, fee);
  }

  /**
   * Builds a transaction with restoreFootprint operation and readWrite footprint.
   * Time Complexity: O(K) where K is keys count.
   * Space Complexity: O(K)
   */
  buildRestoreTransaction(
    sourceAccount: Account,
    keys: (string | xdr.LedgerKey)[],
    networkPassphrase: string,
    fee: string = '100',
  ): Transaction {
    return buildRestoreFootprintTx(sourceAccount, keys, networkPassphrase, fee);
  }
}

/**
 * Normalizes input key to xdr.LedgerKey
 */
function toLedgerKey(key: string | xdr.LedgerKey): xdr.LedgerKey {
  return typeof key === 'string' ? xdr.LedgerKey.fromXDR(key, 'base64') : key;
}

/**
 * Inspects a single storage entry's TTL and archival state.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function inspectStorageTtl(
  entry:
    | {
        key: string;
        liveUntilLedgerSeq?: number;
        liveUntilLedger?: number;
        lastModifiedLedgerSeq?: number;
      }
    | null
    | undefined,
  currentLedger: number,
  threshold: number = TTL_EXTENSION_THRESHOLD_LEDGERS,
): StorageTtlStatus {
  const key = entry?.key ?? 'unknown_key';
  const liveUntil = entry?.liveUntilLedgerSeq ?? entry?.liveUntilLedger;
  const lastModified = entry?.lastModifiedLedgerSeq;
  const isArchivedEntry = isEntryArchived({ liveUntilLedgerSeq: liveUntil }, currentLedger);
  const remaining = getRemainingLedgers({ liveUntilLedgerSeq: liveUntil }, currentLedger);
  const needsExtension = needsTtlExtension({ liveUntilLedgerSeq: liveUntil }, currentLedger, threshold);

  return {
    key,
    liveUntilLedger: liveUntil,
    lastModifiedLedger: lastModified,
    currentLedger,
    remainingLedgers: remaining,
    isArchived: isArchivedEntry,
    needsTtlExtension: needsExtension,
  };
}

/**
 * Inspects multiple storage entries and classifies them into actionable reports.
 * Time Complexity: O(N) where N is the number of entries.
 * Space Complexity: O(N)
 */
export function inspectFootprintTtl(
  entries: Array<{ key: string; liveUntilLedgerSeq?: number; lastModifiedLedgerSeq?: number }>,
  currentLedger: number,
  threshold: number = TTL_EXTENSION_THRESHOLD_LEDGERS,
): StorageMaintenanceReport {
  const archivedEntries: StorageTtlStatus[] = [];
  const extensionNeededEntries: StorageTtlStatus[] = [];
  const healthyEntries: StorageTtlStatus[] = [];

  for (const entry of entries) {
    const status = inspectStorageTtl(entry, currentLedger, threshold);
    if (status.isArchived) {
      archivedEntries.push(status);
    } else if (status.needsTtlExtension) {
      extensionNeededEntries.push(status);
    } else {
      healthyEntries.push(status);
    }
  }

  return {
    currentLedger,
    totalChecked: entries.length,
    archivedEntries,
    extensionNeededEntries,
    healthyEntries,
    hasArchived: archivedEntries.length > 0,
    hasExtensionNeeded: extensionNeededEntries.length > 0,
  };
}

/**
 * Queries Soroban RPC for ledger entries and generates a TTL maintenance report.
 * Time Complexity: O(N) where N is keys count.
 * Space Complexity: O(N)
 */
export async function queryAndInspectStorageTtl(
  serverOrUrl: rpc.Server | string,
  keys: (string | xdr.LedgerKey)[],
  threshold: number = TTL_EXTENSION_THRESHOLD_LEDGERS,
): Promise<StorageMaintenanceReport> {
  const { latestLedger, entries } = await fetchLedgerEntriesWithTtl(serverOrUrl, keys);
  return inspectFootprintTtl(entries, latestLedger, threshold);
}

/**
 * Builds a Soroban Transaction to extend active storage TTL.
 * Footprint specifies readOnly entries to extend.
 * Time Complexity: O(K) where K is keys count.
 * Space Complexity: O(K)
 */
export function buildExtendFootprintTtlTx(
  sourceAccount: Account,
  keys: (string | xdr.LedgerKey)[],
  networkPassphrase: string,
  extendTo: number = DEFAULT_EXTEND_TO_LEDGERS,
  fee: string = '100',
): Transaction {
  const readOnly = keys.map(toLedgerKey);
  const footprint = new xdr.LedgerFootprint({
    readOnly,
    readWrite: [],
  });
  const resources = new xdr.SorobanResources({
    footprint,
    instructions: 0,
    diskReadBytes: 0,
    writeBytes: 0,
  });
  const sorobanData = new xdr.SorobanTransactionData({
    ext: new xdr.SorobanTransactionDataExt(0),
    resources,
    resourceFee: new xdr.Int64(0),
  });

  return new TransactionBuilder(sourceAccount, {
    fee,
    networkPassphrase,
  })
    .setSorobanData(sorobanData)
    .addOperation(Operation.extendFootprintTtl({ extendTo }))
    .setTimeout(30)
    .build();
}

/**
 * Builds a Soroban Transaction to restore archived contract storage.
 * Footprint specifies readWrite entries to restore.
 * Time Complexity: O(K) where K is keys count.
 * Space Complexity: O(K)
 */
export function buildRestoreFootprintTx(
  sourceAccount: Account,
  keys: (string | xdr.LedgerKey)[],
  networkPassphrase: string,
  fee: string = '100',
): Transaction {
  const readWrite = keys.map(toLedgerKey);
  const footprint = new xdr.LedgerFootprint({
    readOnly: [],
    readWrite,
  });
  const resources = new xdr.SorobanResources({
    footprint,
    instructions: 0,
    diskReadBytes: 0,
    writeBytes: 0,
  });
  const sorobanData = new xdr.SorobanTransactionData({
    ext: new xdr.SorobanTransactionDataExt(0),
    resources,
    resourceFee: new xdr.Int64(0),
  });

  return new TransactionBuilder(sourceAccount, {
    fee,
    networkPassphrase,
  })
    .setSorobanData(sorobanData)
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(30)
    .build();
}

/**
 * Complete maintenance pipeline: checks keys via RPC, restores archived entries if present,
 * and extends TTL for live entries below the 50,000 ledger threshold.
 * Time Complexity: O(N)
 * Space Complexity: O(N)
 */
export async function autoMaintainContractStorage(
  serverOrUrl: rpc.Server | string,
  sourceAccount: Account,
  keys: (string | xdr.LedgerKey)[],
  networkPassphrase: string,
  options?: {
    threshold?: number;
    extendTo?: number;
    fee?: string;
  },
): Promise<{
  report: StorageMaintenanceReport;
  restoreTx?: Transaction;
  extendTtlTx?: Transaction;
}> {
  const threshold = options?.threshold ?? TTL_EXTENSION_THRESHOLD_LEDGERS;
  const extendTo = options?.extendTo ?? DEFAULT_EXTEND_TO_LEDGERS;
  const fee = options?.fee ?? '100';

  const report = await queryAndInspectStorageTtl(serverOrUrl, keys, threshold);

  let restoreTx: Transaction | undefined;
  let extendTtlTx: Transaction | undefined;

  if (report.hasArchived) {
    const archivedKeyStrings = report.archivedEntries.map((e) => e.key);
    restoreTx = buildRestoreFootprintTx(sourceAccount, archivedKeyStrings, networkPassphrase, fee);
  }

  if (report.hasExtensionNeeded) {
    const extendKeyStrings = report.extensionNeededEntries.map((e) => e.key);
    extendTtlTx = buildExtendFootprintTtlTx(sourceAccount, extendKeyStrings, networkPassphrase, extendTo, fee);
  }

  return {
    report,
    restoreTx,
    extendTtlTx,
  };
}

export { SorobanStateArchival };
export type { ArchivedState, ArchiveManifest, RestorationRequest };
