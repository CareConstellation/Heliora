import {
  auditEntropySource,
  checkSecurityContext,
  CryptographicFaultError,
} from '@/lib/crypto';

describe('Entropy Source Auditing (#43)', () => {
  it('passes on standard cryptographic entropy source', () => {
    expect(() => auditEntropySource()).not.toThrow();
  });

  it('throws CryptographicFaultError when crypto.getRandomValues is missing', () => {
    const brokenCrypto = {} as unknown as Crypto;
    expect(() => auditEntropySource(brokenCrypto)).toThrow(CryptographicFaultError);
  });

  it('throws CryptographicFaultError when PRNG returns identical consecutive buffers (stuck PRNG)', () => {
    const staticCrypto = {
      getRandomValues: (buffer: Uint8Array) => {
        // Return identical predictable pattern
        buffer.fill(42);
        return buffer;
      },
    } as unknown as Crypto;

    expect(() => auditEntropySource(staticCrypto)).toThrow(CryptographicFaultError);
  });

  it('throws CryptographicFaultError when entropy fails Repetition Count Test (repeated bytes)', () => {
    let call = 0;
    const repeatingCrypto = {
      getRandomValues: (buffer: Uint8Array) => {
        for (let i = 0; i < buffer.length; i++) {
          buffer[i] = call === 0 ? (i < 30 ? 7 : (i % 256)) : ((i + 1) % 256);
        }
        call++;
        return buffer;
      },
    } as unknown as Crypto;

    expect(() => auditEntropySource(repeatingCrypto)).toThrow(
      /Repetition Count Test failed/,
    );
  });

  it('throws CryptographicFaultError when PRNG fails monobit distribution test', () => {
    let call = 0;
    const zeroBiasedCrypto = {
      getRandomValues: (buffer: Uint8Array) => {
        for (let i = 0; i < buffer.length; i++) {
          buffer[i] = call === 0 ? (i % 2 === 0 ? 0 : 1) : (i % 2 === 0 ? 2 : 0);
        }
        call++;
        return buffer;
      },
    } as unknown as Crypto;

    expect(() => auditEntropySource(zeroBiasedCrypto)).toThrow(
      /Entropy failed monobit distribution test/,
    );
  });

  it('throws CryptographicFaultError when PRNG fails symbol diversity test', () => {
    let call = 0;
    const lowDiversityCrypto = {
      getRandomValues: (buffer: Uint8Array) => {
        for (let i = 0; i < buffer.length; i++) {
          buffer[i] = (i + call) % 10; // only 10 unique values
        }
        call++;
        return buffer;
      },
    } as unknown as Crypto;

    expect(() => auditEntropySource(lowDiversityCrypto)).toThrow(
      CryptographicFaultError,
    );
  });

  it('checks security context without crashing', () => {
    const status = checkSecurityContext();
    expect(status).toHaveProperty('isSecureContext');
    expect(status).toHaveProperty('isIframe');
    expect(status).toHaveProperty('isSandboxed');
  });
});
