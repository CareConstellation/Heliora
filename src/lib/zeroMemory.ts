/**
 * Best-effort in-memory zeroization of sensitive buffers (key material,
 * passphrase bytes, decrypted plaintext).
 *
 * JavaScript gives no hard guarantee: the engine may have copied the data (GC
 * moves, JIT, string interning), and an `ArrayBuffer` that was already
 * transferred or detached cannot be wiped. This narrows the window in which
 * secrets sit in the heap; it does not close it.
 */

/** Largest slice `crypto.getRandomValues` accepts per call. */
const RANDOM_CHUNK = 65_536

export type ZeroizableBuffer = ArrayBuffer | ArrayBufferView

function toBytes(buffer: ZeroizableBuffer): Uint8Array {
  return buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

/**
 * Overwrites `buffer` with random bytes, then with zeros, in place.
 * Safe to call on `null`/`undefined`, empty and already-detached buffers.
 */
export function zeroMemory(buffer: ZeroizableBuffer | null | undefined): void {
  if (!buffer) return
  let bytes: Uint8Array
  try {
    bytes = toBytes(buffer)
  } catch {
    return
  }
  // A detached ArrayBuffer reports a length of 0.
  if (bytes.byteLength === 0) return
  for (let offset = 0; offset < bytes.byteLength; offset += RANDOM_CHUNK) {
    crypto.getRandomValues(bytes.subarray(offset, offset + RANDOM_CHUNK))
  }
  bytes.fill(0)
}

/**
 * Runs `fn` with `buffer`, then zeroizes it in a `finally` block, so the buffer
 * is wiped whether `fn` returns or throws. Do not return the buffer itself from
 * `fn`: it will already have been zeroed.
 */
export async function withZeroized<B extends ZeroizableBuffer, T>(
  buffer: B,
  fn: (buffer: B) => Promise<T> | T,
): Promise<T> {
  try {
    return await fn(buffer)
  } finally {
    zeroMemory(buffer)
  }
}
