/**
 * @jest-environment node
 */
import type { ZkProveJob, ZkWorkerResponse } from '@/lib/zkWorker';

const mockFullProve = jest.fn(async () => ({
  proof: { pi_a: ['1', '2', '1'] },
  publicSignals: ['20000101', '42'],
}));

jest.mock('snarkjs', () => ({ groth16: { fullProve: () => mockFullProve() } }));

const encoder = new TextEncoder();

function artifactBytes(url: string): Uint8Array {
  return encoder.encode(`artifact:${url}`);
}

async function jobWithHashes(
  mod: typeof import('@/lib/zkWorker'),
  overrides: Partial<ZkProveJob> = {},
): Promise<ZkProveJob> {
  const job: ZkProveJob = {
    circuit: 'age_eligibility',
    input: { birthDate: 19900101, salt: '7', cutoffDate: 20080101, commitment: '42' },
    wasmUrl: '/zk/age_eligibility.wasm',
    zkeyUrl: '/zk/age_eligibility.zkey',
    vkeyUrl: '/zk/age_eligibility.vkey.json',
    expectedSha256: {
      wasm: '',
      zkey: '',
      'vkey.json': '',
    },
    ...overrides,
  };
  job.expectedSha256 = {
    wasm: await mod.sha256Hex(artifactBytes(job.wasmUrl)),
    zkey: await mod.sha256Hex(artifactBytes(job.zkeyUrl)),
    'vkey.json': await mod.sha256Hex(artifactBytes(job.vkeyUrl)),
    ...overrides.expectedSha256,
  };
  return job;
}

beforeEach(() => {
  mockFullProve.mockClear();
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const bytes = artifactBytes(String(input));
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
    } as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  delete (globalThis as { Worker?: unknown }).Worker;
});

describe('proveInWorker', () => {
  it('runs inline when Worker is unavailable and streams monotonic progress', async () => {
    const mod = await import('@/lib/zkWorker');
    const job = await jobWithHashes(mod);
    const seen: number[] = [];

    const result = await mod.proveInWorker(job, {
      onProgress: (p) => seen.push(p.percent),
    });

    expect(result.publicSignals).toEqual(['20000101', '42']);
    expect(mockFullProve).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(-1)).toBe(100);
  });

  it('rejects tampered artifacts before proving', async () => {
    const mod = await import('@/lib/zkWorker');
    const job = await jobWithHashes(mod, {
      expectedSha256: {
        wasm: 'f'.repeat(64),
        zkey: 'f'.repeat(64),
        'vkey.json': 'f'.repeat(64),
      },
    });

    await expect(mod.proveInWorker(job)).rejects.toThrow(/digest mismatch/);
    expect(mockFullProve).not.toHaveBeenCalled();
  });

  it('refuses artifacts with no pinned digest', async () => {
    const mod = await import('@/lib/zkWorker');
    const job = await jobWithHashes(mod, {
      expectedSha256: { wasm: '', zkey: '', 'vkey.json': '' },
    });

    await expect(mod.proveInWorker(job)).rejects.toThrow(/Refusing to prove/);
    expect(mockFullProve).not.toHaveBeenCalled();
  });

  it('posts the job to a worker and resolves from its messages', async () => {
    const mod = await import('@/lib/zkWorker');
    const job = await jobWithHashes(mod);
    const posted: { message: { id: string }; transfer: Transferable[] }[] = [];

    class FakeWorker {
      private listeners = new Map<string, (event: MessageEvent) => void>();
      constructor(_url: URL, _opts: WorkerOptions) {}
      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        this.listeners.set(type, listener);
      }
      postMessage(message: { id: string }, transfer: Transferable[]) {
        posted.push({ message, transfer });
        const emit = (data: ZkWorkerResponse) =>
          this.listeners.get('message')?.({ data } as MessageEvent);
        queueMicrotask(() => {
          emit({ id: message.id, op: 'progress', progress: { stage: 'witness', percent: 40 } });
          emit({
            id: message.id,
            op: 'result',
            result: { proof: { pi_a: ['1'] }, publicSignals: ['20000101', '42'] },
          });
        });
      }
      terminate() {}
    }
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;

    const progress: number[] = [];
    const result = await mod.proveInWorker(job, {
      onProgress: (p) => progress.push(p.percent),
    });

    expect(result.publicSignals).toEqual(['20000101', '42']);
    expect(progress).toEqual([40]);
    expect(posted).toHaveLength(1);
    // The witness buffer is transferred, not cloned.
    expect(posted[0]!.transfer).toHaveLength(1);
    expect(mockFullProve).not.toHaveBeenCalled();

    mod.terminateZkWorker();
  });

  it('rejects when the worker reports an error', async () => {
    const mod = await import('@/lib/zkWorker');
    const job = await jobWithHashes(mod);

    class ErrorWorker {
      private listeners = new Map<string, (event: MessageEvent) => void>();
      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        this.listeners.set(type, listener);
      }
      postMessage(message: { id: string }) {
        queueMicrotask(() =>
          this.listeners.get('message')?.({
            data: { id: message.id, op: 'error', message: 'Assert Failed' },
          } as MessageEvent),
        );
      }
      terminate() {}
    }
    (globalThis as { Worker?: unknown }).Worker = ErrorWorker;

    await expect(mod.proveInWorker(job)).rejects.toThrow('Assert Failed');
    mod.terminateZkWorker();
  });
});
