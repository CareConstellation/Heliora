'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Contrast, Maximize2, RotateCcw, Tag, X, ZoomIn, ZoomOut } from 'lucide-react';
import { sanitizeFile } from '@/lib/fileSanitizer';
import {
  parseDicomImage,
  parseDicomTags,
  renderDicomToCanvas,
  WINDOW_PRESETS,
  type DicomImage,
  type DicomTag,
} from '@/lib/dicomImage';

export interface DicomViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** URL to fetch a DICOM study from. */
  src?: string;
  /** Optional pre-loaded DICOM bytes. */
  buffer?: ArrayBuffer;
  title?: string;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

export default function DicomViewerModal({
  isOpen,
  onClose,
  src,
  buffer,
  title = 'DICOM Study Viewer',
}: DicomViewerModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const [image, setImage] = useState<DicomImage | null>(null);
  const [tags, setTags] = useState<DicomTag[]>([]);
  const [showTags, setShowTags] = useState(false);
  const [error, setError] = useState('');
  const [frame, setFrame] = useState(0);
  const [win, setWin] = useState<{ center: number; width: number }>(WINDOW_PRESETS['Soft Tissue']);
  const [invert, setInvert] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setInvert(false);
    if (image?.window) {
      setWin(image.window);
    } else {
      setWin(WINDOW_PRESETS['Soft Tissue']);
    }
  }, [image]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || (!src && !buffer)) return;
    let cancelled = false;
    setError('');
    setImage(null);
    setTags([]);
    setFrame(0);

    void (async () => {
      try {
        let arrayBuffer: ArrayBuffer;
        if (buffer) {
          arrayBuffer = buffer;
        } else if (src) {
          const res = await fetch(src);
          if (!res.ok) throw new Error(`Failed to fetch DICOM (${res.status})`);
          arrayBuffer = await res.arrayBuffer();
        } else {
          return;
        }

        const rawFile = new File([arrayBuffer], 'study.dcm');
        const { file } = await sanitizeFile(rawFile);
        const sanitizedBytes = await file.arrayBuffer();
        const parsedImage = parseDicomImage(sanitizedBytes);
        const parsedTags = parseDicomTags(sanitizedBytes, { includePatientMetadata: false });

        if (cancelled) return;
        setImage(parsedImage);
        setTags(parsedTags);
        if (parsedImage.window) {
          setWin(parsedImage.window);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Unable to load DICOM imaging study');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, src, buffer]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    renderDicomToCanvas(canvas, image, frame, {
      center: win.center,
      width: win.width,
      invert,
    });
  }, [image, frame, win, invert]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Maximize2 className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-text-1">{title}</h2>
            {image && (
              <span className="rounded bg-surface-hover px-2 py-0.5 font-mono text-xs text-text-2">
                {image.columns}×{image.rows} · {image.frames} frame{image.frames > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close DICOM viewer"
            className="rounded-md p-1.5 text-text-2 hover:bg-surface-hover hover:text-text-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:flex-row">
          {/* Canvas Viewport */}
          <div className="flex flex-1 flex-col gap-3">
            <div className="relative flex min-h-[360px] flex-1 items-center justify-center overflow-hidden rounded-lg bg-black">
              {error ? (
                <p role="alert" className="px-4 text-center text-sm text-red-400">
                  {error}
                </p>
              ) : !image ? (
                <p className="text-sm text-neutral-400">Loading DICOM study…</p>
              ) : (
                <canvas
                  ref={canvasRef}
                  width={image.columns}
                  height={image.rows}
                  data-testid="dicom-canvas"
                  className="max-h-[58vh] cursor-grab touch-none active:cursor-grabbing"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  }}
                  onWheel={(e) => {
                    e.preventDefault();
                    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(z - e.deltaY / 500).toFixed(2))));
                  }}
                  onPointerDown={(e) => {
                    dragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!dragRef.current) return;
                    setPan({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
                  }}
                  onPointerUp={() => {
                    dragRef.current = null;
                  }}
                />
              )}

              {/* Overlay HUD */}
              {image && (
                <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 font-mono text-[11px] text-neutral-200">
                  WC: {win.center} · WW: {win.width} · Zoom: {Math.round(zoom * 100)}%
                  {invert ? ' · INV' : ''}
                </div>
              )}
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {Object.entries(WINDOW_PRESETS).map(([name, preset]) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setWin(preset)}
                    aria-pressed={win.center === preset.center && win.width === preset.width}
                    className="rounded-md border border-border px-2.5 py-1 text-xs text-text-1 transition hover:bg-surface-hover aria-pressed:border-primary aria-pressed:bg-surface-hover"
                  >
                    {name}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.25).toFixed(2)))}
                  aria-label="Zoom out"
                  className="rounded-md border border-border p-1.5 text-text-1 hover:bg-surface-hover"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.25).toFixed(2)))}
                  aria-label="Zoom in"
                  className="rounded-md border border-border p-1.5 text-text-1 hover:bg-surface-hover"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setInvert((prev) => !prev)}
                  aria-pressed={invert}
                  className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-1 hover:bg-surface-hover aria-pressed:border-primary aria-pressed:bg-surface-hover"
                >
                  <Contrast className="h-3.5 w-3.5" />
                  Invert
                </button>
                <button
                  type="button"
                  onClick={() => setShowTags((prev) => !prev)}
                  aria-pressed={showTags}
                  className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-1 hover:bg-surface-hover aria-pressed:border-primary aria-pressed:bg-surface-hover"
                >
                  <Tag className="h-3.5 w-3.5" />
                  Tags ({tags.length})
                </button>
                <button
                  type="button"
                  onClick={resetView}
                  className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-1 hover:bg-surface-hover"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </button>
              </div>
            </div>

            {/* Sliders */}
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-text-2">
                <div className="flex justify-between">
                  <span>Window Center (Level)</span>
                  <span className="font-mono text-text-1">{win.center} HU</span>
                </div>
                <input
                  type="range"
                  aria-label="Window Center"
                  min={-1000}
                  max={3000}
                  value={win.center}
                  onChange={(e) => setWin((w) => ({ ...w, center: Number(e.target.value) }))}
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-text-2">
                <div className="flex justify-between">
                  <span>Window Width</span>
                  <span className="font-mono text-text-1">{win.width} HU</span>
                </div>
                <input
                  type="range"
                  aria-label="Window Width"
                  min={1}
                  max={4000}
                  value={win.width}
                  onChange={(e) => setWin((w) => ({ ...w, width: Number(e.target.value) }))}
                />
              </label>

              {image && image.frames > 1 && (
                <label className="flex flex-col gap-1 text-xs text-text-2 sm:col-span-2">
                  <div className="flex justify-between">
                    <span>Slice / Frame</span>
                    <span className="font-mono text-text-1">
                      {frame + 1} / {image.frames}
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Slice"
                    min={0}
                    max={image.frames - 1}
                    value={frame}
                    onChange={(e) => setFrame(Number(e.target.value))}
                  />
                </label>
              )}
            </div>
          </div>

          {/* Optional DICOM Tags Panel */}
          {showTags && (
            <aside
              aria-label="DICOM Metadata Tags"
              className="w-full shrink-0 overflow-y-auto rounded-lg border border-border p-3 lg:w-72"
            >
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2">
                DICOM Tags (Sanitized)
              </h3>
              {tags.length === 0 ? (
                <p className="text-xs text-text-3">No tags parsed.</p>
              ) : (
                <dl className="space-y-1.5 text-xs">
                  {tags.map((t) => (
                    <div key={t.tag} className="border-b border-border/50 pb-1">
                      <dt className="flex items-center justify-between font-mono text-[11px] text-text-2">
                        <span>{t.formattedTag}</span>
                        <span>{t.vr}</span>
                      </dt>
                      <dd className="truncate font-medium text-text-1" title={String(t.value)}>
                        {t.name}: <span className="font-mono font-normal">{String(t.value)}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
