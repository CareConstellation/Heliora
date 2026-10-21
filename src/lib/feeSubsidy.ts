import type { SubsidyTier } from '@/types';

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
