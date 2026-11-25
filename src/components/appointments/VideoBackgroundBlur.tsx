'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import {
  BackgroundEffectProcessor,
  type BackgroundEffectStats,
  type BlurIntensity,
} from '@/lib/videoBackgroundBlur';

interface VideoBackgroundBlurProps {
  localVideoStream: MediaStream | null;
  onProcessedStreamReady?: (stream: MediaStream) => void;
}

/**
 * Standalone background blur preview (pre-call / appointment screens).
 * Uses the same MediaPipe segmentation pipeline as the consultation view (#255).
 */
export function VideoBackgroundBlur({ localVideoStream, onProcessedStreamReady }: VideoBackgroundBlurProps) {
  const previewRef = useRef<HTMLVideoElement>(null);
  const processorRef = useRef<BackgroundEffectProcessor | null>(null);
  const onReadyRef = useRef(onProcessedStreamReady);
  onReadyRef.current = onProcessedStreamReady;

  const [blurEnabled, setBlurEnabled] = useState(true);
  const [intensity, setIntensity] = useState<BlurIntensity>('light');
  const [stats, setStats] = useState<BackgroundEffectStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSupported = typeof window === 'undefined' || BackgroundEffectProcessor.isSupported();

  useEffect(() => {
    if (!localVideoStream || !isSupported) return;
    const processor = new BackgroundEffectProcessor({
      onStatusChange: (_status, err) => {
        setStats(processor.getStats());
        if (err) setError('Background blur could not start. Your real background is visible.');
      },
    });
    processorRef.current = processor;
    processor.setSettings({ mode: 'blur', blurIntensity: 'light' });

    let cancelled = false;
    processor
      .start(localVideoStream)
      .then((stream) => {
        if (cancelled) return;
        if (previewRef.current) previewRef.current.srcObject = stream;
        onReadyRef.current?.(stream);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to initialize background blur');
      });

    const timer = setInterval(() => setStats(processor.getStats()), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      processor.destroy();
      processorRef.current = null;
    };
  }, [localVideoStream, isSupported]);

  useEffect(() => {
    processorRef.current?.setSettings({
      mode: blurEnabled ? 'blur' : 'none',
      blurIntensity: intensity,
    });
  }, [blurEnabled, intensity]);

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">Background Privacy Controls</h3>
        {!isSupported && (
          <div className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
            <AlertCircle className="h-4 w-4" />
            Not supported on this device
          </div>
        )}
      </div>

      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</div>}

      <video
        ref={previewRef}
        className="h-auto w-full rounded border border-gray-200 bg-black dark:border-gray-700"
        playsInline
        muted
        autoPlay
      />

      {isSupported && (
        <div className="space-y-3 border-t border-gray-200 pt-3 dark:border-gray-800">
          <button
            type="button"
            onClick={() => setBlurEnabled((v) => !v)}
            className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {blurEnabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {blurEnabled ? 'Disable' : 'Enable'} Background Blur
          </button>

          {blurEnabled && (
            <div className="flex gap-2" role="radiogroup" aria-label="Blur intensity">
              {(['light', 'strong'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={intensity === level}
                  onClick={() => setIntensity(level)}
                  className={`rounded px-3 py-1.5 text-sm capitalize ${
                    intensity === level ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'border border-gray-200 dark:border-gray-700'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400">
        {stats?.status === 'active'
          ? `✓ Processing at ${stats.fps.toFixed(0)} fps`
          : stats?.status === 'loading'
            ? 'Loading segmentation model…'
            : 'Processing video stream...'}
      </p>
    </div>
  );
}
