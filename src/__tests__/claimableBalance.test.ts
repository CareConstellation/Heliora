import { Asset, Claimant, Keypair, Horizon, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  createTimeLockedPredicate,
  createClaimableBalanceOperation,
  createClaimOperation,
  isClaimableNow,
  queryClaimableBalances,
  buildClaimClaimableBalanceTransaction,
  type ClaimPredicateConfig,
} from '@/lib/claimableBalance';
import { callHorizonWithFallback, STELLAR_CONFIG } from '@/lib/stellar';

jest.mock('@/lib/stellar', () => {
  const actual = jest.requireActual('@/lib/stellar');
  return {
    ...actual,
    callHorizonWithFallback: jest.fn(),
  };
});

describe('Issue #190: Stellar Claimable Balance for Asynchronous Insurance Payouts', () => {
  const claimantKey = Keypair.random().publicKey();
  const sponsorKey = Keypair.random().publicKey();

  describe('Predicate Construction', () => {
    it('creates an unconditional claim predicate', () => {
      const config: ClaimPredicateConfig = { type: 'unconditional' };
      const predicate = createTimeLockedPredicate(config);

      expect(predicate).toBeDefined();
      expect(predicate.switch().name).toBe('claimPredicateUnconditional');
    });

    it('creates an absolute time lock predicate (before absolute time)', () => {
      const futureEpoch = Math.floor(Date.now() / 1000) + 86400; // +1 day
      const config: ClaimPredicateConfig = {
        type: 'absolute',
        beforeAbsoluteTime: futureEpoch,
      };
      const predicate = createTimeLockedPredicate(config);

      expect(predicate).toBeDefined();
      expect(predicate.switch().name).toBe('claimPredicateBeforeAbsoluteTime');
      expect(predicate.absBefore()?.toString()).toBe(String(futureEpoch));
    });

    it('creates a relative time lock predicate (before relative time)', () => {
      const config: ClaimPredicateConfig = {
        type: 'relative',
        beforeRelativeTime: 3600, // 1 hour
      };
      const predicate = createTimeLockedPredicate(config);

      expect(predicate).toBeDefined();
      expect(predicate.switch().name).toBe('claimPredicateBeforeRelativeTime');
      expect(predicate.relBefore()?.toString()).toBe('3600');
    });

    it('creates an inverted predicate using NOT', () => {
      const futureEpoch = Math.floor(Date.now() / 1000) + 86400;
      const config: ClaimPredicateConfig = {
        type: 'not',
        inner: [{ type: 'absolute', beforeAbsoluteTime: futureEpoch }],
      };
      const predicate = createTimeLockedPredicate(config);

      expect(predicate.switch().name).toBe('claimPredicateNot');
      expect(predicate.notPredicate()).toBeDefined();
    });

    it('creates a composite predicate using AND / OR', () => {
      const now = Math.floor(Date.now() / 1000);
      const config: ClaimPredicateConfig = {
        type: 'and',
        inner: [
          { type: 'absolute', beforeAbsoluteTime: now + 7200 },
          { type: 'not', inner: [{ type: 'relative', beforeRelativeTime: 100 }] },
        ],
      };
      const predicate = createTimeLockedPredicate(config);

      expect(predicate.switch().name).toBe('claimPredicateAnd');
      expect(predicate.andPredicates()?.length).toBe(2);
    });
  });

  describe('CreateClaimableBalance Operation', () => {
    it('builds a valid CreateClaimableBalanceOperation with native asset', () => {
      const op = createClaimableBalanceOperation({
        asset: Asset.native(),
        amount: '150.0000000',
        claimants: [
          new Claimant(claimantKey, createTimeLockedPredicate({ type: 'unconditional' })),
        ],
      });

      expect(op).toBeDefined();
      const xdrObj = op.toXDR();
      expect(xdrObj).toBeDefined();
    });

    it('builds a CreateClaimableBalanceOperation with custom time-locked insurance claimants', () => {
      const futureEpoch = Math.floor(Date.now() / 1000) + 604800; // 7 days
      const patientPredicate = createTimeLockedPredicate({
        type: 'absolute',
        beforeAbsoluteTime: futureEpoch,
      });
      const insurerPredicate = createTimeLockedPredicate({
        type: 'not',
        inner: [{ type: 'absolute', beforeAbsoluteTime: futureEpoch }],
      });

      const op = createClaimableBalanceOperation({
        asset: new Asset('USDC', sponsorKey),
        amount: '2500.50',
        claimants: [
          new Claimant(claimantKey, patientPredicate),
          new Claimant(sponsorKey, insurerPredicate),
        ],
      });

      expect(op).toBeDefined();
    });

    it('throws when no claimants are provided', () => {
      expect(() => {
        createClaimableBalanceOperation({
          asset: Asset.native(),
          amount: '100',
          claimants: [],
        });
      }).toThrow('At least one claimant');
    });

    it('throws when amount is non-positive or invalid', () => {
      expect(() => {
        createClaimableBalanceOperation({
          asset: Asset.native(),
          amount: '0',
          claimants: [new Claimant(claimantKey, Claimant.predicateUnconditional())],
        });
      }).toThrow('positive numerical amount');
    });
  });

  describe('Claim Operation and Transaction Building', () => {
    const dummyBalanceId = '0000000042459b52ac73d6e534f37d6e4b9f2913e61ff592a3b0ff97cbbfa0d8b4e7a77d';

    it('builds a valid claimClaimableBalance operation', () => {
      const op = createClaimOperation(dummyBalanceId);
      expect(op).toBeDefined();
      expect(op.toXDR()).toBeDefined();
    });

    it('rejects invalid balance ID hex strings', () => {
      expect(() => createClaimOperation('short-id')).toThrow('valid 64-character');
    });

    it('assembles a claim transaction envelope using Horizon account info', async () => {
      const mockAccount = new Horizon.AccountResponse({
        id: claimantKey,
        account_id: claimantKey,
        sequence: '123456789',
        subentry_count: 0,
        inflation_destination: '',
        home_domain: '',
        last_modified_ledger: 100,
        low_threshold: 0,
        med_threshold: 0,
        high_threshold: 0,
        flags: { auth_required: false, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false },
        balances: [],
        signers: [],
        data: {},
      });

      const xdr = await buildClaimClaimableBalanceTransaction(mockAccount, dummyBalanceId);
      expect(xdr).toBeDefined();
      const tx = TransactionBuilder.fromXDR(xdr, STELLAR_CONFIG.passphrase);
      expect(tx.operations.length).toBe(1);
    });
  });

  describe('isClaimableNow Predicate Evaluation', () => {
    it('evaluates unconditional predicates as true', () => {
      expect(isClaimableNow({ unconditional: true })).toBe(true);
    });

    it('evaluates absolute time predicates before expiration as true', () => {
      const future = new Date(Date.now() + 100000).toISOString();
      expect(isClaimableNow({ abs_before: future })).toBe(true);
    });

    it('evaluates absolute time predicates after expiration as false', () => {
      const past = new Date(Date.now() - 100000).toISOString();
      expect(isClaimableNow({ abs_before: past })).toBe(false);
    });

    it('evaluates not predicates correctly', () => {
      const past = new Date(Date.now() - 100000).toISOString();
      // NOT (before past) -> true, because it is past
      expect(isClaimableNow({ not: { abs_before: past } })).toBe(true);
    });

    it('evaluates and predicates correctly', () => {
      const future = new Date(Date.now() + 100000).toISOString();
      expect(isClaimableNow({ and: [{ unconditional: true }, { abs_before: future }] })).toBe(true);
    });
  });

  describe('queryClaimableBalances', () => {
    it('retrieves and parses claimable balances from Horizon', async () => {
      const mockHorizonResponse = {
        _embedded: {
          records: [
            {
              id: '000000001111222233334444555566667777888899990000aaaabbbbccccdddd',
              asset: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
              amount: '500.0000000',
              sponsor: sponsorKey,
              last_modified_ledger: 12345,
              claimants: [
                {
                  destination: claimantKey,
                  predicate: { unconditional: true },
                },
              ],
            },
          ],
        },
      };

      (callHorizonWithFallback as jest.Mock).mockResolvedValueOnce(mockHorizonResponse);

      const balances = await queryClaimableBalances(claimantKey);
      expect(balances.length).toBe(1);
      expect(balances[0]!.id).toContain('11112222');
      expect(balances[0]!.amount).toBe('500.0000000');
      expect(balances[0]!.asset).toContain('USDC');
      expect(balances[0]!.isClaimable).toBe(true);
    });
  });
});
