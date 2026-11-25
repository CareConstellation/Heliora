'use client';

import { Signal, SignalHigh, SignalLow, SignalMedium, WifiOff } from 'lucide-react';
import type { AdaptiveResolution, ConnectionQuality } from '@/lib/video';

interface Props {
  quality: ConnectionQuality;
  resolution?: AdaptiveResolution | null;
  packetLossPercent?: number | null;
  rttMs?: number | null;
}

const QUALITY_META: Record<
  ConnectionQuality,
  { label: string; className: string; Icon: typeof Signal }
> = {
  excellent: { label: 'Excellent', className: 'bg-green/10 text-green border-green/30', Icon: Signal },
  good: { label: 'Good', className: 'bg-green/10 text-green border-green/20', Icon: SignalHigh },
  fair: { label: 'Fair', className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30', Icon: SignalMedium },
  poor: { label: 'Poor', className: 'bg-red-500/10 text-red-600 border-red-500/30', Icon: SignalLow },
  unknown: { label: 'Measuring', className: 'bg-surface-inset text-text-3 border-border', Icon: WifiOff },
};

const RESOLUTION_LABEL: Record<AdaptiveResolution, string> = {
  '1080p': '1080p',
  '720p': '720p',
  '480p': '480p',
  'audio-only': 'Audio only',
};

/**
 * Compact call-quality indicator for the consultation toolbar (#254).
 * Announces changes politely to screen readers via `role="status"`.
 */
export default function ConnectionQualityPill({ quality, resolution, packetLossPercent, rttMs }: Props) {
  const { label, className, Icon } = QUALITY_META[quality];

  const details: string[] = [];
  if (typeof packetLossPercent === 'number') details.push(`${packetLossPercent.toFixed(1)}% loss`);
  if (typeof rttMs === 'number') details.push(`${Math.round(rttMs)} ms RTT`);
  const title = details.length > 0 ? `Connection ${label.toLowerCase()} · ${details.join(' · ')}` : `Connection ${label.toLowerCase()}`;

  return (
    <span
      role="status"
      aria-live="polite"
      data-quality={quality}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-3xs font-semibold ${className}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span>{label}</span>
      {resolution && (
        <span className="font-mono opacity-80" data-testid="quality-resolution">
          · {RESOLUTION_LABEL[resolution]}
        </span>
      )}
    </span>
  );
}
