import { zeroMemory, withZeroized } from '@/lib/zeroMemory';

const nonZero = (bytes: Uint8Array) => bytes.some((b) => b !== 0);

describe('zeroMemory', () => {
  it('zeroes a Uint8Array in place', () => {
    const key = new Uint8Array(32).fill(0xab);
    zeroMemory(key);
    expect(nonZero(key)).toBe(false);
    expect(key).toHaveLength(32);
  });

  it('zeroes an ArrayBuffer in place', () => {
    const buf = new Uint8Array([1, 2, 3, 4]).buffer;
    zeroMemory(buf);
    expect(nonZero(new Uint8Array(buf))).toBe(false);
  });

  it('only wipes the viewed window of a subarray', () => {
    const whole = new Uint8Array(8).fill(7);
    zeroMemory(whole.subarray(2, 6));
    expect(Array.from(whole)).toEqual([7, 7, 0, 0, 0, 0, 7, 7]);
  });

  it('wipes typed arrays other than Uint8Array', () => {
    const words = new Uint32Array([0xdeadbeef, 0xcafebabe]);
    zeroMemory(words);
    expect(Array.from(words)).toEqual([0, 0]);
  });

  it('overwrites with random bytes before zeroing', () => {
    const spy = jest.spyOn(crypto, 'getRandomValues');
    zeroMemory(new Uint8Array(16).fill(1));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('handles buffers larger than the getRandomValues limit', () => {
    const big = new Uint8Array(70_000).fill(1);
    expect(() => zeroMemory(big)).not.toThrow();
    expect(nonZero(big)).toBe(false);
  });

  it('is a no-op for null, undefined and empty buffers', () => {
    expect(() => zeroMemory(null)).not.toThrow();
    expect(() => zeroMemory(undefined)).not.toThrow();
    expect(() => zeroMemory(new Uint8Array(0))).not.toThrow();
  });
});

describe('withZeroized', () => {
  it('returns the callback result and wipes the buffer afterwards', async () => {
    const key = new Uint8Array(4).fill(9);
    const result = await withZeroized(key, (k) => k.length);
    expect(result).toBe(4);
    expect(nonZero(key)).toBe(false);
  });

  it('wipes the buffer even when the callback throws', async () => {
    const key = new Uint8Array(4).fill(9);
    await expect(
      withZeroized(key, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(nonZero(key)).toBe(false);
  });

  it('wipes the buffer when an async callback rejects', async () => {
    const key = new Uint8Array(4).fill(9);
    await expect(withZeroized(key, async () => Promise.reject(new Error('nope')))).rejects.toThrow('nope');
    expect(nonZero(key)).toBe(false);
  });
});
