import {
  type Transaction,
  type FeeBumpTransaction,
  type Keypair,
  StrKey,
  BASE_FEE,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

interface FeeBumpConfig {
  baseTransaction: Transaction;
  feeAccount: Keypair;
  baseFee: number;
  networkPassphrase: string;
}

interface SponsorshipConfig {
  sponsorAccount: Keypair;
  sponsorThreshold: number;
  sponsorFeePerOperation: number;
  networkPassphrase: string;
}

interface SponsoredOperation {
  operationIndex: number;
  sponsoredBy: string;
  sponsorshipType: 'full' | 'partial';
  fee?: number;
}

interface FeeBumpMetadata {
  originalFee: number;
  newFee: number;
  feeBumpAccount: string;
  createdAt: number;
  reason?: string;
}

class SEP0029FeeBumpSponsorship {
  createFeeBumpTransaction(config: FeeBumpConfig): {
    transaction: FeeBumpTransaction;
    metadata: FeeBumpMetadata;
  } {
    const originalFee = Number(config.baseTransaction.fee);
    const newFee = this.calculateOptimalFee(originalFee, config.baseFee);

    const feeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
      config.feeAccount,
      newFee.toString(),
      config.baseTransaction,
      config.networkPassphrase,
    );

    const metadata: FeeBumpMetadata = {
      originalFee,
      newFee,
      feeBumpAccount: config.feeAccount.publicKey(),
      createdAt: Math.floor(Date.now() / 1000),
      reason: 'Fee bump increase for transaction acceleration',
    };

    return {
      transaction: feeBumpTransaction,
      metadata,
    };
  }

  private calculateOptimalFee(baseFee: number, perOperationFee: number): number {
    const networkLoadFactor = 1.5;
    return Math.ceil(baseFee * networkLoadFactor + perOperationFee * 10);
  }

  createSponsoredTransaction(
    baseTransaction: Transaction,
    sponsor: Keypair,
    networkPassphrase: string,
  ): {
    transaction: Transaction;
    sponsorshipMetadata: {
      sponsor: string;
      sponsorFee: number;
      transactionHash: string;
    };
  } {
    const sponsorFee = Math.ceil(Number(baseTransaction.fee) * 1.2);

    const sponsoredTransaction = TransactionBuilder.cloneFrom(baseTransaction, {
      fee: sponsorFee.toString(),
      networkPassphrase,
    }).build();

    return {
      transaction: sponsoredTransaction,
      sponsorshipMetadata: {
        sponsor: sponsor.publicKey(),
        sponsorFee,
        transactionHash: sponsoredTransaction.hash().toString('hex'),
      },
    };
  }

  sponsorOperations(
    transaction: Transaction,
    sponsor: Keypair,
    operationIndices: number[],
    _networkPassphrase: string,
  ): {
    transaction: Transaction;
    sponsoredOperations: SponsoredOperation[];
  } {
    const sponsorFeePerOp = Math.ceil(
      Number(transaction.fee) / Math.max(1, transaction.operations.length),
    );

    const sponsoredOps: SponsoredOperation[] = operationIndices.map((index) => ({
      operationIndex: index,
      sponsoredBy: sponsor.publicKey(),
      sponsorshipType: 'partial',
      fee: sponsorFeePerOp,
    }));

    return {
      transaction,
      sponsoredOperations: sponsoredOps,
    };
  }

  validateFeeBumpTransaction(
    feeBumpTx: FeeBumpTransaction,
    minFeeIncrease: number = Number(BASE_FEE),
  ): {
    valid: boolean;
    reason?: string;
  } {
    const innerTx = feeBumpTx.innerTransaction;
    const feeIncrease = Number(feeBumpTx.fee) - Number(innerTx.fee);

    if (feeIncrease < minFeeIncrease) {
      return {
        valid: false,
        reason: `Fee increase (${feeIncrease}) below minimum required (${minFeeIncrease})`,
      };
    }

    if (!StrKey.isValidEd25519PublicKey(feeBumpTx.feeSource)) {
      return {
        valid: false,
        reason: 'Invalid fee account public key',
      };
    }

    return {
      valid: true,
    };
  }

  estimateTransactionCost(
    transaction: Transaction,
    baseFee: number,
    expectedLoadFactor: number = 1.0,
  ): {
    baseCost: number;
    withLoadFactor: number;
    withBuffer: number;
  } {
    const baseCost = Number(transaction.fee) * baseFee;
    const withLoadFactor = Math.ceil(baseCost * expectedLoadFactor);
    const withBuffer = Math.ceil(withLoadFactor * 1.5);

    return {
      baseCost,
      withLoadFactor,
      withBuffer,
    };
  }

  serializeFeeBumpTransaction(feeBumpTx: FeeBumpTransaction): string {
    return feeBumpTx.toEnvelope().toXDR('base64');
  }

  deserializeFeeBumpTransaction(xdr: string, networkPassphrase: string): FeeBumpTransaction {
    return TransactionBuilder.fromXDR(xdr, networkPassphrase) as FeeBumpTransaction;
  }

  canSponsor(
    sponsorAccountBalance: number,
    requiredFee: number,
    reserveRequirement: number = 2.0,
  ): boolean {
    const minimumBalance = reserveRequirement + requiredFee;
    return sponsorAccountBalance >= minimumBalance;
  }

  estimateConfirmationTime(
    feePaid: number,
    baseNetworkFee: number,
  ): {
    estimatedSeconds: number;
    priority: 'low' | 'medium' | 'high' | 'critical';
  } {
    const feeRatio = feePaid / baseNetworkFee;

    if (feeRatio < 1.2) {
      return {
        estimatedSeconds: 300,
        priority: 'low',
      };
    } else if (feeRatio < 1.5) {
      return {
        estimatedSeconds: 180,
        priority: 'medium',
      };
    } else if (feeRatio < 2.0) {
      return {
        estimatedSeconds: 60,
        priority: 'high',
      };
    } else {
      return {
        estimatedSeconds: 10,
        priority: 'critical',
      };
    }
  }

  calculateSponsorshipCoverage(
    sponsorFee: number,
    totalTransactionFee: number,
  ): {
    percentage: number;
    sponsorCoverage: number;
    userCoverage: number;
  } {
    const percentage = Math.round((sponsorFee / totalTransactionFee) * 100);
    const userCoverage = totalTransactionFee - sponsorFee;

    return {
      percentage,
      sponsorCoverage: sponsorFee,
      userCoverage,
    };
  }

  prepareHealthcareFeeBumpTransaction(
    baseTransaction: Transaction,
    feeAccount: Keypair,
    networkPassphrase: string,
    isUrgent: boolean = false,
  ): {
    transaction: FeeBumpTransaction;
    metadata: FeeBumpMetadata;
  } {
    const baseFee = isUrgent ? Number(BASE_FEE) * 2 : Number(BASE_FEE);
    const operationCount = baseTransaction.operations.length;
    const priorityMultiplier = isUrgent ? 2.0 : 1.2;

    return this.createFeeBumpTransaction({
      baseTransaction,
      feeAccount,
      baseFee: baseFee * operationCount * priorityMultiplier,
      networkPassphrase,
    });
  }

  /**
   * Checks if an account balance is below base reserve.
   */
  isBalanceBelowBaseReserve(
    accountOrBalance: { balances?: Array<{ asset_type: string; balance: string }>; subentry_count?: number } | number | string,
    subentryCount: number = 0,
    baseReserve: number = BASE_RESERVE_XLM,
  ): boolean {
    return isBalanceBelowBaseReserve(accountOrBalance, subentryCount, baseReserve);
  }

  /**
   * Sponsors a low-balance patient inner transaction with rate limiting.
   */
  sponsorPatientTransaction(
    innerTransaction: Transaction,
    sponsorKeypair: Keypair,
    networkPassphrase: string,
    options?: SponsorPatientFeeBumpOptions,
  ) {
    return sponsorPatientFeeBumpTransaction(innerTransaction, sponsorKeypair, networkPassphrase, options);
  }
}

