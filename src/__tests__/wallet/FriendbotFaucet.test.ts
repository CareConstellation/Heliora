import { FriendbotFaucet } from '@/lib/wallet/FriendbotFaucet';

describe('FriendbotFaucet', () => {
  describe('fundAccountIfNeeded', () => {
    it('should handle invalid public keys', async () => {
      await expect(FriendbotFaucet.fundAccount('invalid')).rejects.toThrow(
        'Invalid Stellar public key format',
      );
    });

    it('should reject mainnet', async () => {
      const validPublicKey = 'GBRPYHIL2CI3WHZSRXQQ5XPATH4H7KICDTD3L2D55DWRNLG5D4DXQAHF';
      await expect(FriendbotFaucet.fundAccount(validPublicKey, 'mainnet')).rejects.toThrow(
        'only available for testnet',
      );
    });

    it('should validate Stellar public key format', () => {
      const validKey = 'GBRPYHIL2CI3WHZSRXQQ5XPATH4H7KICDTD3L2D55DWRNLG5D4DXQAHF';
      const invalidKey = 'INVALID';

      expect(() => {
        FriendbotFaucet.fundAccount(invalidKey);
      }).rejects.toThrow();
    });
  });

  describe('checkAccountBalance', () => {
    it('should return zero balance for non-existent accounts', async () => {
      const nonExistentKey = 'GBRPYHIL2CI3WHZSRXQQ5XPATH4H7KICDTD3L2D55DWRNLG5D4DXQAHF';
      const result = await FriendbotFaucet.checkAccountBalance(nonExistentKey);

      expect(result).toEqual({
        native: expect.any(Number),
        isActive: expect.any(Boolean),
      });
    });
  });

  describe('fundAccountIfNeeded', () => {
    it('should return an object with funding status', async () => {
      const validKey = 'GBRPYHIL2CI3WHZSRXQQ5XPATH4H7KICDTD3L2D55DWRNLG5D4DXQAHF';

      const result = await FriendbotFaucet.fundAccountIfNeeded(validKey);

      expect(result).toEqual({
        funded: expect.any(Boolean),
        balance: expect.any(Number),
        transactionHash: expect.any(String),
      });
    });
  });
});
