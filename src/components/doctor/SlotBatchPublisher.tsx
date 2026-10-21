'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Pause,
  Play,
} from 'lucide-react';
import {
  batchInitializeSlots,
  type BatchProgress,
  type SlotBatchItem,
} from '@/lib/slotBatcher';
import { useWalletStore } from '@/store/useWalletStore';
import { freighterSigner } from '@/lib/stellar';
import type { TimeSlot } from '@/types';

interface SlotBatchPublisherProps {
  slots: TimeSlot[];
  onComplete?: (progress: BatchProgress) => void;
}

export default function SlotBatchPublisher({
  slots,
  onComplete,
}: SlotBatchPublisherProps) {
  const { publicKey } = useWalletStore();
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async () => {
    if (!publicKey || running) return;

    abortRef.current = new AbortController();
    setRunning(true);

    try {
      const result = await batchInitializeSlots(
        slots,
        publicKey,
        freighterSigner,
        setProgress,
        abortRef.current.signal,
      );
      onComplete?.(result);
    } catch {
      // Progress callback handles per-item errors
    } finally {
      setRunning(false);
    }
  }, [publicKey, slots, running, onComplete]);

  const pause = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
  }, []);

  const retryFailed = useCallback(async () => {
    if (!publicKey || !progress) return;

    const failedSlots = progress.items
      .filter((item) => item.status === 'failed')
      .map((item) => item.slot);

    if (failedSlots.length === 0) return;

    abortRef.current = new AbortController();
    setRunning(true);

    try {
      await batchInitializeSlots(
        failedSlots,
        publicKey,
        freighterSigner,
        setProgress,
        abortRef.current.signal,
      );
    } finally {
      setRunning(false);
    }
  }, [publicKey, progress]);

  const completionPercent = progress
    ? Math.round(
        ((progress.completed + progress.failed) / progress.total) * 100,
      )
    : 0;

  if (slots.length === 0) return null;

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-1">
          Slot Initialization
        </h3>
        <span className="text-xs text-text-3">
          {slots.length} slot{slots.length !== 1 ? 's' : ''}
        </span>
      </div>

      {progress && (
        <div className="mb-4">
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ background: 'var(--bg-inset)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${completionPercent}%`,
                background: progress.failed > 0 ? '#f59e0b' : '#00C896',
              }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-text-3">
            <span>{progress.completed} confirmed</span>
            {progress.failed > 0 && (
              <span className="text-red-400">{progress.failed} failed</span>
            )}
            <span>{completionPercent}%</span>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {!running && !progress && (
          <button
            onClick={start}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: '#00C896',
              color: '#0B0E0D',
            }}
            disabled={!publicKey}
          >
            <Play className="w-3.5 h-3.5" />
            Start Batch
          </button>
        )}

        {running && (
          <button
            onClick={pause}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-1)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <Pause className="w-3.5 h-3.5" />
            Pause
          </button>
        )}

        {!running && progress && progress.failed > 0 && (
          <button
            onClick={retryFailed}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-1)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Retry Failed ({progress.failed})
          </button>
        )}
      </div>

      {progress && (
        <div className="mt-4 max-h-48 overflow-y-auto space-y-1">
          {progress.items.map((item) => (
            <SlotStatusRow key={item.slot.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function SlotStatusRow({ item }: { item: SlotBatchItem }) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded text-xs"
      style={{ background: 'var(--bg-inset)' }}
    >
      {item.status === 'pending' && (
        <span
          className="w-3 h-3 rounded-full shrink-0"
          style={{ background: 'var(--text-3)' }}
        />
      )}
      {item.status === 'submitting' && (
        <Loader2
          className="w-3.5 h-3.5 animate-spin shrink-0"
          style={{ color: '#00C896' }}
        />
      )}
      {item.status === 'confirmed' && (
        <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
      )}
      {item.status === 'failed' && (
        <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
      )}
      <span className="text-text-2 truncate flex-1">
        {new Date(item.slot.datetime).toLocaleString()}
      </span>
      <span className="text-text-3">{item.slot.slotType ?? 'regular'}</span>
      {item.txHash && (
        <span className="font-mono text-text-3 truncate max-w-[80px]">
          {item.txHash}
        </span>
      )}
    </div>
  );
}
