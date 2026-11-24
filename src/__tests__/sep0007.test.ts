import { Keypair, TransactionBuilder, Networks, Operation, Asset } from '@stellar/stellar-sdk';
import {
  generateSEP0007URI,
  parseSEP0007URI,
  getTransactionHashFromXDR,
  generateQRCode,
  streamHorizonTransaction,
  isMobileDevice,
  createDeepLink,
} from '@/lib/sep0007';

describe('SEP-0007 URI Handler & Mobile Signing (#192)', () => {
  let sampleXdr: string;
  let sampleHash: string;
  const source = Keypair.random();

  beforeAll(() => {
    const tx = new TransactionBuilder(
      new (require('@stellar/stellar-sdk').Account)(source.publicKey(), '100'),
      {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
      },
    )
      .addOperation(
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: Asset.native(),
          amount: '10.5',
        }),
      )
      .setTimeout(300)
      .build();

    sampleXdr = tx.toXDR();
    sampleHash = tx.hash().toString('hex');
  });

  describe('generateSEP0007URI', () => {
    it('generates standard web+stellar:tx URI with required xdr', () => {
      const uri = generateSEP0007URI({ xdr: sampleXdr });
      expect(uri).toContain('web+stellar:tx?');
      expect(uri).toContain(`xdr=${encodeURIComponent(sampleXdr)}`);
    });

    it('appends optional parameters: callback, chain_id, pubkey, and msg', () => {
      const uri = generateSEP0007URI({
        xdr: sampleXdr,
        callback: 'https://heliora.io/callback',
        chainId: 'testnet',
        networkPassphrase: Networks.TESTNET,
        pubkey: source.publicKey(),
        message: 'Sign consultation escrow payment',
      });

      expect(uri).toContain(`callback=${encodeURIComponent('https://heliora.io/callback')}`);
      expect(uri).toContain('chain_id=testnet');
      expect(uri).toContain('network_passphrase=Test+SDF+Network+%3B+September+2015');
      expect(uri).toContain(`pubkey=${source.publicKey()}`);
      expect(uri).toContain('msg=Sign+consultation+escrow+payment');
    });
  });

  describe('parseSEP0007URI', () => {
    it('accurately parses standard web+stellar:tx URI with all parameters', () => {
      const original = {
        xdr: sampleXdr,
        callback: 'https://api.heliora.io/tx-callback',
        chainId: 'testnet',
        networkPassphrase: Networks.TESTNET,
        pubkey: source.publicKey(),
        message: 'Medical Record Access Authorization',
      };

      const uri = generateSEP0007URI(original);
      const parsed = parseSEP0007URI(uri);

      expect(parsed.xdr).toBe(sampleXdr);
      expect(parsed.callback).toBe('https://api.heliora.io/tx-callback');
      expect(parsed.chainId).toBe('testnet');
      expect(parsed.networkPassphrase).toBe(Networks.TESTNET);
      expect(parsed.pubkey).toBe(source.publicKey());
      expect(parsed.message).toBe('Medical Record Access Authorization');
    });

    it('parses stellar:tx scheme variant and url:callback parameter', () => {
      const uri = `stellar:tx?xdr=${encodeURIComponent(sampleXdr)}&url:callback=${encodeURIComponent('https://callback.io')}&message=TestMsg`;
      const parsed = parseSEP0007URI(uri);

      expect(parsed.xdr).toBe(sampleXdr);
      expect(parsed.callback).toBe('https://callback.io');
      expect(parsed.message).toBe('TestMsg');
    });

    it('throws error when scheme is invalid', () => {
      expect(() => parseSEP0007URI('https://example.com?xdr=abc')).toThrow(
        'Invalid URI scheme',
      );
    });

    it('throws error when xdr parameter is missing', () => {
      expect(() => parseSEP0007URI('web+stellar:tx?callback=https://x.com')).toThrow(
        'Missing required "xdr"',
      );
    });
  });

  describe('getTransactionHashFromXDR', () => {
    it('computes exact transaction hash matching the envelope', () => {
      const computedHash = getTransactionHashFromXDR(sampleXdr, Networks.TESTNET);
      expect(computedHash).toBe(sampleHash);
    });
  });

  describe('generateQRCode', () => {
    it('generates high-density QR code data URL', async () => {
      const result = await generateQRCode(
        { xdr: sampleXdr, message: 'Test QR' },
        { width: 300, errorCorrectionLevel: 'H' },
      );

      expect(result.uri).toContain('web+stellar:tx?');
      expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    });
  });

  describe('streamHorizonTransaction', () => {
    const originalFetch = globalThis.fetch;
    const originalEventSource = globalThis.EventSource;

    afterEach(() => {
      globalThis.fetch = originalFetch;
      globalThis.EventSource = originalEventSource;
      jest.clearAllTimers();
    });

    it('confirms transaction via polling fallback when EventSource is not present', async () => {
      jest.useFakeTimers();
      (globalThis as any).EventSource = undefined;

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ hash: sampleHash, ledger_attr: 12345 }),
      });
      globalThis.fetch = mockFetch;

      const onConfirmed = jest.fn();
      const onError = jest.fn();

      const stop = streamHorizonTransaction({
        hash: sampleHash,
        horizonUrl: 'https://horizon-testnet.stellar.org',
        onConfirmed,
        onError,
        pollIntervalMs: 1000,
      });

      // Allow initial check promise to resolve
      await Promise.resolve();
      await Promise.resolve();

      expect(onConfirmed).toHaveBeenCalledWith({ hash: sampleHash, ledger: 12345 });
      stop();
      jest.useRealTimers();
    });

    it('triggers timeout error when transaction is not confirmed within timeoutMs', () => {
      jest.useFakeTimers();
      (globalThis as any).EventSource = undefined;

      globalThis.fetch = jest.fn().mockResolvedValue({ ok: false });

      const onConfirmed = jest.fn();
      const onError = jest.fn();

      streamHorizonTransaction({
        hash: sampleHash,
        onConfirmed,
        onError,
        timeoutMs: 5000,
        pollIntervalMs: 1000,
      });

      jest.advanceTimersByTime(5100);

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toContain('timed out');
      expect(onConfirmed).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('mobile helpers', () => {
    it('creates deep link request object', () => {
      const link = createDeepLink(sampleXdr, 'https://heliora.io/cb', 'Signing prompt');
      expect(link.xdr).toBe(sampleXdr);
      expect(link.callback).toBe('https://heliora.io/cb');
      expect(link.message).toBe('Signing prompt');
    });

    it('isMobileDevice checks user agent string safely', () => {
      expect(typeof isMobileDevice()).toBe('boolean');
    });
  });
});
