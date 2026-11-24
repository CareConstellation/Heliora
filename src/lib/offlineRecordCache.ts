/**
 * Client-Side Encrypted IndexedDB Offline Record Snapshot Cache (#121).
 *
 * Enables viewing previously decrypted health records in offline environments
 * (such as transit or disaster relief) with strict client-side envelope encryption
 * and automatic TTL (Time-To-Live) expiration.
 *
 * Security Architecture:
 * - Records are encrypted with AES-256-GCM using a non-extractable CryptoKey stored
 *   in the browser's IndexedDB keystore.
 * - Ciphertext is cryptographically bound to the patient's Stellar address via AAD
 *   (Additional Authenticated Data), preventing cross-wallet slot decryption.
 * - Each snapshot carries an `expiresAt` epoch timestamp. Expired snapshots are
 *   evicted on access and during periodic cleanup sweeps.
 *
 * Time Complexity:
 * - Read/Write: O(1) indexed lookup by compound key [patientAddress:recordId].
 * - Space Complexity: O(n) where n is the number of cached snapshots.
 */

import { Buffer } from 'buffer';
import { indexedDbKeyProvider, type LocalKeyProvider } from './encryptedLocalStore';

export const OFFLINE_RECORDS_DB = 'heliora-offline-records';
export const SNAPSHOTS_STORE = 'record-snapshots';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const IV_LENGTH_BYTES = 12;
const ENCRYPTION_NAMESPACE = 'heliora-offline-snapshots';

export interface EncryptedRecordSnapshotEnvelope {
  id: string; // composite key: `${patientAddress}:${recordId}`
  recordId: string;
  patientAddress: string;
  iv: string; // base64 IV
  ct: string; // base64 ciphertext
  savedAt: number;
  expiresAt: number;
}

export interface DecryptedSnapshotItem<T = unknown> {
  id: string;
  recordId: string;
  patientAddress: string;
  data: T;
  savedAt: number;
  expiresAt: number;
}

function getCompositeKey(patientAddress: string, recordId: string): string {
  return `${patientAddress}:${recordId}`;
}

function getAad(patientAddress: string, recordId: string): Uint8Array {
  return new TextEncoder().encode(getCompositeKey(patientAddress, recordId));
}

function openSnapshotsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is unavailable in this environment.'));
    }

    const request = indexedDB.open(OFFLINE_RECORDS_DB, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        const store = db.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'id' });
        store.createIndex('patientAddress', 'patientAddress', { unique: false });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runDbTransaction<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore, tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T> {
  return openSnapshotsDatabase().then((db) => {
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(SNAPSHOTS_STORE, mode);
      const store = tx.objectStore(SNAPSHOTS_STORE);

      const request = fn(store, tx);

      tx.oncomplete = () => {
        db.close();
        resolve(request ? request.result : (undefined as unknown as T));
      };

      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };

      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    });
  });
}

/**
 * Saves a decrypted medical record snapshot into client-side encrypted IndexedDB.
 */
export async function saveDecryptedRecordSnapshot(
  patientAddress: string,
  recordId: string,
  decryptedRecord: unknown,
  ttlMs = DEFAULT_TTL_MS,
  keyProvider: LocalKeyProvider = indexedDbKeyProvider,
): Promise<void> {
  const key = await keyProvider.getKey(ENCRYPTION_NAMESPACE);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const aad = getAad(patientAddress, recordId);

  const serialized = JSON.stringify(decryptedRecord);
  const plaintext = new TextEncoder().encode(serialized);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    plaintext,
  );

  const now = Date.now();
  const envelope: EncryptedRecordSnapshotEnvelope = {
    id: getCompositeKey(patientAddress, recordId),
    recordId,
    patientAddress,
    iv: Buffer.from(iv).toString('base64'),
    ct: Buffer.from(new Uint8Array(ciphertext)).toString('base64'),
    savedAt: now,
    expiresAt: now + ttlMs,
  };

  await runDbTransaction('readwrite', (store) => {
    store.put(envelope);
  });
}

/**
 * Loads and decrypts a record snapshot from IndexedDB.
 * Checks expiration TTL: if expired, automatically removes from DB and returns null.
 */
