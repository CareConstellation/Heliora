/**
 * Encrypted, per-wallet key/value slots in `localStorage`.
 *
 * Values are JSON-serialised and sealed with AES-256-GCM. The key is generated
 * on first use and kept in IndexedDB as a non-extractable `CryptoKey`, so page
 * script can encrypt and decrypt with it but can never read the key material.
 * The ciphertext stays readable to anyone with disk access, but useless
 * without the key that lives in the browser's key store.
 *
 * Every slot is bound to its `namespace:owner` name through the GCM additional
 * authenticated data, so a ciphertext copied into another wallet's slot fails
 * to decrypt instead of being accepted.
 */

import { Buffer } from 'buffer';

const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;
const AES_GCM = { name: 'AES-GCM', length: 256 } as const;

/** Supplies the AES-GCM key used for one namespace. */
export interface LocalKeyProvider {
  getKey(namespace: string): Promise<CryptoKey>;
}

interface StoredEnvelope {
  v: number;
  iv: string;
  ct: string;
}

export class EncryptedStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptedStoreError';
  }
}

/* ── Key providers ───────────────────────────────────────────────── */

const KEY_DB = 'heliora-local-keys';
const KEY_STORE = 'aes-gcm';

function keyStoreRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(KEY_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(KEY_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(KEY_STORE, mode);
      const request = run(tx.objectStore(KEY_STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(request.result);
      };
      tx.onabort = () => {
        db.close();
        reject(request.error ?? tx.error);
      };
    };
  });
}

/** Default provider: one non-extractable AES-GCM key per namespace, persisted in IndexedDB. */
export const indexedDbKeyProvider: LocalKeyProvider = {
  async getKey(namespace) {
    if (typeof indexedDB === 'undefined') {
      throw new EncryptedStoreError(
        'This browser has no IndexedDB, so data cannot be stored securely.',
      );
    }
    const existing = await keyStoreRequest<CryptoKey | undefined>('readonly', (s) =>
      s.get(namespace),
    );
    if (existing) return existing;
    const key = await crypto.subtle.generateKey(AES_GCM, false, ['encrypt', 'decrypt']);
    try {
      // `add` (not `put`) so a key created concurrently in another tab is never overwritten.
      await keyStoreRequest('readwrite', (s) => s.add(key, namespace));
      return key;
    } catch {
      const winner = await keyStoreRequest<CryptoKey | undefined>('readonly', (s) =>
        s.get(namespace),
      );
      if (!winner) throw new EncryptedStoreError('Could not persist the local encryption key.');
      return winner;
    }
  },
};

/** Keeps keys in memory only. Data written with it cannot be read after a reload; meant for tests. */
export function createMemoryKeyProvider(): LocalKeyProvider {
  const keys = new Map<string, Promise<CryptoKey>>();
  return {
    getKey(namespace) {
      let key = keys.get(namespace);
      if (!key) {
        key = crypto.subtle.generateKey(AES_GCM, false, ['encrypt', 'decrypt']);
        keys.set(namespace, key);
      }
      return key;
    },
  };
}

/* ── Store ───────────────────────────────────────────────────────── */

export interface EncryptedLocalStore<T> {
  /** Decrypts the owner's value, or returns `null` when nothing is stored. Throws when it was tampered with. */
  load(owner: string): Promise<T | null>;
  save(owner: string, value: T): Promise<void>;
  clear(owner: string): void;
}

export function createEncryptedLocalStore<T>(options: {
  namespace: string;
  keyProvider?: LocalKeyProvider;
  storage?: () => Storage;
}): EncryptedLocalStore<T> {
  const { namespace } = options;
  const keyProvider = options.keyProvider ?? indexedDbKeyProvider;
  const storage = options.storage ?? (() => window.localStorage);
  const slot = (owner: string) => `${namespace}:${owner}`;
  const aad = (owner: string) => new TextEncoder().encode(slot(owner));

  return {
    async load(owner) {
      const raw = storage().getItem(slot(owner));
      if (!raw) return null;

      let envelope: StoredEnvelope;
      try {
        envelope = JSON.parse(raw) as StoredEnvelope;
      } catch {
        throw new EncryptedStoreError('Stored data is corrupted.');
      }
      if (envelope.v !== ENVELOPE_VERSION || !envelope.iv || !envelope.ct) {
        throw new EncryptedStoreError('Stored data has an unsupported format.');
      }

      const key = await keyProvider.getKey(namespace);
      let plaintext: ArrayBuffer;
      try {
        plaintext = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: new Uint8Array(Buffer.from(envelope.iv, 'base64')),
            additionalData: aad(owner),
          },
          key,
          new Uint8Array(Buffer.from(envelope.ct, 'base64')),
        );
      } catch {
        throw new EncryptedStoreError(
          'Stored data could not be decrypted. It was modified or written on another device.',
        );
      }
      return JSON.parse(new TextDecoder().decode(plaintext)) as T;
    },

    async save(owner, value) {
      const key = await keyProvider.getKey(namespace);
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad(owner) },
        key,
        new TextEncoder().encode(JSON.stringify(value)),
      );
      const envelope: StoredEnvelope = {
        v: ENVELOPE_VERSION,
        iv: Buffer.from(iv).toString('base64'),
        ct: Buffer.from(new Uint8Array(ciphertext)).toString('base64'),
      };
      storage().setItem(slot(owner), JSON.stringify(envelope));
    },

    clear(owner) {
      storage().removeItem(slot(owner));
    },
  };
}
