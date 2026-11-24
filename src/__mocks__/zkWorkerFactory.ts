// Jest cannot parse `import.meta`. Construct whatever global `Worker` a test
// installs; without one, zkWorker.ts never calls this and proves inline.
export function createZkWorker(): Worker {
  return new Worker('zkWorker.ts', { type: 'module' });
}