export async function getDecryptedRecordSnapshot<T = unknown>(
  patientAddress: string,
  recordId: string,
  now = Date.now(),
  keyProvider: LocalKeyProvider = indexedDbKeyProvider,
): Promise<T | null> {
  const id = getCompositeKey(patientAddress, recordId);
  const envelope = await runDbTransaction<EncryptedRecordSnapshotEnvelope | undefined>(
    'readonly',
    (store) => store.get(id),
  );

  if (!envelope) {
    return null;
  }

  // Check TTL expiration
  if (now >= envelope.expiresAt) {
    // Evict expired record
    void deleteRecordSnapshot(patientAddress, recordId);
    return null;
  }

  const key = await keyProvider.getKey(ENCRYPTION_NAMESPACE);
  const iv = new Uint8Array(Buffer.from(envelope.iv, 'base64'));
  const ciphertext = new Uint8Array(Buffer.from(envelope.ct, 'base64'));
  const aad = getAad(patientAddress, recordId);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad },
      key,
      ciphertext,
    );

    const jsonString = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(jsonString) as T;
  } catch (err) {
    console.error('Failed to decrypt cached record snapshot:', err);
    return null;
  }
}

/**
 * Lists all active, non-expired decrypted record snapshots for a patient.
 */
export async function listDecryptedRecordSnapshots<T = unknown>(
  patientAddress: string,
  now = Date.now(),
  keyProvider: LocalKeyProvider = indexedDbKeyProvider,
): Promise<Array<DecryptedSnapshotItem<T>>> {
  const envelopes = await runDbTransaction<EncryptedRecordSnapshotEnvelope[]>(
    'readonly',
    (store) => {
      const index = store.index('patientAddress');
      return index.getAll(patientAddress);
    },
  );

  const activeSnapshots: Array<DecryptedSnapshotItem<T>> = [];

  for (const env of envelopes || []) {
    if (now >= env.expiresAt) {
      void deleteRecordSnapshot(env.patientAddress, env.recordId);
      continue;
    }

    try {
      const key = await keyProvider.getKey(ENCRYPTION_NAMESPACE);
      const iv = new Uint8Array(Buffer.from(env.iv, 'base64'));
      const ciphertext = new Uint8Array(Buffer.from(env.ct, 'base64'));
      const aad = getAad(env.patientAddress, env.recordId);

      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: aad },
        key,
        ciphertext,
      );

      const data = JSON.parse(new TextDecoder().decode(decryptedBuffer)) as T;
      activeSnapshots.push({
        id: env.id,
        recordId: env.recordId,
        patientAddress: env.patientAddress,
        data,
        savedAt: env.savedAt,
        expiresAt: env.expiresAt,
      });
    } catch {
      // Skip tampered or un-decryptable snapshot
      continue;
    }
  }

  return activeSnapshots;
}

/**
 * Deletes a single record snapshot by patient and record ID.
 */
export async function deleteRecordSnapshot(
  patientAddress: string,
  recordId: string,
): Promise<void> {
  const id = getCompositeKey(patientAddress, recordId);
  await runDbTransaction('readwrite', (store) => {
    store.delete(id);
  });
}

/**
 * Sweeps and deletes all expired record snapshots across all patients.
 */
export async function clearExpiredSnapshots(now = Date.now()): Promise<number> {
  const db = await openSnapshotsDatabase();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(SNAPSHOTS_STORE, 'readwrite');
    const store = tx.objectStore(SNAPSHOTS_STORE);
    const cursorRequest = store.openCursor();
    let evictedCount = 0;

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        const envelope = cursor.value as EncryptedRecordSnapshotEnvelope;
        if (now >= envelope.expiresAt) {
          cursor.delete();
          evictedCount++;
        }
        cursor.continue();
      }
    };

    tx.oncomplete = () => {
      db.close();
      resolve(evictedCount);
    };

    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Completely purges all offline record snapshots.
 */
export async function purgeOfflineRecordCache(): Promise<void> {
  await runDbTransaction('readwrite', (store) => {
    store.clear();
  });
}
