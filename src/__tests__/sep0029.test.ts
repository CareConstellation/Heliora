import {
  isBalanceBelowBaseReserve,
  FeeBumpRateLimiter,
  sponsorPatientFeeBumpTransaction,
  MAX_BUMPS_PER_24H,
} from '@/lib/sep0029FeeBumpSponsorship';
import { checkPatientFeeSponsorship } from '@/lib/feeSubsidy';
import {
  Keypair,
  Account,
  TransactionBuilder,
  Operation,
  Asset,
  Networks,
} from '@stellar/stellar-sdk';

describe('Issue #187: SEP-0029 Automated Fee Bump Sponsorship for Low-Balance Patient Wallets', () => {
  const patientKeypair = Keypair.random();
  const sponsorKeypair = Keypair.random();
  const networkPassphrase = Networks.TESTNET;

  describe('isBalanceBelowBaseReserve', () => {
    it('detects balance below base reserve for account with no subentries', () => {
      // 2 * 0.5 = 1.0 XLM required reserve
      const lowAccount = {
        balances: [{ asset_type: 'native', balance: '0.8000000' }],
        subentry_count: 0,
      };
      expect(isBalanceBelowBaseReserve(lowAccount)).toBe(true);

      const fundedAccount = {
        balances: [{ asset_type: 'native', balance: '10.5000000' }],
        subentry_count: 0,
      };
      expect(isBalanceBelowBaseReserve(fundedAccount)).toBe(false);
    });

    it('accounts for subentry count in minimum reserve calculation', () => {
      // 5 subentries -> (2 + 5) * 0.5 = 3.5 XLM required reserve
      const accountWithSubentries = {
        balances: [{ asset_type: 'native', balance: '3.2000000' }],
        subentry_count: 5,
      };
      expect(isBalanceBelowBaseReserve(accountWithSubentries)).toBe(true);

      const fundedWithSubentries = {
        balances: [{ asset_type: 'native', balance: '4.0000000' }],
        subentry_count: 5,
      };
      expect(isBalanceBelowBaseReserve(fundedWithSubentries)).toBe(false);
    });

    it('handles numeric and string inputs properly', () => {
      // Base reserve is 0.5 XLM; standard account requires 2 * 0.5 = 1.0 XLM
      expect(isBalanceBelowBaseReserve(0.5)).toBe(true);
      expect(isBalanceBelowBaseReserve('0.95')).toBe(true);
      expect(isBalanceBelowBaseReserve(2.5)).toBe(false);
      expect(isBalanceBelowBaseReserve('15.0')).toBe(false);
    });
  });

  describe('FeeBumpRateLimiter', () => {
    it('enforces a strict limit of 5 fee bumps per 24 hours per key', () => {
      const limiter = new FeeBumpRateLimiter(MAX_BUMPS_PER_24H);
      const testKey = patientKeypair.publicKey();
      const startTime = 1_000_000;

      // First 5 bumps should succeed
      for (let i = 0; i < 5; i++) {
        expect(limiter.isRateLimited(testKey, startTime + i * 1000)).toBe(false);
        expect(limiter.getRemainingBumps(testKey, startTime + i * 1000)).toBe(5 - i);
        limiter.recordBump(testKey, startTime + i * 1000);
      }

      // 6th bump within 24h window should be rejected
      expect(limiter.isRateLimited(testKey, startTime + 10_000)).toBe(true);
      expect(limiter.getRemainingBumps(testKey, startTime + 10_000)).toBe(0);
      expect(() => limiter.recordBump(testKey, startTime + 10_000)).toThrow(/Rate limit exceeded/);

      // After 24 hours (86,400,000 ms), older bumps expire and allow new sponsorships
      const after24h = startTime + 24 * 60 * 60 * 1000 + 5000;
      expect(limiter.isRateLimited(testKey, after24h)).toBe(false);
      expect(limiter.getRemainingBumps(testKey, after24h)).toBeGreaterThan(0);
    });

    it('isolates rate limits between distinct wallet public keys', () => {
      const limiter = new FeeBumpRateLimiter(MAX_BUMPS_PER_24H);
      const keyA = Keypair.random().publicKey();
      const keyB = Keypair.random().publicKey();
      const now = Date.now();

      for (let i = 0; i < 5; i++) {
        limiter.recordBump(keyA, now);
      }

      expect(limiter.isRateLimited(keyA, now)).toBe(true);
      expect(limiter.isRateLimited(keyB, now)).toBe(false);
      expect(limiter.getRemainingBumps(keyB, now)).toBe(5);
    });
  });

  describe('sponsorPatientFeeBumpTransaction', () => {
    function buildMockPatientInnerTx(): any {
      const patientAccount = new Account(patientKeypair.publicKey(), '50');
      const tx = new TransactionBuilder(patientAccount, {
        fee: '100',
        networkPassphrase,
      })
        .addOperation(
          Operation.payment({
            destination: Keypair.random().publicKey(),
            asset: Asset.native(),
            amount: '1',
          }),
        )
        .setTimeout(30)
        .build();
      tx.sign(patientKeypair);
      return tx;
    }

    it('wraps inner transaction in FeeBumpTransaction signed by Heliora sponsor', () => {
      const innerTx = buildMockPatientInnerTx();
      const customLimiter = new FeeBumpRateLimiter(MAX_BUMPS_PER_24H);

      const result = sponsorPatientFeeBumpTransaction(innerTx, sponsorKeypair, networkPassphrase, {
        rateLimiter: customLimiter,
      });

      expect(result.feeBumpTransaction).toBeDefined();
      expect(result.sponsorPublicKey).toBe(sponsorKeypair.publicKey());
      expect(result.feeBumpTransaction.feeSource).toBe(sponsorKeypair.publicKey());
      expect(result.feeBumpTransaction.innerTransaction.hash()).toEqual(innerTx.hash());
      expect(result.feeBumpXdr).toBeTruthy();
      expect(result.remainingBumps).toBe(4);
    });

    it('rejects sponsorship when patient wallet reaches 5 bumps in 24 hours', () => {
      const innerTx = buildMockPatientInnerTx();
      const customLimiter = new FeeBumpRateLimiter(MAX_BUMPS_PER_24H);

      // Exhaust limit
      for (let i = 0; i < 5; i++) {
        sponsorPatientFeeBumpTransaction(innerTx, sponsorKeypair, networkPassphrase, {
          rateLimiter: customLimiter,
        });
      }

      expect(() =>
        sponsorPatientFeeBumpTransaction(innerTx, sponsorKeypair, networkPassphrase, {
          rateLimiter: customLimiter,
        }),
      ).toThrow(/Rate limit exceeded/);
    });
  });

  describe('checkPatientFeeSponsorship (feeSubsidy integration)', () => {
    it('accurately evaluates eligibility for patient wallets', () => {
      const limiter = new FeeBumpRateLimiter(5);
      const pk = Keypair.random().publicKey();

      // Funded wallet -> not eligible
      const checkFunded = checkPatientFeeSponsorship(
        pk,
        { balances: [{ asset_type: 'native', balance: '25.0' }], subentry_count: 0 },
        0,
        limiter,
      );
      expect(checkFunded.eligible).toBe(false);
      expect(checkFunded.reason).toContain('above base reserve');

      // Low balance wallet -> eligible
      const checkLow = checkPatientFeeSponsorship(
        pk,
        { balances: [{ asset_type: 'native', balance: '0.5' }], subentry_count: 0 },
        0,
        limiter,
      );
      expect(checkLow.eligible).toBe(true);
      expect(checkLow.remainingBumps).toBe(5);
    });
  });
});
