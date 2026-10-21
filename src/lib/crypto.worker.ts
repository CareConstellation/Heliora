/**
 * Dedicated Web Worker for offloading Web Crypto subtle operations off the
 * main thread. Supports AES-256-GCM chunk encryption/decryption and SHA-256
 * hashing with Transferable ArrayBuffer passing for zero-copy performance.
 *
 * Message protocol: each request carries a unique `id` and an `op` discriminator.
 * The worker replies with the same `id` so the main-thread wrapper can resolve
 * the correct pending promise.
 */

/* ── Types shared between worker and main thread ─────────────────── */

export type WorkerRequest =
  | EncryptChunkRequest
  | DecryptChunkRequest
  | HashRequest
  | GenerateKeyRequest
  | EncryptFileRequest;

export type WorkerResponse =
  | EncryptChunkResponse
  | DecryptChunkResponse
  | HashResponse
  | GenerateKeyResponse
  | EncryptFileResponse
  | ErrorResponse;

interface EncryptChunkRequest {
  id: string;
  op: 'encryptChunk';
  plaintext: ArrayBuffer;
  rawKey: ArrayBuffer;
  iv: ArrayBuffer;
}

interface EncryptChunkResponse {
  id: string;
  op: 'encryptChunk';
  ciphertext: ArrayBuffer;
}

interface DecryptChunkRequest {
  id: string;
  op: 'decryptChunk';
  ciphertext: ArrayBuffer;
  rawKey: ArrayBuffer;
  iv: ArrayBuffer;
}

interface DecryptChunkResponse {
  id: string;
  op: 'decryptChunk';
  plaintext: ArrayBuffer;
}

interface HashRequest {
  id: string;
  op: 'hash';
  data: ArrayBuffer;
}

interface HashResponse {
  id: string;
  op: 'hash';
  digest: ArrayBuffer;
}

interface GenerateKeyRequest {
  id: string;
  op: 'generateKey';
}

interface GenerateKeyResponse {
  id: string;
  op: 'generateKey';
  rawKey: ArrayBuffer;
}

interface EncryptFileRequest {
  id: string;
  op: 'encryptFile';
  fileBuffer: ArrayBuffer;
}

interface EncryptFileResponse {
  id: string;
  op: 'encryptFile';
  encryptedBuffer: ArrayBuffer;
  iv: ArrayBuffer;
  rawKey: ArrayBuffer;
}

interface ErrorResponse {
  id: string;
  op: 'error';
  message: string;
}

/* ── Worker message handler ──────────────────────────────────────── */

interface WorkerScope {
  addEventListener(type: 'message', listener: (e: MessageEvent<WorkerRequest>) => void): void;
  postMessage(msg: unknown, transfer: Transferable[]): void;
}

const ctx: WorkerScope = globalThis as unknown as WorkerScope;

async function importRawAesKey(
  raw: ArrayBuffer,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, usages);
}

async function handleMessage(req: WorkerRequest): Promise<void> {
  switch (req.op) {
    case 'encryptChunk': {
      const key = await importRawAesKey(req.rawKey, ['encrypt']);
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: new Uint8Array(req.iv) },
        key,
        req.plaintext,
      );
      ctx.postMessage(
        { id: req.id, op: 'encryptChunk', ciphertext } satisfies EncryptChunkResponse,
        [ciphertext],
      );
      return;
    }
    case 'decryptChunk': {
      const key = await importRawAesKey(req.rawKey, ['decrypt']);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(req.iv) },
        key,
        req.ciphertext,
      );
      ctx.postMessage(
        { id: req.id, op: 'decryptChunk', plaintext } satisfies DecryptChunkResponse,
        [plaintext],
      );
      return;
    }
    case 'hash': {
      const digest = await crypto.subtle.digest('SHA-256', req.data);
      ctx.postMessage({ id: req.id, op: 'hash', digest } satisfies HashResponse, [digest]);
      return;
    }
    case 'generateKey': {
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      );
      const rawKey = await crypto.subtle.exportKey('raw', key);
      ctx.postMessage(
        { id: req.id, op: 'generateKey', rawKey } satisfies GenerateKeyResponse,
        [rawKey],
      );
      return;
    }
    case 'encryptFile': {
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encryptedBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        req.fileBuffer,
      );
      const rawKey = await crypto.subtle.exportKey('raw', key);
      ctx.postMessage(
        {
          id: req.id,
          op: 'encryptFile',
          encryptedBuffer,
          iv: iv.buffer,
          rawKey,
        } satisfies EncryptFileResponse,
        [encryptedBuffer, iv.buffer, rawKey],
      );
      return;
    }
  }
}

ctx.addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
  handleMessage(e.data).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : 'Worker operation failed';
    ctx.postMessage({ id: e.data.id, op: 'error', message } satisfies ErrorResponse, []);
  });
});