/* ─── SEP-0029 Automated Patient Fee Bump Sponsorship (#187) ────── */

export const BASE_RESERVE_XLM = 0.5;
export const DEFAULT_BASE_ACCOUNT_RESERVE = 1.0; // 2 * 0.5 XLM
export const MAX_BUMPS_PER_24H = 5;
export const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours in ms

/**
 * Evaluates whether a wallet balance falls below the Stellar base reserve requirement.
 * Accounts below base reserve cannot pay transaction fees and require sponsorship.
 * Time Complexity: O(B) where B is balances count (typically <= 5) -> O(1)
 * Space Complexity: O(1)
 */
export function isBalanceBelowBaseReserve(
  accountOrBalance:
    | { balances?: Array<{ asset_type: string; balance: string }>; subentry_count?: number }
    | number
    | string,
  subentryCount: number = 0,
  baseReserve: number = BASE_RESERVE_XLM,
): boolean {
  if (typeof accountOrBalance === 'object' && accountOrBalance !== null) {
    const nativeEntry = accountOrBalance.balances?.find((b) => b.asset_type === 'native');
    const balanceXlm = nativeEntry ? parseFloat(nativeEntry.balance) : 0;
    const subentries = accountOrBalance.subentry_count ?? subentryCount;
    const requiredMin = (2 + subentries) * baseReserve;
    return isNaN(balanceXlm) || balanceXlm <= requiredMin;
  }

  const numericBalance =
    typeof accountOrBalance === 'string' ? parseFloat(accountOrBalance) : accountOrBalance;
  if (isNaN(numericBalance)) return true;
  const requiredMin = (2 + subentryCount) * baseReserve;
  return numericBalance <= requiredMin;
}

