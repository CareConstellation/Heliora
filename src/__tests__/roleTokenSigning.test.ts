import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  createRoleToken,
  isRoleTokenExpired,
  isRoleTokenRevoked,
  revoke_role_token,
  revokeRoleToken,
  clearRevocationRegistry,
  mint_role_token,
  mintRoleToken,
  verifyRoleToken,
  verifyRoleTokenSignature,
  detectRoleTampering,
} from '@/lib/roleTokenSigning';
import {
  buildMintRoleTokenOperation,
  buildRevokeRoleTokenOperation,
  mint_role_token as bridgeMintRoleToken,
  revoke_role_token as bridgeRevokeRoleToken,
} from '@/lib/sorobanRbac';

// Sample 32-byte test key (in hex)
const TEST_KEY_HEX =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_ACCOUNT = Keypair.random().publicKey();
const ADMIN_ACCOUNT = Keypair.random().publicKey();
const VALID_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));

describe('Role Token Minting, Revocation and Expiration Bridge (#197)', () => {
  beforeEach(() => {
    clearRevocationRegistry();
    process.env.NEXT_PUBLIC_ACCESS_CONTROL_CONTRACT_ID = VALID_CONTRACT;
  });

  describe('mint_role_token and expiration', () => {
    it('mints a role token with default 24h expiration', async () => {
      const result = await mint_role_token(TEST_ACCOUNT, 'DOCTOR', 24 * 60 * 60 * 1000);
      expect(result.token.address).toBe(TEST_ACCOUNT);
      expect(result.token.role).toBe('DOCTOR');
      expect(result.token.expiresAt).toBeGreaterThan(Date.now());
      expect(isRoleTokenExpired(result.token)).toBe(false);
    });

    it('mints a role token with custom short expiration and detects expiration', async () => {
      // 100ms TTL
      const result = await mint_role_token(TEST_ACCOUNT, 'PATIENT', 100);
      expect(result.token.address).toBe(TEST_ACCOUNT);
      expect(result.token.role).toBe('PATIENT');
      expect(isRoleTokenExpired(result.token)).toBe(false);

      // Check with future timestamp
      const futureTime = Date.now() + 500;
      expect(isRoleTokenExpired(result.token, futureTime)).toBe(true);
    });

    it('supports alias mintRoleToken interchangeably', async () => {
      const result = await mintRoleToken(TEST_ACCOUNT, 'HOSPITAL', 3600 * 1000);
      expect(result.token.role).toBe('HOSPITAL');
    });

    it('signs and verifies role token with HMAC key', async () => {
      const { token, signature } = await mint_role_token(
        TEST_ACCOUNT,
        'DOCTOR',
        3600 * 1000,
        TEST_KEY_HEX,
      );
      expect(signature).toBeTruthy();

      const isValid = await verifyRoleTokenSignature(token, signature, TEST_KEY_HEX);
      expect(isValid).toBe(true);

      const isVerified = await verifyRoleToken(token, signature, TEST_KEY_HEX);
      expect(isVerified).toBe(true);
    });

    it('rejects an expired role token even if the signature is valid', async () => {
      // Create token that already expired 1 second ago
      const token = createRoleToken(TEST_ACCOUNT, 'DOCTOR', -1000);
      expect(isRoleTokenExpired(token)).toBe(true);

      const isValid = await verifyRoleToken(token);
      expect(isValid).toBe(false);
    });
  });

  describe('revoke_role_token', () => {
    it('supports hospital admin revoking a role token', async () => {
      expect(isRoleTokenRevoked(TEST_ACCOUNT, 'DOCTOR')).toBe(false);

      revoke_role_token(TEST_ACCOUNT, 'DOCTOR');

      expect(isRoleTokenRevoked(TEST_ACCOUNT, 'DOCTOR')).toBe(true);
      expect(isRoleTokenRevoked(TEST_ACCOUNT)).toBe(true);
    });

    it('rejects verification for a revoked role token', async () => {
      const { token, signature } = await mint_role_token(
        TEST_ACCOUNT,
        'DOCTOR',
        3600 * 1000,
        TEST_KEY_HEX,
      );

      expect(await verifyRoleToken(token, signature, TEST_KEY_HEX)).toBe(true);

      revokeRoleToken(TEST_ACCOUNT, 'DOCTOR');

      expect(await verifyRoleToken(token, signature, TEST_KEY_HEX)).toBe(false);
      expect(await detectRoleTampering('DOCTOR', token, signature, TEST_KEY_HEX)).toBe(true);
    });
  });

  describe('Soroban RBAC Contract Bridge Operations', () => {
    it('builds mint_role_token Soroban operation with u64 expiration', () => {
      const expirationSec = Math.floor(Date.now() / 1000) + 86400;
      const op = buildMintRoleTokenOperation(ADMIN_ACCOUNT, TEST_ACCOUNT, 'DOCTOR', expirationSec);
      expect(op).toBeDefined();
    });

    it('builds revoke_role_token Soroban operation', () => {
      const op = buildRevokeRoleTokenOperation(ADMIN_ACCOUNT, TEST_ACCOUNT, 'DOCTOR');
      expect(op).toBeDefined();
    });

    it('executes bridge mint_role_token and populates local role cache', async () => {
      const expirationMs = 3600 * 1000;
      const result = await bridgeMintRoleToken(TEST_ACCOUNT, 'DOCTOR', expirationMs);
      expect(result.signedToken.token.role).toBe('DOCTOR');
    });

    it('executes bridge revoke_role_token and registers revocation', async () => {
      const result = await bridgeRevokeRoleToken(TEST_ACCOUNT, 'DOCTOR');
      expect(result.success).toBe(true);
      expect(isRoleTokenRevoked(TEST_ACCOUNT, 'DOCTOR')).toBe(true);
    });
  });
});
