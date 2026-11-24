/**
 * Tests for Client-Side Encrypted IndexedDB Offline Record Snapshot Cache & PWA (#121)
 */

import {
  saveDecryptedRecordSnapshot,
  getDecryptedRecordSnapshot,
  listDecryptedRecordSnapshots,
  clearExpiredSnapshots,
  purgeOfflineRecordCache,
  deleteRecordSnapshot,
  EncryptedRecordSnapshotEnvelope,
} from '@/lib/offlineRecordCache';
import { createMemoryKeyProvider } from '@/lib/encryptedLocalStore';

// In-memory IndexedDB mock for unit testing
class MockIDBStore {
  private map = new Map<string, EncryptedRecordSnapshotEnvelope>();

  put(envelope: EncryptedRecordSnapshotEnvelope) {
    this.map.set(envelope.id, { ...envelope });
    const req: { result?: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
      result: envelope.id,
      onsuccess: null,
      onerror: null,
    };
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  }

  get(id: string) {
    const res = this.map.get(id);
    const req: { result?: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
      result: res ? { ...res } : undefined,
      onsuccess: null,
      onerror: null,
    };
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  }

  delete(id: string) {
    this.map.delete(id);
    const req: { result?: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
      result: undefined,
      onsuccess: null,
      onerror: null,
    };
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  }

  clear() {
    this.map.clear();
    const req: { result?: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
      result: undefined,
      onsuccess: null,
      onerror: null,
    };
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  }

  index(_name: string) {
    return {
      getAll: (patientAddress: string) => {
        const results = Array.from(this.map.values()).filter(
          (env) => env.patientAddress === patientAddress,
        );
        const req: { result?: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
          result: results,
          onsuccess: null,
          onerror: null,
        };
        setTimeout(() => req.onsuccess?.(), 0);
        return req;
      },
    };
  }

  openCursor() {
    const entries = Array.from(this.map.entries());
    let idx = 0;
    const req: {
      result: {
        value: EncryptedRecordSnapshotEnvelope;
        delete: () => void;
        continue: () => void;
      } | null;
      onsuccess: (() => void) | null;
      onerror: (() => void) | null;
    } = {
      result: null,
      onsuccess: null,
      onerror: null,
    };

    const advance = () => {
      if (idx < entries.length) {
        const [currentKey, currentValue] = entries[idx]!;
        req.result = {
          value: currentValue,
          delete: () => {
            this.map.delete(currentKey);
          },
          continue: () => {
            idx++;
            advance();
          },
        };
      } else {
        req.result = null;
      }
      req.onsuccess?.();
    };

    setTimeout(() => advance(), 0);
    return req;
  }
}

const mockStore = new MockIDBStore();

const mockIDBDatabase = {
  objectStoreNames: { contains: () => true },
  createObjectStore: () => ({
    createIndex: () => {},
  }),
  transaction: (_storeNames: string, _mode: string) => {
    const tx: {
      objectStore: () => MockIDBStore;
      oncomplete: (() => void) | null;
      onerror: (() => void) | null;
      onabort: (() => void) | null;
      error?: unknown;
    } = {
      objectStore: () => mockStore,
      oncomplete: null,
      onerror: null,
      onabort: null,
    };
    setTimeout(() => tx.oncomplete?.(), 5);
    return tx;
  },
  close: () => {},
};

