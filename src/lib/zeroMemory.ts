/**
 * Overwrites a buffer's bytes with random data so the previous plaintext is
 * not recoverable from the underlying memory (issue #38). Wiring into
 * useWalletStore.disconnect() and the TanStack Query cache eviction are not
 * covered here - this is just the sanitization primitive.
 */
export function zeroMemory(buffer: ArrayBuffer | Uint8Array): void {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  crypto.getRandomValues(view);
  view.fill(0);
}
