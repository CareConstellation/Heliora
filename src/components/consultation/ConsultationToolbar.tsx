'use client';

import { AudioLines, Video } from 'lucide-react';
import ConnectionQualityPill from './ConnectionQualityPill';
import type { AdaptiveBitrateSample, ConnectionQuality } from '@/lib/video';

interface Props {
  /** Noise cancellation (high-pass + noise gate) is on. */
  noiseCancellationEnabled: boolean;
  /** Web Audio is available and a microphone stream is attached. */
  noiseCancellationAvailable: boolean;
  onToggleNoiseCancellation: () => void;
  onOpenVideoSettings: () => void;
  /** Background effect currently applied, shown on the settings button. */
  backgroundEffectLabel?: string | null;
  connectionSample?: AdaptiveBitrateSample | null;
}

/**
 * Media controls for the consultation toolbar: noise cancellation (#256),
 * video/background settings (#255) and the connection quality pill (#254).
 */
export default function ConsultationToolbar({
  noiseCancellationEnabled,
  noiseCancellationAvailable,
  onToggleNoiseCancellation,
  onOpenVideoSettings,
  backgroundEffectLabel,
  connectionSample,
}: Props) {
  const quality: ConnectionQuality = connectionSample?.quality ?? 'unknown';

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Call media controls">
      <ConnectionQualityPill
        quality={quality}
        resolution={connectionSample?.resolution ?? null}
        packetLossPercent={connectionSample?.packetLossPercent ?? null}
        rttMs={connectionSample?.rttMs ?? null}
      />

      <button
        type="button"
        onClick={onToggleNoiseCancellation}
        disabled={!noiseCancellationAvailable}
        aria-pressed={noiseCancellationEnabled}
        title={
          noiseCancellationAvailable
            ? 'Filters low-frequency rumble (80 Hz high-pass) and gates background noise between speech'
            : 'Noise cancellation needs microphone access and Web Audio support'
        }
        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
          noiseCancellationEnabled
            ? 'bg-green/10 text-green border border-green/30'
            : 'border border-border text-text-2 hover:bg-surface-hover hover:text-text-1'
        }`}
      >
        <AudioLines className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Noise cancel {noiseCancellationEnabled ? 'on' : 'off'}</span>
      </button>

      <button
        type="button"
        onClick={onOpenVideoSettings}
        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-1 hover:bg-surface-hover transition-colors"
      >
        <Video className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{backgroundEffectLabel ? `Background: ${backgroundEffectLabel}` : 'Video settings'}</span>
      </button>
    </div>
  );
}
