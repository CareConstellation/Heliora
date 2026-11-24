/**
 * @jest-environment jsdom
 */
import {
  checkDeviceMemory,
  isWasmMemoryError,
  ZkMemoryError,
} from '@/lib/zkEligibility';

describe('ZK Mobile Memory Boundary Handling (#221)', () => {
  const originalNavigator = window.navigator;

  afterEach(() => {
    Object.defineProperty(window, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  describe('checkDeviceMemory', () => {
    it('returns hasSufficientMemory: true when deviceMemory >= 4GB', () => {
      Object.defineProperty(window, 'navigator', {
        value: { deviceMemory: 8 },
        writable: true,
        configurable: true,
      });

      const res = checkDeviceMemory();
      expect(res.hasSufficientMemory).toBe(true);
      expect(res.deviceMemoryGb).toBe(8);
      expect(res.warning).toBeUndefined();
    });

    it('returns hasSufficientMemory: false and surfaces warning when deviceMemory < 4GB', () => {
      Object.defineProperty(window, 'navigator', {
        value: { deviceMemory: 2 },
        writable: true,
        configurable: true,
      });

      const res = checkDeviceMemory();
      expect(res.hasSufficientMemory).toBe(false);
      expect(res.deviceMemoryGb).toBe(2);
      expect(res.warning).toContain('below the recommended 4GB');
    });

    it('handles deviceMemory: 0.5 or 1 on constrained mobile devices', () => {
      Object.defineProperty(window, 'navigator', {
        value: { deviceMemory: 1 },
        writable: true,
        configurable: true,
      });

      const res = checkDeviceMemory();
      expect(res.hasSufficientMemory).toBe(false);
      expect(res.deviceMemoryGb).toBe(1);
      expect(res.warning).toContain('1GB');
    });

    it('defaults to hasSufficientMemory: true when deviceMemory is undefined (desktop/unsupported)', () => {
      Object.defineProperty(window, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      });

      const res = checkDeviceMemory();
      expect(res.hasSufficientMemory).toBe(true);
      expect(res.warning).toBeUndefined();
    });
  });

  describe('isWasmMemoryError and ZkMemoryError', () => {
    it('identifies RangeError out-of-memory exceptions', () => {
      const err = new RangeError('WebAssembly.Memory(): could not allocate memory');
      expect(isWasmMemoryError(err)).toBe(true);
    });

    it('identifies generic out-of-memory error messages', () => {
      const err = new Error('Out of memory');
      expect(isWasmMemoryError(err)).toBe(true);
    });

    it('identifies allocation failure errors', () => {
      const err = new Error('memory allocation failed');
      expect(isWasmMemoryError(err)).toBe(true);
    });

    it('identifies ZkMemoryError instances', () => {
      const zkErr = new ZkMemoryError('Custom OOM message', 2);
      expect(isWasmMemoryError(zkErr)).toBe(true);
      expect(zkErr.name).toBe('ZkMemoryError');
      expect(zkErr.deviceMemoryGb).toBe(2);
      expect(zkErr.message).toBe('Custom OOM message');
    });

    it('does not misclassify unrelated errors', () => {
      expect(isWasmMemoryError(new Error('Assert Failed'))).toBe(false);
      expect(isWasmMemoryError(new TypeError('Cannot read properties of undefined'))).toBe(false);
      expect(isWasmMemoryError(null)).toBe(false);
      expect(isWasmMemoryError(undefined)).toBe(false);
    });
  });
});
