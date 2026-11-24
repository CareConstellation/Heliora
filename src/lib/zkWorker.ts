/**
 * Web Worker wrapper around snarkjs Groth16 proving for eligibility circuits.
 *
 * Witness generation and proving are the expensive part of a zero-knowledge
 * proof (several hundred milliseconds to a few seconds, hundreds of MB of
 * temporary allocations). Running them on the main thread blocks rendering, so
 * this module moves the work to a dedicated worker and streams coarse progress
 * stages back to the UI.
 *
 * The worker also verifies the SHA-256 digest of the circuit artifacts
 * (`<circuit>.wasm`, `<circuit>.zkey`, `<circuit>.vkey.json`) before proving.
 * A mismatching artifact is rejected and no proof is produced.
 *
 * The credential input is serialised to a `Uint8Array`, transferred to the
 * worker, parsed, and the buffer is zeroed immediately so the private witness
 * does not linger in memory. Artifact buffers are zeroed after proving.
 *
 * When `Worker` is unavailable (SSR, jsdom, old browsers) the same pipeline
 * runs inline, so callers get identical results at the cost of blocking.
 */

import { createZkWorker } from './zkWorkerFactory';

export interface ZkArtifactHashes {
  wasm: string;
  zkey: string;
  'vkey.json': string;
}

export interface ZkProveJob {
  /** Circuit basename, e.g. `age_eligibility`. */
  circuit: string;
  /** Circuit input; private values stay local. */
  input: Record<string, unknown>;
  wasmUrl: string;
  zkeyUrl: string;
  vkeyUrl: string;
  /** Pinned digests the downloaded artifacts must match. */
  expectedSha256: ZkArtifactHashes;
}

export interface ZkProofResult {
  proof: unknown;
  publicSignals: string[];
}

export type ZkProgressStage = 'artifacts' | 'integrity' | 'witness' | 'prove' | 'done';

export interface ZkProofProgress {
  stage: ZkProgressStage;
  /** Monotonic 0–100, suitable for a progress bar. */
  percent: number;
}

export interface ZkProveOptions {
  onProgress?: (progress: ZkProofProgress) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
}

type SerializedJob = Omit<ZkProveJob, 'input'> & { inputJson: Uint8Array };

export type ZkWorkerRequest = {
  id: string;
  op: 'prove';
  job: SerializedJob;
};

export type ZkWorkerResponse =
  | { id: string; op: 'progress'; progress: ZkProofProgress }
  | { id: string; op: 'result'; result: ZkProofResult }
  | { id: string; op: 'error'; message: string };

const DEFAULT_TIMEOUT_MS = 120_000;

/** Digest of `bytes` as lowercase hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as unknown as BufferSource,
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

async function verifyArtifact(
  url: string,
  expected: string,
  label: keyof ZkArtifactHashes,
): Promise<Uint8Array> {
  const bytes = await download(url);
  const actual = await sha256Hex(bytes);
  if (!expected || actual !== expected.toLowerCase()) {
    bytes.fill(0);
    throw new Error(
      `Refusing to prove: ${label} digest mismatch at ${url} (expected ${expected || 'a pinned hash'}, got ${actual}).`,
    );
  }
  return bytes;
}

/**
 * Proving pipeline shared by the worker and the inline fallback.
 *
 * Time:  O(constraints + artifact bytes) — dominated by `groth16.fullProve`.
 * Space: O(artifact bytes) — three artifact copies plus snarkjs working memory;
 *        artifact buffers are zeroed once the proof is computed.
 */
export async function runZkProof(
  job: ZkProveJob,
  report: (progress: ZkProofProgress) => void = () => {},
): Promise<ZkProofResult> {
  report({ stage: 'artifacts', percent: 5 });
  // The verification key is not needed for proving, only its digest, so check
  // and discard it first (it is small; the large wasm/zkey follow).
  const vkey = await verifyArtifact(job.vkeyUrl, job.expectedSha256['vkey.json'], 'vkey.json');
  vkey.fill(0);
  const wasm = await verifyArtifact(job.wasmUrl, job.expectedSha256.wasm, 'wasm');
  report({ stage: 'artifacts', percent: 15 });
  const zkey = await verifyArtifact(job.zkeyUrl, job.expectedSha256.zkey, 'zkey');
  report({ stage: 'integrity', percent: 30 });

  const { groth16 } = await import('snarkjs');
  try {
    report({ stage: 'witness', percent: 40 });
    report({ stage: 'prove', percent: 60 });
    const { proof, publicSignals } = await groth16.fullProve(job.input, wasm, zkey);
    report({ stage: 'done', percent: 100 });
    return { proof, publicSignals };
  } finally {
    wasm.fill(0);
    zkey.fill(0);
  }
}

