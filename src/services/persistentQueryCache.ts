import { QueryClient } from '@tanstack/react-query';
import { persistQueryClient, Persister, PersistedClient } from '@tanstack/react-query-persist-client';
import { get, set, del } from 'idb-keyval';
import { eventManager, ContractEvent, EventType } from '@/lib/contractEventListener';

export const STORAGE_KEY = 'heliora-query-cache';
export const ENCRYPTION_KEY_STORAGE_KEY = 'heliora-encryption-key';
export const CACHE_TIMESTAMP_KEY = 'heliora-cache-timestamp';
export const GARBAGE_COLLECTION_INTERVAL = 24 * 60 * 60 * 1000;

export interface EncryptedCacheData {
  data: string;
  iv: string;
  timestamp: number;
}

let encryptionKey: CryptoKey | null = null;
let queryClient: QueryClient | null = null;
let unsubscribePersister: (() => void) | null = null;
let garbageCollectionInterval: ReturnType<typeof setInterval> | null = null;
let eventListenerId: string | null = null;

export function resetEphemeralSessionKey(): void {
  encryptionKey = null;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      sessionStorage.removeItem(ENCRYPTION_KEY_STORAGE_KEY);
    } catch {
      // Ignore sessionStorage errors
    }
  }
}

export async function getOrCreateEphemeralSessionKey(): Promise<CryptoKey> {
  if (encryptionKey) return encryptionKey;

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const storedKey = sessionStorage.getItem(ENCRYPTION_KEY_STORAGE_KEY);
      if (storedKey) {
        encryptionKey = await crypto.subtle.importKey(
          'jwk',
          JSON.parse(storedKey),
          { name: 'AES-GCM', length: 256 },
          true,
          ['encrypt', 'decrypt']
        );
        return encryptionKey;
      }
    } catch {
      // Ignore and generate new key
    }
  }

  encryptionKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const exportedKey = await crypto.subtle.exportKey('jwk', encryptionKey);
      sessionStorage.setItem(ENCRYPTION_KEY_STORAGE_KEY, JSON.stringify(exportedKey));
    } catch {
      // Ignore sessionStorage errors
    }
  }

  return encryptionKey;
}

export async function encryptData(data: unknown): Promise<EncryptedCacheData> {
  const key = await getOrCreateEphemeralSessionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedData = new TextEncoder().encode(JSON.stringify(data));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encodedData
  );

  const ivString = Array.from(iv).map((b) => String.fromCharCode(b)).join('');
  const dataString = Array.from(new Uint8Array(encrypted)).map((b) => String.fromCharCode(b)).join('');

  return {
    data: btoa(dataString),
    iv: btoa(ivString),
    timestamp: Date.now(),
  };
}

export async function decryptData(encryptedData: EncryptedCacheData): Promise<unknown> {
  const key = await getOrCreateEphemeralSessionKey();
  const ivString = atob(encryptedData.iv);
  const dataString = atob(encryptedData.data);

  const iv = new Uint8Array(ivString.length);
  for (let i = 0; i < ivString.length; i++) {
    iv[i] = ivString.charCodeAt(i);
  }

  const data = new Uint8Array(dataString.length);
  for (let i = 0; i < dataString.length; i++) {
    data[i] = dataString.charCodeAt(i);
  }

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  return JSON.parse(new TextDecoder().decode(decrypted));
}

export function createEncryptedIDBPersister(
  storageKey = STORAGE_KEY,
  maxAge = GARBAGE_COLLECTION_INTERVAL
): Persister {
  return {
    persistClient: async (persistedClient: PersistedClient) => {
      try {
        if (typeof window === 'undefined') return;
        const encrypted = await encryptData(persistedClient);
        await set(storageKey, encrypted);
        await set(CACHE_TIMESTAMP_KEY, Date.now());
      } catch (error) {
        console.error('Failed to persist query cache to IndexedDB:', error);
      }
    },
    restoreClient: async (): Promise<PersistedClient | undefined> => {
      try {
        if (typeof window === 'undefined') return undefined;

        const timestamp = await get<number>(CACHE_TIMESTAMP_KEY);
        if (timestamp && Date.now() - timestamp > maxAge) {
          await del(storageKey);
          await del(CACHE_TIMESTAMP_KEY);
          return undefined;
        }

        const encrypted = await get<EncryptedCacheData>(storageKey);
        if (!encrypted) return undefined;

        if (encrypted.timestamp && Date.now() - encrypted.timestamp > maxAge) {
          await del(storageKey);
          await del(CACHE_TIMESTAMP_KEY);
          return undefined;
        }

        const clientData = (await decryptData(encrypted)) as PersistedClient;
        return clientData;
      } catch (error) {
        console.error('Failed to restore query cache from IndexedDB:', error);
        await del(storageKey);
        await del(CACHE_TIMESTAMP_KEY);
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        if (typeof window === 'undefined') return;
        await del(storageKey);
        await del(CACHE_TIMESTAMP_KEY);
      } catch (error) {
        console.error('Failed to remove query cache from IndexedDB:', error);
      }
    },
  };
}

