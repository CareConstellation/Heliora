import { QueryClient } from '@tanstack/react-query';
import {
  createEncryptedIDBPersister,
  encryptData,
  decryptData,
  getOrCreateEphemeralSessionKey,
  resetEphemeralSessionKey,
  invalidateQueriesOnChainEvent,
  createPersistedQueryClient,
  cleanupPersistedQueryCache,
  getPersistedQueryClient,
  STORAGE_KEY,
  CACHE_TIMESTAMP_KEY,
  GARBAGE_COLLECTION_INTERVAL,
  EncryptedCacheData,
} from '@/services/persistentQueryCache';
import { eventManager, EventType, ContractEvent } from '@/lib/contractEventListener';
import * as idbKeyval from 'idb-keyval';

jest.mock('idb-keyval', () => {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn((key: string) => Promise.resolve(store.get(key))),
    set: jest.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    del: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      store.clear();
      return Promise.resolve();
    }),
    _store: store,
  };
});

describe('persistentQueryCache service', () => {
  beforeEach(() => {
    resetEphemeralSessionKey();
    cleanupPersistedQueryCache();
    (idbKeyval as unknown as { _store: Map<string, unknown> })._store.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanupPersistedQueryCache();
  });

  describe('Encryption / Decryption with Ephemeral Session Key', () => {
    it('generates a valid CryptoKey and encrypts/decrypts data round-trip', async () => {
      const sampleData = { user: '0x123', records: [{ id: 'rec-1', title: 'Blood Test' }] };

      const encrypted = await encryptData(sampleData);

      expect(encrypted).toHaveProperty('data');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('timestamp');
      expect(typeof encrypted.data).toBe('string');
      expect(encrypted.data).not.toEqual(JSON.stringify(sampleData));

      const decrypted = await decryptData(encrypted);
      expect(decrypted).toEqual(sampleData);
    });

    it('reuses the ephemeral key across calls in the same session', async () => {
      const key1 = await getOrCreateEphemeralSessionKey();
      const key2 = await getOrCreateEphemeralSessionKey();

      expect(key1).toBe(key2);
    });

    it('creates a new key when session is reset', async () => {
      const key1 = await getOrCreateEphemeralSessionKey();
      resetEphemeralSessionKey();
      const key2 = await getOrCreateEphemeralSessionKey();

      expect(key1).not.toBe(key2);
    });

    it('throws or handles decryption error gracefully when key/ciphertext is corrupted', async () => {
      const sampleData = { foo: 'bar' };
      const encrypted = await encryptData(sampleData);

      const corrupted: EncryptedCacheData = {
        ...encrypted,
        data: btoa('invalid_ciphertext_data'),
      };

      await expect(decryptData(corrupted)).rejects.toThrow();
    });
  });

  describe('createEncryptedIDBPersister', () => {
    it('persists client state to IndexedDB encrypted', async () => {
      const persister = createEncryptedIDBPersister();
      const persistedClient = {
        timestamp: Date.now(),
        buster: 'v1',
        clientState: {
          queries: [{ queryKey: ['records'], state: { data: 'test-record' } }],
          mutations: [],
        },
      };

      await persister.persistClient(persistedClient as never);

      expect(idbKeyval.set).toHaveBeenCalledWith(STORAGE_KEY, expect.anything());
      expect(idbKeyval.set).toHaveBeenCalledWith(CACHE_TIMESTAMP_KEY, expect.any(Number));
    });

    it('restores persisted client state successfully if valid and fresh', async () => {
      const persister = createEncryptedIDBPersister();
      const persistedClient = {
        timestamp: Date.now(),
        buster: 'v1',
        clientState: {
          queries: [{ queryKey: ['records'], state: { data: 'test-record' } }],
          mutations: [],
        },
      };

      await persister.persistClient(persistedClient as never);
      const restored = await persister.restoreClient();

      expect(restored).toBeDefined();
      expect(restored).toEqual(persistedClient);
    });

    it('returns undefined and purges storage if cache is older than 24 hours', async () => {
      const persister = createEncryptedIDBPersister();
      const persistedClient = {
        timestamp: Date.now() - GARBAGE_COLLECTION_INTERVAL - 1000,
        buster: 'v1',
        clientState: { queries: [], mutations: [] },
      };

      // Manually store timestamp in the past
      await idbKeyval.set(CACHE_TIMESTAMP_KEY, Date.now() - GARBAGE_COLLECTION_INTERVAL - 1000);
      const encrypted = await encryptData(persistedClient);
      await idbKeyval.set(STORAGE_KEY, encrypted);

      const restored = await persister.restoreClient();

      expect(restored).toBeUndefined();
      expect(idbKeyval.del).toHaveBeenCalledWith(STORAGE_KEY);
      expect(idbKeyval.del).toHaveBeenCalledWith(CACHE_TIMESTAMP_KEY);
    });

    it('returns undefined and purges storage if decryption fails', async () => {
      const persister = createEncryptedIDBPersister();

      await idbKeyval.set(CACHE_TIMESTAMP_KEY, Date.now());
      await idbKeyval.set(STORAGE_KEY, {
        data: btoa('corrupted'),
        iv: btoa('123456789012'),
        timestamp: Date.now(),
      });

      const restored = await persister.restoreClient();

      expect(restored).toBeUndefined();
      expect(idbKeyval.del).toHaveBeenCalledWith(STORAGE_KEY);
      expect(idbKeyval.del).toHaveBeenCalledWith(CACHE_TIMESTAMP_KEY);
    });

    it('removes client cache when removeClient is called', async () => {
      const persister = createEncryptedIDBPersister();
      await persister.removeClient();

      expect(idbKeyval.del).toHaveBeenCalledWith(STORAGE_KEY);
      expect(idbKeyval.del).toHaveBeenCalledWith(CACHE_TIMESTAMP_KEY);
    });
  });

  describe('On-Chain Event Query Invalidation', () => {
    it('invalidates matching queries when state change events are received', () => {
      const client = createPersistedQueryClient();
      const invalidateSpy = jest.spyOn(client, 'invalidateQueries');

      const accessGrantedEvent: ContractEvent = {
        id: 'evt-1',
        type: EventType.AccessGranted,
        contractId: 'heliora-contracts',
        ledgerSequence: 100,
        transactionHash: '0xabc',
        timestamp: Date.now(),
        data: {},
        processedAt: Date.now(),
      };

      invalidateQueriesOnChainEvent(accessGrantedEvent);

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['records'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['doctorPatients'] });
    });

    it('invalidates appointment queries on EscrowReleased event', () => {
      const client = createPersistedQueryClient();
      const invalidateSpy = jest.spyOn(client, 'invalidateQueries');

      const escrowEvent: ContractEvent = {
        id: 'evt-2',
        type: EventType.EscrowReleased,
        contractId: 'heliora-contracts',
        ledgerSequence: 101,
        transactionHash: '0xdef',
        timestamp: Date.now(),
        data: {},
        processedAt: Date.now(),
      };

      invalidateQueriesOnChainEvent(escrowEvent);

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['appointments'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['payments'] });
    });
  });

  describe('QueryClient creation & cleanup', () => {
    it('creates a query client instance and sets default options', () => {
      const client = createPersistedQueryClient();
      expect(client).toBeInstanceOf(QueryClient);
      expect(getPersistedQueryClient()).toBe(client);

      const defaultOptions = client.getDefaultOptions();
      expect(defaultOptions.queries?.staleTime).toBe(5 * 60 * 1000);
      expect(defaultOptions.queries?.gcTime).toBe(GARBAGE_COLLECTION_INTERVAL);
    });

    it('cleans up resources cleanly', () => {
      createPersistedQueryClient();
      cleanupPersistedQueryCache();

      expect(getPersistedQueryClient()).toBeNull();
    });
  });
});
