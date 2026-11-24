import type { SubsidyTier } from '@/types';
import {
  isBalanceBelowBaseReserve,
  defaultFeeBumpRateLimiter,
  type FeeBumpRateLimiter,
} from './sep0029FeeBumpSponsorship';

export interface FeeInvoice {
  baseFee: number;
  /** Portion paid by the institutional grant / subsidy. */
  subsidyAmount: number;
  /** Amount the patient must lock in escrow. */
  patientPays: number;
  tier: string;
  grantor?: string;
}

// Stellar amounts carry at most 7 decimal places.
const round7 = (n: number) => Math.round(n * 1e7) / 1e7;

/** Splits `baseFee` into the grantor's share and the patient's share. */
export function computeFeeInvoice(baseFee: number, subsidy?: SubsidyTier | null): FeeInvoice {
  const pct = Math.min(100, Math.max(0, Number(subsidy?.discountPercent) || 0));
  const subsidyAmount = round7((baseFee * pct) / 100);
  return {
    baseFee,
    subsidyAmount,
    patientPays: round7(baseFee - subsidyAmount),
    tier: subsidy?.tier ?? 'standard',
    ...(subsidy?.grantor ? { grantor: subsidy.grantor } : {}),
  };
}

export interface FeeSponsorshipEligibility {
  eligible: boolean;
  reason: string;
  remainingBumps: number;
  isBelowBaseReserve: boolean;
}

/**
 * Checks if a patient wallet qualifies for SEP-0029 automated fee bump sponsorship (#187).
 * A patient is eligible if their balance is below the base reserve and their 24h quota is not exhausted.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function checkPatientFeeSponsorship(
  walletAddress: string,
  accountOrBalance:
    | { balances?: Array<{ asset_type: string; balance: string }>; subentry_count?: number }
    | number
    | string,
  subentryCount: number = 0,
  rateLimiter: FeeBumpRateLimiter = defaultFeeBumpRateLimiter,
): FeeSponsorshipEligibility {
  const isBelow = isBalanceBelowBaseReserve(accountOrBalance, subentryCount);
  const remaining = rateLimiter.getRemainingBumps(walletAddress);
  const rateLimited = rateLimiter.isRateLimited(walletAddress);

  if (!isBelow) {
    return {
      eligible: false,
      reason: 'Wallet balance is above base reserve; self-funded transaction required.',
      remainingBumps: remaining,
      isBelowBaseReserve: false,
    };
  }

  if (rateLimited) {
    return {
      eligible: false,
      reason: 'Rate limit of 5 fee bumps per 24 hours has been reached for this wallet.',
      remainingBumps: 0,
      isBelowBaseReserve: true,
    };
  }

  return {
    eligible: true,
    reason: 'Wallet qualifies for automated SEP-0029 fee bump sponsorship.',
    remainingBumps: remaining,
    isBelowBaseReserve: true,
  };
}
