'use client';

import { useEffect, useRef } from 'react';
import { AlertCircle, Droplets, ImageIcon, VideoOff, X } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import {
  CLINICAL_BACKDROPS,
  type BackgroundEffectSettings,
  type BackgroundEffectStats,
} from '@/lib/videoBackgroundBlur';

interface Props {
  settings: BackgroundEffectSettings;
  onChange: (settings: BackgroundEffectSettings) => void;
  onClose: () => void;
  /** Processed stream to preview; omitted when no camera is attached. */
  previewStream?: MediaStream | null;
  stats?: BackgroundEffectStats | null;
}

interface Option {
  key: string;
  label: string;
  description: string;
  settings: Partial<BackgroundEffectSettings>;
  swatch?: [string, string];
}

const OPTIONS: Option[] = [
  { key: 'none', label: 'Off', description: 'Show your camera as-is.', settings: { mode: 'none' } },
  {
    key: 'blur-light',
    label: 'Blur · Light',
    description: 'Softens the room while keeping context.',
    settings: { mode: 'blur', blurIntensity: 'light' },
  },
  {
    key: 'blur-strong',
    label: 'Blur · Strong',
    description: 'Hides details such as documents or other people.',
    settings: { mode: 'blur', blurIntensity: 'strong' },
  },
  ...CLINICAL_BACKDROPS.map<Option>((b) => ({
    key: `backdrop-${b.id}`,
    label: b.label,
    description: b.description,
    settings: { mode: 'backdrop', backdrop: b.id },
    swatch: b.stops,
  })),
];

export function optionKeyFor(settings: BackgroundEffectSettings): string {
  if (settings.mode === 'none') return 'none';
  if (settings.mode === 'blur') return `blur-${settings.blurIntensity}`;
  return `backdrop-${settings.backdrop}`;
}

/** Label used on the toolbar button; null when no effect is applied. */
export function describeBackgroundEffect(settings: BackgroundEffectSettings): string | null {
  if (settings.mode === 'none') return null;
  const key = optionKeyFor(settings);
  return OPTIONS.find((o) => o.key === key)?.label ?? null;
}

/**
 * Privacy backdrop picker (#255): blur intensity (Light / Strong) or a
 * clinical backdrop, with a live preview and frame-rate readout.
 */
export default function VideoSettingsModal({ settings, onChange, onClose, previewStream, stats }: Props) {
  const modalRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const previewRef = useRef<HTMLVideoElement>(null);
  const selected = optionKeyFor(settings);

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = previewStream ?? null;
  }, [previewStream]);

  const unavailable = stats?.status === 'unavailable' && settings.mode !== 'none';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl border border-border bg-surface-card p-6 shadow-2xl space-y-4 focus:outline-none"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 id="video-settings-title" className="text-base font-bold text-text-1">
              Video &amp; privacy backdrop
            </h3>
            <p className="text-xs text-text-3 mt-0.5">
              Processed on this device. Video frames are never uploaded for segmentation.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close video settings"
            className="rounded-md p-1 text-text-3 hover:bg-surface-hover hover:text-text-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
          {previewStream ? (
            <video
              ref={previewRef}
              data-testid="video-settings-preview"
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover -scale-x-100"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-white/70">
              <VideoOff className="h-5 w-5" aria-hidden="true" />
              Your choice applies as soon as your camera is on.
            </div>
          )}
          {stats && stats.status === 'active' && (
            <span
              className={`absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-3xs ${
                stats.fps > 0 && stats.fps < 24 ? 'text-yellow-300' : 'text-white'
              }`}
            >
              {stats.fps.toFixed(0)} fps
            </span>
          )}
          {stats?.status === 'loading' && (
            <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-3xs text-white">
              Loading model…
            </span>
          )}
        </div>

        {unavailable && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2.5 text-xs text-yellow-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Background effects could not start on this device. <strong>Your real background is visible.</strong>
            </span>
          </div>
        )}

        <fieldset>
          <legend className="sr-only">Background effect</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {OPTIONS.map((option) => {
              const isSelected = option.key === selected;
              return (
                <label
                  key={option.key}
                  className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-2.5 text-left transition-colors ${
                    isSelected ? 'border-green bg-green/5' : 'border-border hover:bg-surface-hover'
                  }`}
                >
                  <input
                    type="radio"
                    name="background-effect"
                    value={option.key}
                    checked={isSelected}
                    onChange={() => onChange({ ...settings, ...option.settings })}
                    className="sr-only"
                  />
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-text-1">
                    {option.swatch ? (
                      <span
                        aria-hidden="true"
                        className="h-3 w-3 rounded-sm border border-border"
                        style={{ background: `linear-gradient(${option.swatch[0]}, ${option.swatch[1]})` }}
                      />
                    ) : option.settings.mode === 'blur' ? (
                      <Droplets className="h-3 w-3" aria-hidden="true" />
                    ) : option.settings.mode === 'none' ? (
                      <VideoOff className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <ImageIcon className="h-3 w-3" aria-hidden="true" />
                    )}
                    {option.label}
                  </span>
                  <span className="text-3xs text-text-3">{option.description}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-green px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
