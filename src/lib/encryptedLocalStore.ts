/* eslint-disable no-math-random -- cryptographically secure random used below */
//
// Math.random is intentionally banned in this file. Use crypto.getRandomValues
// instead for all cryptographic randomness. See: https://owasp.org/www-project-cryptographic-coding-standards/
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
const SALT_BYTES = 32;
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

/* ── Circuit Artifact Cache Store (IndexedDB) ────────────────────── */

export const ARTIFACT_DB = 'heliora-zk-artifacts';
export const ARTIFACT_STORE = 'circuit-artifacts';

export interface StoredCircuitArtifact {
  key: string;           // Cache key: `${circuitName}:${artifactExt}` or circuit hash
  version: string;       // Circuit version or deployment hash
  artifactHash: string;  // SHA-256 hex digest of the binary buffer
  buffer: ArrayBuffer;   // Binary wasm or zkey data
  cachedAt: number;      // Epoch ms timestamp
}

export interface ArtifactStorageProvider {
  get(
    key: string,
    expectedVersion?: string,
  ): Promise<{ buffer: ArrayBuffer; artifactHash: string; version: string } | null>;
  set(key: string, buffer: ArrayBuffer, version: string, artifactHash: string): Promise<void>;
  invalidate(key?: string): Promise<void>;
  clear(): Promise<void>;
}

function artifactStoreRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported in this environment.'));
    }
    const open = indexedDB.open(ARTIFACT_DB, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(ARTIFACT_STORE)) {
        db.createObjectStore(ARTIFACT_STORE, { keyPath: 'key' });
      }
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(ARTIFACT_STORE, mode);
      const request = run(tx.objectStore(ARTIFACT_STORE));
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

/**
 * Production IndexedDB provider for caching compiled circuit artifacts (.wasm and .zkey).
 */
export const indexedDbArtifactProvider: ArtifactStorageProvider = {
  async get(key, expectedVersion) {
    if (typeof indexedDB === 'undefined') return null;
    try {
      const record = await artifactStoreRequest<StoredCircuitArtifact | undefined>(
        'readonly',
        (s) => s.get(key),
      );
      if (!record) return null;
      // Invalidation on version change
      if (expectedVersion && record.version !== expectedVersion) {
        await this.invalidate(key);
        return null;
      }
      return {
        buffer: record.buffer,
        artifactHash: record.artifactHash,
        version: record.version,
      };
    } catch {
      return null;
    }
  },

  async set(key, buffer, version, artifactHash) {
    if (typeof indexedDB === 'undefined') return;
    try {
      const record: StoredCircuitArtifact = {
        key,
        version,
        artifactHash,
        buffer,
        cachedAt: Date.now(),
      };
      await artifactStoreRequest('readwrite', (s) => s.put(record));
    } catch {
      // Non-critical if storage fails (e.g. quota exceeded)
    }
  },

  async invalidate(key) {
    if (typeof indexedDB === 'undefined') return;
    try {
      if (key) {
        await artifactStoreRequest('readwrite', (s) => s.delete(key));
      } else {
        await this.clear();
      }
    } catch {
      // Ignore deletion errors
    }
  },

  async clear() {
    if (typeof indexedDB === 'undefined') return;
    try {
      await artifactStoreRequest('readwrite', (s) => s.clear());
    } catch {
      // Ignore clear errors
    }
  },
};

/**
 * In-memory provider for testing or environments where IndexedDB is unavailable.
 */
export function createMemoryArtifactProvider(): ArtifactStorageProvider {
  const store = new Map<string, StoredCircuitArtifact>();
  return {
    async get(key, expectedVersion) {
      const record = store.get(key);
      if (!record) return null;
      if (expectedVersion && record.version !== expectedVersion) {
        store.delete(key);
        return null;
      }
      return {
        buffer: record.buffer,
        artifactHash: record.artifactHash,
        version: record.version,
      };
    },
    async set(key, buffer, version, artifactHash) {
      store.set(key, { key, buffer, version, artifactHash, cachedAt: Date.now() });
    },
    async invalidate(key) {
      if (key) store.delete(key);
      else store.clear();
    },
    async clear() {
      store.clear();
    },
  };
}

