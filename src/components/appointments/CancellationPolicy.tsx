'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCancellationPolicy, fetchCancellationEstimate } from '@/services/api.service';
import type { CancellationTier } from '@/types';

interface PolicyMatrixProps {
  doctorId: string;
}

const DEFAULT_TIERS: CancellationTier[] = [
  { label: 'More than 48 hours', minHoursBefore: 48, maxHoursBefore: null, refundPercent: 100, forfeitPercent: 0 },
  { label: '24–48 hours', minHoursBefore: 24, maxHoursBefore: 48, refundPercent: 75, forfeitPercent: 25 },
  { label: '12–24 hours', minHoursBefore: 12, maxHoursBefore: 24, refundPercent: 50, forfeitPercent: 50 },
  { label: 'Less than 12 hours', minHoursBefore: 0, maxHoursBefore: 12, refundPercent: 0, forfeitPercent: 100 },
];

export function CancellationPolicyMatrix({ doctorId }: PolicyMatrixProps) {
  const { data: policy } = useQuery({
    queryKey: ['cancellation-policy', doctorId],
    queryFn: () => fetchCancellationPolicy(doctorId),
    enabled: !!doctorId,
  });

  const tiers = policy?.tiers ?? DEFAULT_TIERS;

  return (
    <div className="rounded-lg border border-border bg-surface-card p-3">
      <h4 className="text-xs font-semibold text-text-1 mb-2">Cancellation Policy</h4>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-text-3">
            <th className="text-left pb-1 font-medium">Cancellation Window</th>
            <th className="text-right pb-1 font-medium">Refund</th>
            <th className="text-right pb-1 font-medium">Forfeit</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((tier) => (
            <tr key={tier.label} className="border-t border-border/50">
              <td className="py-1.5 text-text-2">{tier.label}</td>
              <td className="py-1.5 text-right text-green-600 font-medium">{tier.refundPercent}%</td>
              <td className="py-1.5 text-right text-red-500 font-medium">{tier.forfeitPercent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface EstimateProps {
  appointmentId: string;
  fee: number;
  onEstimateLoaded?: (estimate: {
    refundAmount: number;
    forfeitAmount: number;
    doctorPayout: number;
    tier: CancellationTier;
  }) => void;
}

export function CancellationEstimateDisplay({ appointmentId, onEstimateLoaded }: EstimateProps) {
  const { data: estimate, isLoading, isError } = useQuery({
    queryKey: ['cancellation-estimate', appointmentId],
    queryFn: () => fetchCancellationEstimate(appointmentId),
    enabled: !!appointmentId,
  });

  useEffect(() => {
    if (estimate && onEstimateLoaded) {
      onEstimateLoaded({
        refundAmount: estimate.refundAmount,
        forfeitAmount: estimate.forfeitAmount,
        doctorPayout: estimate.doctorPayout,
        tier: estimate.tier,
      });
    }
  }, [estimate, onEstimateLoaded]);

  if (isLoading) return <div className="animate-pulse h-16 rounded-lg bg-surface-card" />;
  if (isError || !estimate) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs space-y-1">
      <p className="font-semibold text-amber-800">Cancellation Fee Breakdown</p>
      <p className="text-amber-700">
        Window: <span className="font-medium">{estimate.tier.label}</span>
        {' '}({Math.round(estimate.hoursUntilAppointment)}h before appointment)
      </p>
      <div className="flex justify-between text-amber-900">
        <span>Refund to you:</span>
        <span className="font-medium text-green-700">{estimate.refundAmount.toFixed(2)} XLM</span>
      </div>
      <div className="flex justify-between text-amber-900">
        <span>Forfeited to doctor:</span>
        <span className="font-medium text-red-600">{estimate.forfeitAmount.toFixed(2)} XLM</span>
      </div>
    </div>
  );
}

/* ── Client-side cancellation tier calculation ─────────────────── */

/**
 * Determines which cancellation tier applies given hours until the appointment.
 * Linear scan over the tier list — O(t) where t = number of tiers (typically 4).
 */
export function resolveCancellationTier(
  hoursUntil: number,
  tiers: CancellationTier[] = DEFAULT_TIERS,
): CancellationTier {
  for (const tier of tiers) {
    const aboveMin = hoursUntil >= tier.minHoursBefore;
    const belowMax = tier.maxHoursBefore === null || hoursUntil < tier.maxHoursBefore;
    if (aboveMin && belowMax) return tier;
  }
  return tiers[tiers.length - 1]!;
}

/**
 * Calculates the refund and forfeit amounts for a given fee and cancellation window.
 *
 * Time: O(t) where t = number of tiers (typically 4). Space: O(1).
 */
export function calculateCancellationAmounts(
  fee: number,
  appointmentDatetime: string,
  tiers: CancellationTier[] = DEFAULT_TIERS,
): { refundAmount: number; forfeitAmount: number; tier: CancellationTier } {
  const hoursUntil = (new Date(appointmentDatetime).getTime() - Date.now()) / (1000 * 60 * 60);
  const tier = resolveCancellationTier(Math.max(0, hoursUntil), tiers);
  const refundAmount = (fee * tier.refundPercent) / 100;
  const forfeitAmount = fee - refundAmount;
  return { refundAmount, forfeitAmount, tier };
}

export { DEFAULT_TIERS };