export async function clearCache(): Promise<void> {
  try {
    await del(STORAGE_KEY);
    await del(CACHE_TIMESTAMP_KEY);
  } catch {
    // Ignore error if storage is unavailable
  }
}

export async function performGarbageCollection(): Promise<void> {
  try {
    const timestamp = await get<number>(CACHE_TIMESTAMP_KEY);
    if (!timestamp) return;

    const now = Date.now();
    if (now - timestamp > GARBAGE_COLLECTION_INTERVAL) {
      await clearCache();
      if (queryClient) {
        queryClient.getQueryCache().clear();
      }
    }
  } catch {
    // Ignore storage errors
  }
}

function startGarbageCollection(): void {
  if (garbageCollectionInterval) return;

  garbageCollectionInterval = setInterval(() => {
    performGarbageCollection();
  }, GARBAGE_COLLECTION_INTERVAL);
}

function stopGarbageCollection(): void {
  if (garbageCollectionInterval) {
    clearInterval(garbageCollectionInterval);
    garbageCollectionInterval = null;
  }
}

export function invalidateQueriesOnChainEvent(event: ContractEvent): void {
  if (!queryClient) return;

  const invalidationMap: Record<EventType, string[][]> = {
    [EventType.AccessGranted]: [['records'], ['doctorPatients']],
    [EventType.AccessRevoked]: [['records'], ['doctorPatients']],
    [EventType.RecordShared]: [['records'], ['sharedRecords']],
    [EventType.EscrowReleased]: [['appointments'], ['payments']],
    [EventType.ConsultationCompleted]: [['appointments'], ['encounterNotes']],
    [EventType.PaymentProcessed]: [['payments'], ['appointments']],
    [EventType.DelegationCreated]: [['delegations']],
    [EventType.DelegationExpired]: [['delegations']],
  };

  const queryKeysToInvalidate = invalidationMap[event.type];
  if (queryKeysToInvalidate) {
    queryKeysToInvalidate.forEach((key) => {
      queryClient?.invalidateQueries({ queryKey: key });
    });
  }
}

function setupEventListener(): void {
  if (eventListenerId) return;

  eventListenerId = eventManager.registerListener(
    'heliora-contracts',
    Object.values(EventType),
    invalidateQueriesOnChainEvent
  );
}

function teardownEventListener(): void {
  if (eventListenerId) {
    eventManager.unregisterListener(eventListenerId);
    eventListenerId = null;
  }
}

export function createPersistedQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: GARBAGE_COLLECTION_INTERVAL,
        refetchOnWindowFocus: false,
      },
    },
  });

  queryClient = client;

  if (typeof window !== 'undefined') {
    const persister = createEncryptedIDBPersister();
    const [unsubscribe] = persistQueryClient({
      queryClient: client,
      persister,
      maxAge: GARBAGE_COLLECTION_INTERVAL,
      buster: 'v1',
    });
    unsubscribePersister = unsubscribe;

    performGarbageCollection();
    startGarbageCollection();
    setupEventListener();
  }

  return client;
}

export function getPersistedQueryClient(): QueryClient | null {
  return queryClient;
}

export function cleanupPersistedQueryCache(): void {
  stopGarbageCollection();
  teardownEventListener();
  if (unsubscribePersister) {
    unsubscribePersister();
    unsubscribePersister = null;
  }
  queryClient = null;
}
