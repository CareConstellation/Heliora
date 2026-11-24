import { exportRecipientPublicKey } from '@/lib/crypto';

const DB_NAME = 'heliora-envelope-keys';
const STORE = 'recipient-keys';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getKey(id: string): Promise<CryptoKeyPair | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as CryptoKeyPair | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function setKey(id: string, keyPair: CryptoKeyPair): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(keyPair, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadOrCreateRecipientKeyPair(recipientId: string): Promise<CryptoKeyPair> {
  const existing = await getKey(recipientId);
  if (existing) return existing;
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  await setKey(recipientId, keyPair);
  return keyPair;
}

export async function exportRecipientPublicJwk(recipientId: string): Promise<JsonWebKey> {
  const keyPair = await loadOrCreateRecipientKeyPair(recipientId);
  return exportRecipientPublicKey(keyPair);
}
