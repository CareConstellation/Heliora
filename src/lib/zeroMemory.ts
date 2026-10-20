/**
 * Overwrites a buffer's bytes with random data so the previous plaintext is
 * not recoverable from the underlying memory (issue #38). Wiring into
 * useWalletStore.disconnect() and the TanStack Query cache eviction are not
 * covered here - this is just the sanitization primitive.
 */
export function zeroMemory(buffer: ArrayBuffer | Uint8Array): void {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  try {
    // getRandomValues rejects buffers over 65536 bytes - chunk it.
    for (let i = 0; i < view.length; i += 65536) {
      crypto.getRandomValues(view.subarray(i, Math.min(i + 65536, view.length)));
    }
  } finally {
    view.fill(0);
  }
}
