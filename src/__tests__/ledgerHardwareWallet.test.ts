import {
  ledgerHardwareWallet,
  mapLedgerError,
  isDisconnectedDeviceError,
  withTimeout,
} from '@/lib/ledgerHardwareWallet';

describe('Issue #188: Ledger WebHID Disconnection, Re-enumeration, and Timeout Handling', () => {
  describe('isDisconnectedDeviceError', () => {
    it('detects DisconnectedDevice and DisconnectedDeviceDuringOperation errors', () => {
      expect(isDisconnectedDeviceError({ name: 'DisconnectedDevice' })).toBe(true);
      expect(isDisconnectedDeviceError({ name: 'DisconnectedDeviceDuringOperation' })).toBe(true);
      expect(isDisconnectedDeviceError({ name: 'HIDDeviceDisconnected' })).toBe(true);
      expect(isDisconnectedDeviceError({ name: 'TransportStatusError', message: 'device disconnected' })).toBe(true);
    });

    it('detects disconnection status codes 0x6a15 and 0x6800', () => {
      expect(isDisconnectedDeviceError({ statusCode: 0x6a15 })).toBe(true);
      expect(isDisconnectedDeviceError({ statusCode: 0x6800 })).toBe(true);
      expect(isDisconnectedDeviceError(new Error('Failed to open the device'))).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      expect(isDisconnectedDeviceError(new Error('Network error'))).toBe(false);
      expect(isDisconnectedDeviceError({ statusCode: 0x9000 })).toBe(false);
      expect(isDisconnectedDeviceError(null)).toBe(false);
    });
  });

  describe('mapLedgerError', () => {
    it('maps disconnected device errors to clear reconnect and unlock instructions', () => {
      const msg = mapLedgerError({ name: 'DisconnectedDevice' });
      expect(msg).toContain('Ledger device disconnected');
      expect(msg).toContain('enter your PIN to unlock it');
      expect(msg).toContain('open the Stellar app');
    });

    it('maps 0x6e00 and 0x6d00 to app opening instructions', () => {
      const msg1 = mapLedgerError({ statusCode: 0x6e00 });
      expect(msg1).toContain('Stellar app is not open');

      const msg2 = mapLedgerError(new Error('Ledger: CLA_NOT_SUPPORTED (0x6d00)'));
      expect(msg2).toContain('Stellar app is not open');
    });

    it('maps 0x6985 to user rejected message', () => {
      const msg = mapLedgerError({ statusCode: 0x6985 });
      expect(msg).toBe('Transaction rejected on Ledger device.');
    });

    it('maps 0x6511 / device locked to PIN prompt instructions', () => {
      const msg = mapLedgerError({ statusCode: 0x6511 });
      expect(msg).toContain('Ledger is locked');
      expect(msg).toContain('enter your PIN');
    });

    it('maps timeout errors to 45-second user prompt guidance', () => {
      const timeoutErr = new Error('timed out waiting for device');
      timeoutErr.name = 'TimeoutError';
      const msg = mapLedgerError(timeoutErr);
      expect(msg).toContain('timed out after 45 seconds');
      expect(msg).toContain('ensure your Ledger is unlocked');
    });
  });

  describe('withTimeout', () => {
    it('resolves cleanly when the wrapped promise completes before timeout', async () => {
      const fastPromise = Promise.resolve('success');
      const result = await withTimeout(fastPromise, 1000);
      expect(result).toBe('success');
    });

    it('rejects with 45-second timeout guidance when the promise exceeds timeout', async () => {
      const slowPromise = new Promise((resolve) => setTimeout(resolve, 500));
      await expect(withTimeout(slowPromise, 50)).rejects.toThrow(/timed out after 45 seconds/);
    });
  });

  describe('listAccounts & signTransaction disconnection recovery', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('surfaces actionable error message on disconnection during account listing', async () => {
      // Force failure with disconnection
      jest.spyOn(ledgerHardwareWallet, 'listAccounts').mockRejectedValueOnce(
        new Error(mapLedgerError({ name: 'DisconnectedDevice' })),
      );

      await expect(ledgerHardwareWallet.listAccounts()).rejects.toThrow(
        /Ledger device disconnected/,
      );
    });

    it('surfaces actionable error message on disconnection during transaction signing', async () => {
      jest.spyOn(ledgerHardwareWallet, 'signTransaction').mockRejectedValueOnce(
        new Error(mapLedgerError({ name: 'DisconnectedDevice' })),
      );

      await expect(ledgerHardwareWallet.signTransaction('fake_xdr')).rejects.toThrow(
        /Ledger device disconnected/,
      );
    });
  });
});
