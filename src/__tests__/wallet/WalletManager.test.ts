import { WalletManager } from '@/lib/wallet/WalletManager';
import { FreighterAdapter } from '@/lib/wallet/adapters';

describe('WalletManager', () => {
  let walletManager: WalletManager;

  beforeEach(() => {
    walletManager = new WalletManager();
  });

  describe('getAvailableWallets', () => {
    it('should return list of available wallets', async () => {
      const wallets = await walletManager.getAvailableWallets();
      expect(Array.isArray(wallets)).toBe(true);
      expect(wallets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            name: expect.any(String),
            icon: expect.any(String),
          }),
        ]),
      );
    });
  });

  describe('connect', () => {
    it('should throw error for invalid wallet type', async () => {
      await expect(walletManager.connect('invalid' as never)).rejects.toThrow();
    });
  });

  describe('isConnected', () => {
    it('should return false when no wallet is connected', () => {
      expect(walletManager.isConnected()).toBe(false);
    });

    it('should return null for public key when not connected', () => {
      expect(walletManager.getConnectedPublicKey()).toBeNull();
    });
  });

  describe('disconnect', () => {
    it('should disconnect without error when not connected', async () => {
      await expect(walletManager.disconnect()).resolves.not.toThrow();
    });
  });
});
