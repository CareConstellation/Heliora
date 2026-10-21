/**
 * Soroban RPC Mock Harness
 *
 * Declarative mock handlers for Soroban RPC responses and an in-memory
 * ledger state machine for testing contract interactions.
 *
 * Usage in test files:
 *   import { createSorobanMockHandlers, LedgerStateMachine, simulationSuccess } from '@/__mocks__/sorobanRpc';
 */

/* ─── In-Memory Ledger State Machine ─────────────────────────────── */

export class LedgerStateMachine {
  private entries = new Map<string, { value: unknown; ttl: number }>();
  private _sequence = 100;
  private _ledger = 1000;

  set(key: string, value: unknown, ttl = 0): void {
    this.entries.set(key, { value, ttl });
  }

  get(key: string): unknown | undefined {
    return this.entries.get(key)?.value;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this._sequence = 100;
    this._ledger = 1000;
  }

  nextSequence(): string {
    return String(this._sequence++);
  }

  currentLedger(): number {
    return this._ledger;
  }

  advanceLedger(): number {
    return ++this._ledger;
  }

  resolve(
    keys: string[],
  ): Array<{ key: string; val: unknown; lastModifiedLedgerSeq: number }> {
    const results: Array<{ key: string; val: unknown; lastModifiedLedgerSeq: number }> = [];
    for (const k of keys) {
      const entry = this.entries.get(k);
      if (entry) {
        results.push({ key: k, val: entry.value, lastModifiedLedgerSeq: this._ledger });
      }
    }
    return results;
  }
}

/* ─── Response Factories ─────────────────────────────────────────── */

export function simulationSuccess(latestLedger = 1000) {
  return {
    transactionData: 'mock_soroban_tx_data',
    minResourceFee: '100',
    events: [],
    results: [{ auth: [], xdr: 'mock_result_xdr' }],
    cost: { cpuInsns: '1000000', memBytes: '65536' },
    latestLedger,
  };
}

export function simulationOutOfGas() {
  return {
    error:
      'transaction simulation failed: host invocation failed: CPU budget exceeded',
    events: [],
    cost: { cpuInsns: '52000000', memBytes: '41943040' },
    latestLedger: 1000,
  };
}

export function simulationAuthError() {
  return {
    error:
      'transaction simulation failed: host invocation failed: missing authorized invocation for address',
    events: [],
    cost: { cpuInsns: '0', memBytes: '0' },
    latestLedger: 1000,
  };
}

export function sendTransactionPending(hash = 'mock_tx_hash_001') {
  return {
    status: 'PENDING',
    hash,
    latestLedger: 1000,
    latestLedgerCloseTime: '1700000000',
  };
}

export function sendTransactionError(errorXdr = 'mock_error_xdr') {
  return {
    status: 'ERROR',
    hash: '',
    errorResultXdr: errorXdr,
    latestLedger: 1000,
    latestLedgerCloseTime: '1700000000',
  };
}

export function pollTransactionSuccess(hash = 'mock_tx_hash_001') {
  return {
    status: 'SUCCESS',
    hash,
    latestLedger: 1001,
    resultXdr: 'mock_result_xdr',
  };
}

export function pollTransactionFailed(hash = 'mock_tx_hash_001') {
  return {
    status: 'FAILED',
    hash,
    latestLedger: 1001,
    resultXdr: 'mock_failed_result_xdr',
  };
}

export function pollTransactionNotFound() {
  return { status: 'NOT_FOUND', latestLedger: 1001 };
}

export function mockAccount(address: string, sequence = '100') {
  return {
    accountId: () => address,
    sequenceNumber: () => sequence,
    incrementSequenceNumber: () => {},
  };
}

/* ─── Mock Handler Factory ───────────────────────────────────────── */

export interface SorobanMockHandlers {
  simulateTransaction: jest.Mock;
  sendTransaction: jest.Mock;
  getAccount: jest.Mock;
  prepareTransaction: jest.Mock;
  pollTransaction: jest.Mock;
  getLedgerEntries: jest.Mock;
  getLatestLedger: jest.Mock;
}

export function createSorobanMockHandlers(
  scenario: 'success' | 'out_of_gas' | 'auth_error' = 'success',
): SorobanMockHandlers {
  const simResponse =
    scenario === 'success'
      ? simulationSuccess()
      : scenario === 'out_of_gas'
        ? simulationOutOfGas()
        : simulationAuthError();

  return {
    simulateTransaction: jest.fn().mockResolvedValue(simResponse),
    sendTransaction: jest.fn().mockResolvedValue(sendTransactionPending()),
    getAccount: jest
      .fn()
      .mockImplementation((addr: string) =>
        Promise.resolve(mockAccount(addr)),
      ),
    prepareTransaction: jest
      .fn()
      .mockImplementation((tx: unknown) =>
        Promise.resolve({ toXDR: () => 'mock_prepared_xdr', ...Object(tx) }),
      ),
    pollTransaction: jest.fn().mockResolvedValue(pollTransactionSuccess()),
    getLedgerEntries: jest
      .fn()
      .mockResolvedValue({ entries: null, latestLedger: 1000 }),
    getLatestLedger: jest
      .fn()
      .mockResolvedValue({ id: 'mock_ledger_id', sequence: 1000, protocolVersion: 22 }),
  };
}

export function createMockRpcConstructor(handlers: SorobanMockHandlers) {
  return jest.fn().mockImplementation(() => handlers);
}
