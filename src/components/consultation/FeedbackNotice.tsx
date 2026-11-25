'use client';

import { VolumeX } from 'lucide-react';
import { FEEDBACK_DUCK_DB } from '@/lib/video';

interface Props {
  frequencyHz: number | null;
  onDismiss: () => void;
}

/** Notice shown while playback is ducked to stop acoustic feedback (#269). */
export default function FeedbackNotice({ frequencyHz, onDismiss }: Props) {
  return (
    <div
      role="alert"
      data-testid="feedback-notice"
      className="absolute left-1/2 top-3 z-20 flex max-w-md -translate-x-1/2 items-start gap-2 rounded-lg border border-yellow-500/40 bg-black/80 px-3 py-2 text-xs text-white shadow-lg"
    >
      <VolumeX className="mt-0.5 h-4 w-4 shrink-0 text-yellow-300" aria-hidden="true" />
      <div className="space-y-0.5">
        <p className="font-semibold">Echo feedback detected — call volume lowered by {FEEDBACK_DUCK_DB} dB</p>
        <p className="text-white/70">
          Another device in this room is likely in the call
          {frequencyHz ? ` (howling near ${Math.round(frequencyHz)} Hz)` : ''}. Use headphones or mute one
          device. Volume returns automatically once the feedback stops.
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-1 shrink-0 rounded border border-white/30 px-2 py-0.5 text-3xs font-semibold hover:bg-white/10"
      >
        Restore volume
      </button>
    </div>
  );
}
