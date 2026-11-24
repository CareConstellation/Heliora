/**
 * Spawns the zero-knowledge proving worker.
 *
 * Kept in its own module because `import.meta.url` (which bundlers need to
 * emit the worker chunk) cannot be parsed by CommonJS test runners; Jest maps
 * this file to `src/__mocks__/zkWorkerFactory.ts`, which forces the inline
 * proving fallback.
 */
export function createZkWorker(): Worker {
  return new Worker(new URL('./zkWorker.ts', import.meta.url), { type: 'module' });
}