/* ── Worker side ─────────────────────────────────────────────────── */

const workerScope = globalThis as unknown as {
  WorkerGlobalScope?: unknown;
  onmessage?: ((e: MessageEvent<ZkWorkerRequest>) => void) | null;
  postMessage?: (message: ZkWorkerResponse, transfer?: Transferable[]) => void;
};

function isDedicatedWorker(): boolean {
  return (
    typeof workerScope.WorkerGlobalScope !== 'undefined' &&
    typeof workerScope.postMessage === 'function' &&
    typeof (globalThis as { window?: unknown }).window === 'undefined'
  );
}

function installWorker(): void {
  workerScope.onmessage = (event) => {
    const { id, op, job } = event.data;
    if (op !== 'prove') return;
    const send = (message: ZkWorkerResponse) => workerScope.postMessage?.(message);

    // The input arrives as bytes so the sender can drop its copy; wipe ours as
    // soon as it has been parsed into the (short-lived) circuit input object.
    const json = new TextDecoder().decode(job.inputJson);
    job.inputJson.fill(0);
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(json) as Record<string, unknown>;
    } catch {
      send({ id, op: 'error', message: 'Malformed circuit input.' });
      return;
    }

    void runZkProof({ ...job, input }, (progress) => send({ id, op: 'progress', progress }))
      .then((result) => {
        // Proof points are public, but the witness is not: release it now.
        input = {};
        send({ id, op: 'result', result });
      })
      .catch((err: unknown) => {
        input = {};
        send({ id, op: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  };
}

if (isDedicatedWorker()) installWorker();

/* ── Main-thread client ──────────────────────────────────────────── */

interface Pending {
  resolve: (result: ZkProofResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  onProgress?: (progress: ZkProofProgress) => void;
}

let worker: Worker | null = null;
const pending = new Map<string, Pending>();
let idCounter = 0;

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = createZkWorker();
  } catch {
    return null;
  }
  worker.addEventListener('message', (event: MessageEvent<ZkWorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    if (message.op === 'progress') {
      entry.onProgress?.(message.progress);
      return;
    }
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.op === 'error') entry.reject(new Error(message.message));
    else entry.resolve(message.result);
  });
  worker.addEventListener('error', (event) => {
    // The worker is unusable after a top-level error: drop it so the next call
    // starts a fresh one.
    worker = null;
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(event.message || 'Zero-knowledge worker error.'));
      pending.delete(id);
    }
  });
  return worker;
}

/**
 * Generates a proof, off the main thread when workers are available.
 *
 * Resolves with the Groth16 proof and public signals. Rejects on artifact
 * digest mismatch, invalid witness (false claim), timeout, or abort.
 */
export function proveInWorker(job: ZkProveJob, opts: ZkProveOptions = {}): Promise<ZkProofResult> {
  const { onProgress, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = opts;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    // snarkjs takes BigInt field elements; JSON has no BigInt, so send them as
    // decimal strings, which snarkjs parses identically.
    const inputJson = new TextEncoder().encode(
      JSON.stringify(job.input, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );
    const worker = getWorker();
    if (!worker) {
      // Inline fallback: wipe the serialised copy and run the same pipeline.
      inputJson.fill(0);
      runZkProof(job, onProgress).then(resolve, reject);
      return;
    }

    const id = `zk_${++idCounter}_${Date.now()}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Zero-knowledge proving timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      pending.delete(id);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    pending.set(id, {
      resolve: (result) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      },
      reject: (err) => {
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      },
      timer,
      ...(onProgress ? { onProgress } : {}),
    });

    const request: ZkWorkerRequest = {
      id,
      op: 'prove',
      job: {
        circuit: job.circuit,
        wasmUrl: job.wasmUrl,
        zkeyUrl: job.zkeyUrl,
        vkeyUrl: job.vkeyUrl,
        expectedSha256: job.expectedSha256,
        inputJson,
      },
    };
    // Transfer the input buffer: the main thread no longer needs the witness.
    worker.postMessage(request, [inputJson.buffer]);
  });
}

/** Tears the worker down and rejects in-flight proofs (e.g. on unmount). */
export function terminateZkWorker(): void {
  worker?.terminate();
  worker = null;
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error('Zero-knowledge worker terminated.'));
    pending.delete(id);
  }
}
