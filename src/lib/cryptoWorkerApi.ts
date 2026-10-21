/**
 * Promise-based API over the crypto Web Worker (`crypto.worker.ts`).
 *
 * Each public method sends a structured message and returns a promise that
 * resolves when the worker posts the result. All ArrayBuffer arguments are
 * transferred (zero-copy) to avoid duplicating large file buffers.
 *
 * ## Timeout
 * Every call accepts an optional `timeoutMs` (default 30 s). If the worker
 * does not respond in time, the promise rejects and the pending entry is
 * cleaned up.
 *
 * ## Cancellation
 * Every call accepts an optional `AbortSignal`. Aborting rejects the promise
 * immediately without waiting for the worker.
 *
 * ## Lifecycle
 * A singleton worker is lazily created on first call and reused for the
 * lifetime of the page. Call {@link terminate} to shut it down (e.g. on
 * unmount or when switching away from the records view).
 *
 * ## Complexity
 * Time: O(n) per operation where n is the input byte length (dominated by
 * the underlying AES-GCM or SHA-256 pass). Space: O(n) for the transferred
 * buffer; the main thread releases its reference on transfer.
 */

import type { WorkerRequest, WorkerResponse } from './crypto.worker';

const DEFAULT_TIMEOUT_MS = 30_000;

type Pending = {
  resolve: (resp: WorkerResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let worker: Worker | null = null;
const pending = new Map<string, Pending>();
let idCounter = 0;

function nextId(): string {
  return `cw_${++idCounter}_${Date.now()}`;
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./crypto.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
      const entry = pending.get(e.data.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(e.data.id);
      if (e.data.op === 'error') {
        entry.reject(new Error(e.data.message));
      } else {
        entry.resolve(e.data);
      }
    });
    worker.addEventListener('error', (e) => {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(e.message || 'Worker error'));
        pending.delete(id);
      }
    });
  }
  return worker;
}

function sendRequest(
  req: WorkerRequest,
  transfer: Transferable[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const id = req.id;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Crypto worker timed out after ${timeoutMs}ms (op: ${req.op})`));
    }, timeoutMs);

    const entry: Pending = { resolve, reject, timer };
    pending.set(id, entry);

    const onAbort = () => {
      clearTimeout(timer);
      pending.delete(id);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    getWorker().postMessage(req, transfer);
  });
}

/* ── Public API ──────────────────────────────────────────────────── */

interface WorkerCallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function workerEncryptChunk(
  plaintext: ArrayBuffer,
  rawKey: ArrayBuffer,
  iv: ArrayBuffer,
  opts?: WorkerCallOptions,
): Promise<ArrayBuffer> {
  const id = nextId();
  const resp = await sendRequest(
    { id, op: 'encryptChunk', plaintext, rawKey, iv },
    [plaintext],
    opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    opts?.signal,
  );
  return (resp as Extract<WorkerResponse, { op: 'encryptChunk' }>).ciphertext;
}

export async function workerDecryptChunk(
  ciphertext: ArrayBuffer,
  rawKey: ArrayBuffer,
  iv: ArrayBuffer,
  opts?: WorkerCallOptions,
): Promise<ArrayBuffer> {
  const id = nextId();
  const resp = await sendRequest(
    { id, op: 'decryptChunk', ciphertext, rawKey, iv },
    [ciphertext],
    opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    opts?.signal,
  );
  return (resp as Extract<WorkerResponse, { op: 'decryptChunk' }>).plaintext;
}

export async function workerHash(
  data: ArrayBuffer,
  opts?: WorkerCallOptions,
): Promise<ArrayBuffer> {
  const id = nextId();
  const resp = await sendRequest(
    { id, op: 'hash', data },
    [data],
    opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    opts?.signal,
  );
  return (resp as Extract<WorkerResponse, { op: 'hash' }>).digest;
}

export async function workerGenerateKey(
  opts?: WorkerCallOptions,
): Promise<ArrayBuffer> {
  const id = nextId();
  const resp = await sendRequest(
    { id, op: 'generateKey' },
    [],
    opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    opts?.signal,
  );
  return (resp as Extract<WorkerResponse, { op: 'generateKey' }>).rawKey;
}

export async function workerEncryptFile(
  fileBuffer: ArrayBuffer,
  opts?: WorkerCallOptions,
): Promise<{ encryptedBuffer: ArrayBuffer; iv: ArrayBuffer; rawKey: ArrayBuffer }> {
  const id = nextId();
  const resp = await sendRequest(
    { id, op: 'encryptFile', fileBuffer },
    [fileBuffer],
    opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    opts?.signal,
  );
  const r = resp as Extract<WorkerResponse, { op: 'encryptFile' }>;
  return { encryptedBuffer: r.encryptedBuffer, iv: r.iv, rawKey: r.rawKey };
}

export function terminate(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Worker terminated'));
      pending.delete(id);
    }
  }
}
