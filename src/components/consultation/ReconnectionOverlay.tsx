'use client';

import React from 'react';
import { WifiOff, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import type { ReconnectionStatus } from '@/types';

interface Props {
  status: ReconnectionStatus;
  onRetry: () => void;
  onDismiss?: () => void;
}

/**
 * Unobtrusive reconnection overlay for WebRTC telemedicine sessions.
 * Displays during network switches (e.g. Wi-Fi to 5G) with a 30-second timeout counter.
 *
 * Algorithmic Complexity:
 * - Time: O(1) single-pass conditional render.
 * - Space: O(1) constant memory.
 */
export default function ReconnectionOverlay({ status, onRetry, onDismiss }: Props) {
  if (status.state === 'connected') {
    return null;
  }

  const isReconnecting = status.state === 'reconnecting';
  const isFailed = status.state === 'failed';

  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 backdrop-blur-[2px] transition-all p-4 pointer-events-auto"
    >
      <div className="max-w-md w-full rounded-xl border border-white/10 bg-[#0F172A]/90 p-5 text-white shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-start gap-3">
          <div
            className={`p-2.5 rounded-lg shrink-0 ${
              isReconnecting
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}
          >
            {isReconnecting ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <AlertCircle className="w-5 h-5" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white tracking-tight">
                {isReconnecting
                  ? 'Reconnecting to consultation...'
                  : 'Connection Interrupted'}
              </h3>
              {isReconnecting && (
                <span className="font-mono text-2xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                  {status.remainingSeconds}s
                </span>
              )}
            </div>

            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              {isReconnecting
                ? status.message ||
                  'Mobile network transition detected. Initiating ICE restart and restoring media tracks...'
                : status.message ||
                  'The 30-second reconnection window expired without restoring the session.'}
            </p>
          </div>
        </div>

        {/* 30-Second Progress Bar */}
        {isReconnecting && (
          <div className="space-y-1.5">
            <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-all duration-1000 ease-linear rounded-full"
                style={{ width: `${Math.max(0, Math.min(100, (status.remainingSeconds / 30) * 100))}%` }}
              />
            </div>
            <div className="flex justify-between items-center text-3xs text-slate-400 font-mono">
              <span>Automatic ICE restart active</span>
              <span>Timeout in {status.remainingSeconds}s</span>
            </div>
          </div>
        )}

        {/* Actions for Failed Reconnection */}
        {isFailed && (
          <div className="pt-2 border-t border-white/10 flex items-center justify-end gap-2">
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="px-3 py-1.5 text-xs text-slate-300 hover:text-white rounded-md border border-white/10 hover:bg-white/5 transition-colors"
              >
                Dismiss
              </button>
            )}
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#030D09] bg-green hover:bg-green-400 rounded-md transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry Reconnection
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
