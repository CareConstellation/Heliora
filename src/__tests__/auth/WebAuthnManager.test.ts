import { WebAuthnManager } from '@/lib/auth/WebAuthnManager';

describe('WebAuthnManager', () => {
  describe('isAvailable', () => {
    it('should check WebAuthn availability', () => {
      const available = WebAuthnManager.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('isUserVerificationAvailable', () => {
    it('should return boolean for user verification support', async () => {
      if (WebAuthnManager.isAvailable()) {
        const available = await WebAuthnManager.isUserVerificationAvailable();
        expect(typeof available).toBe('boolean');
      }
    });
  });

  describe('registerCredential', () => {
    it('should throw error if WebAuthn is not available', async () => {
      if (!WebAuthnManager.isAvailable()) {
        await expect(
          WebAuthnManager.registerCredential({
            userId: 'test-user',
            userName: 'testuser',
            userDisplayName: 'Test User',
          }),
        ).rejects.toThrow('not supported');
      }
    });
  });

  describe('authenticateCredential', () => {
    it('should throw error if WebAuthn is not available', async () => {
      if (!WebAuthnManager.isAvailable()) {
        await expect(WebAuthnManager.authenticateCredential()).rejects.toThrow('not supported');
      }
    });
  });
});
