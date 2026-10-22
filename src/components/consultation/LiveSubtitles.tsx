'use client';

import React from 'react';
import type { TranscriptSegment } from '@/types';
import { Mic } from 'lucide-react';

interface Props {
  activeSegment: TranscriptSegment | null;
  history?: TranscriptSegment[];
  isTranscribing: boolean;
}

/**
 * Streams real-time subtitles across the lower third of the video container.
 * Supports active interim speech recognition and speaker differentiation.
 * (Issue #64)
 *
 * Algorithmic Complexity:
 * - Time: O(1) single-pass render of active segment and recent history.
 * - Space: O(1) constant rendered elements (latest 2 lines).
 */
export default function LiveSubtitles({
  activeSegment,
  history = [],
  isTranscribing,
}: Props) {
  if (!isTranscribing && !activeSegment && history.length === 0) {
    return null;
  }

  // Display the active segment, or fallback to the most recent finalized segment
  const current = activeSegment || (history.length > 0 ? history[history.length - 1] : null);

  if (!current && !isTranscribing) {
    return null;
  }

  const isDoctor = current?.speaker === 'doctor';

  return (
    <div
      aria-live="polite"
      className="absolute bottom-6 inset-x-4 sm:inset-x-8 z-30 flex flex-col items-center justify-end pointer-events-none"
    >
      <div className="w-full max-w-2xl px-4 py-3 rounded-xl bg-black/75 backdrop-blur-md border border-white/10 shadow-2xl space-y-1 transition-all">
        {/* Header Indicator */}
        <div className="flex items-center justify-between text-3xs font-mono uppercase tracking-wider text-slate-300">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green"></span>
            </span>
            <span className="font-semibold text-slate-200">Live Transcription</span>
          </div>

          {current && (
            <span
              className={`px-1.5 py-0.5 rounded text-3xs font-bold ${
                isDoctor
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
              }`}
            >
              {isDoctor ? 'Doctor' : 'Patient'}
            </span>
          )}
        </div>

        {/* Subtitle Text */}
        <p className="text-sm sm:text-base font-medium text-white leading-relaxed tracking-wide drop-shadow-md min-h-[1.5rem]">
          {current ? (
            <span>
              {current.text}
              {!current.isFinal && (
                <span className="inline-block w-1.5 h-4 ml-1 bg-green animate-pulse align-middle" />
              )}
            </span>
          ) : (
            <span className="text-xs text-slate-400 italic flex items-center gap-1">
              <Mic className="w-3.5 h-3.5 text-slate-400 animate-pulse" /> Listening for speech…
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