(global as unknown as { indexedDB: unknown }).indexedDB = {
  open: () => {
    const req: {
      result: typeof mockIDBDatabase;
      onsuccess: (() => void) | null;
      onerror: (() => void) | null;
      onupgradeneeded: (() => void) | null;
    } = {
      result: mockIDBDatabase,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  },
};

const PATIENT_A = 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKBA3VIQVOJ2QJ6F7W5H76D4R';
const PATIENT_B = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGXDECKMN2HIJNTVWK7';

describe('Offline Encrypted Record Cache (#121)', () => {
  let keyProvider: ReturnType<typeof createMemoryKeyProvider>;

  beforeEach(async () => {
    keyProvider = createMemoryKeyProvider();
    await purgeOfflineRecordCache();
  });

  it('encrypts and stores a decrypted record snapshot in IndexedDB, and retrieves it within TTL', async () => {
    const medicalRecord = {
      id: 'rec_001',
      diagnosis: 'Type 2 Diabetes Mellitus',
      prescription: 'Metformin 500mg BID',
      notes: 'HbA1c steady at 6.4%. Lifestyle adherence verified.',
      date: '2026-11-20',
    };

    await saveDecryptedRecordSnapshot(PATIENT_A, 'rec_001', medicalRecord, 3600 * 1000, keyProvider);

    const retrieved = await getDecryptedRecordSnapshot<typeof medicalRecord>(
      PATIENT_A,
      'rec_001',
      Date.now(),
      keyProvider,
    );

    expect(retrieved).toEqual(medicalRecord);
  });

  it('enforces expiration TTL and automatically evicts expired record snapshots', async () => {
    const record = { id: 'rec_exp', diagnosis: 'Acute Bronchitis' };
    const shortTtlMs = 1000; // 1 second

    await saveDecryptedRecordSnapshot(PATIENT_A, 'rec_exp', record, shortTtlMs, keyProvider);

    // Retrieve before expiry
    const valid = await getDecryptedRecordSnapshot(
      PATIENT_A,
      'rec_exp',
      Date.now() + 500,
      keyProvider,
    );
    expect(valid).toEqual(record);

    // Retrieve after expiry
    const expired = await getDecryptedRecordSnapshot(
      PATIENT_A,
      'rec_exp',
      Date.now() + 2000,
      keyProvider,
    );
    expect(expired).toBeNull();
  });

  it('cryptographically isolates patient records and rejects cross-wallet access', async () => {
    const confidentialRecord = { id: 'rec_conf', note: 'Confidential clinical history' };
    await saveDecryptedRecordSnapshot(PATIENT_A, 'rec_conf', confidentialRecord, 3600 * 1000, keyProvider);

    // Patient B attempts to retrieve Patient A's record slot
    const crossAccess = await getDecryptedRecordSnapshot(PATIENT_B, 'rec_conf', Date.now(), keyProvider);
    expect(crossAccess).toBeNull();
  });

  it('lists active non-expired decrypted snapshots for a patient', async () => {
    await saveDecryptedRecordSnapshot(PATIENT_A, 'rec_1', { diagnosis: 'Hypertension' }, 10_000, keyProvider);
    await saveDecryptedRecordSnapshot(PATIENT_A, 'rec_2', { diagnosis: 'Asthma' }, 10_000, keyProvider);
    await saveDecryptedRecordSnapshot(PATIENT_B, 'rec_3', { diagnosis: 'Migraine' }, 10_000, keyProvider);

    const patientASnapshots = await listDecryptedRecordSnapshots(PATIENT_A, Date.now(), keyProvider);
    expect(patientASnapshots.length).toBe(2);
    expect(patientASnapshots.map((s) => s.recordId)).toEqual(['rec_1', 'rec_2']);
  });

  it('clears expired snapshots across all patients during maintenance sweeps', async () => {
    const now = Date.now();
    // Record 1: expired
    await saveDecryptedRecordSnapshot(PATIENT_A, 'rec_old', { note: 'old' }, -5000, keyProvider);
    // Record 2: active
    await saveDecryptedRecordSnapshot(PATIENT_A, 'rec_active', { note: 'active' }, 60_000, keyProvider);

    const evictedCount = await clearExpiredSnapshots(now);
    expect(evictedCount).toBe(1);

    const remaining = await listDecryptedRecordSnapshots(PATIENT_A, now, keyProvider);
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.recordId).toBe('rec_active');
  });

  it('deletes an individual snapshot on demand', async () => {
    await saveDecryptedRecordSnapshot(PATIENT_A, 'rec_del', { note: 'delete me' }, 10_000, keyProvider);
    expect(await getDecryptedRecordSnapshot(PATIENT_A, 'rec_del', Date.now(), keyProvider)).toBeTruthy();

    await deleteRecordSnapshot(PATIENT_A, 'rec_del');
    expect(await getDecryptedRecordSnapshot(PATIENT_A, 'rec_del', Date.now(), keyProvider)).toBeNull();
  });
});
