import '@testing-library/jest-dom';
import { webcrypto } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';

// jsdom does not implement SubtleCrypto; polyfill with Node's Web Crypto implementation.
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}

// jsdom does not expose the WHATWG encoding globals that Node provides.
if (typeof globalThis.TextEncoder === 'undefined' || typeof globalThis.TextDecoder === 'undefined') {
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

// jsdom's File/Blob implementations lack arrayBuffer(), which the crypto and
// upload tests rely on. FileReader is available in jsdom, so use it as a shim.
function installArrayBufferShim(target: { prototype: object } | undefined) {
  if (!target || typeof (target.prototype as { arrayBuffer?: unknown }).arrayBuffer === 'function') {
    return;
  }
  Object.defineProperty(target.prototype, 'arrayBuffer', {
    configurable: true,
    writable: true,
    value(this: Blob): Promise<ArrayBuffer> {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
        reader.readAsArrayBuffer(this);
      });
    },
  });
}

installArrayBufferShim(typeof File !== 'undefined' ? File : undefined);
installArrayBufferShim(typeof Blob !== 'undefined' ? Blob : undefined);