/**
 * Sliding-window rate limiter ensuring patient wallets do not exceed 5 fee bumps per 24 hours.
 * Time Complexity: O(W) where W <= 5 timestamps in sliding queue -> O(1)
 * Space Complexity: O(K) where K is active patient public keys.
 */
export class FeeBumpRateLimiter {
  private timestamps: Map<string, number[]> = new Map();
  public readonly maxBumps: number;
  public readonly windowMs: number;

  constructor(maxBumps: number = MAX_BUMPS_PER_24H, windowMs: number = RATE_LIMIT_WINDOW_MS) {
    this.maxBumps = maxBumps;
    this.windowMs = windowMs;
  }

  private prune(publicKey: string, now: number): number[] {
    const times = this.timestamps.get(publicKey) || [];
    const valid = times.filter((t) => now - t < this.windowMs);
    if (valid.length === 0) {
      this.timestamps.delete(publicKey);
    } else {
      this.timestamps.set(publicKey, valid);
    }
    return valid;
  }

  isRateLimited(publicKey: string, now: number = Date.now()): boolean {
    const valid = this.prune(publicKey, now);
    return valid.length >= this.maxBumps;
  }

  getRemainingBumps(publicKey: string, now: number = Date.now()): number {
    const valid = this.prune(publicKey, now);
    return Math.max(0, this.maxBumps - valid.length);
  }

  getResetTime(publicKey: string, now: number = Date.now()): number | null {
    const valid = this.prune(publicKey, now);
    if (valid.length === 0) return null;
    return valid[0] + this.windowMs;
  }

  recordBump(publicKey: string, now: number = Date.now()): void {
    if (this.isRateLimited(publicKey, now)) {
      throw new Error(
        `Rate limit exceeded: wallet ${publicKey} has reached maximum of ${this.maxBumps} fee bumps in 24 hours.`,
      );
    }
    const times = this.timestamps.get(publicKey) || [];
    times.push(now);
    this.timestamps.set(publicKey, times);
  }

  reset(publicKey?: string): void {
    if (publicKey) {
      this.timestamps.delete(publicKey);
    } else {
      this.timestamps.clear();
    }
  }
}

/** Shared singleton rate limiter instance */
export const defaultFeeBumpRateLimiter = new FeeBumpRateLimiter();

export interface SponsorPatientFeeBumpOptions {
  maxFee?: string | number;
  rateLimiter?: FeeBumpRateLimiter;
  enforceRateLimit?: boolean;
  now?: number;
}

/**
 * Constructs an inner transaction wrapper and produces a signed FeeBumpTransaction for a low-balance patient wallet.
 * Enforces a strict 5 bumps per 24 hours rate limit per patient public key.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function sponsorPatientFeeBumpTransaction(
  innerTransaction: Transaction,
  sponsorKeypair: Keypair,
  networkPassphrase: string,
  options?: SponsorPatientFeeBumpOptions,
): {
  feeBumpTransaction: FeeBumpTransaction;
  feeBumpXdr: string;
  sponsoredAt: number;
  sponsorPublicKey: string;
  bumpFee: string;
  remainingBumps: number;
} {
  const now = options?.now ?? Date.now();
  const limiter = options?.rateLimiter ?? defaultFeeBumpRateLimiter;
  const enforceLimit = options?.enforceRateLimit !== false;
  const patientPublicKey = innerTransaction.source;

  if (enforceLimit && limiter.isRateLimited(patientPublicKey, now)) {
    throw new Error(
      `Rate limit exceeded: wallet ${patientPublicKey} has exceeded the limit of ${limiter.maxBumps} fee bumps per 24 hours.`,
    );
  }

  const innerFee = Number(innerTransaction.fee);
  const minRequiredFee = innerFee + Number(BASE_FEE);
  const bumpFeeNum = options?.maxFee ? Math.max(Number(options.maxFee), minRequiredFee) : minRequiredFee;
  const bumpFeeStr = bumpFeeNum.toString();

  const feeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
    sponsorKeypair,
    bumpFeeStr,
    innerTransaction,
    networkPassphrase,
  );

  feeBumpTransaction.sign(sponsorKeypair);

  if (enforceLimit) {
    limiter.recordBump(patientPublicKey, now);
  }

  const feeBumpXdr = feeBumpTransaction.toEnvelope().toXDR('base64');
  const remaining = limiter.getRemainingBumps(patientPublicKey, now);

  return {
    feeBumpTransaction,
    feeBumpXdr,
    sponsoredAt: Math.floor(now / 1000),
    sponsorPublicKey: sponsorKeypair.publicKey(),
    bumpFee: bumpFeeStr,
    remainingBumps: remaining,
  };
}

export { SEP0029FeeBumpSponsorship };
export type { FeeBumpConfig, SponsorshipConfig, SponsoredOperation, FeeBumpMetadata };
