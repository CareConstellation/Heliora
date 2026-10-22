'use client';

import { useEffect, useRef, useState } from 'react';
import { sanitizeFile } from '@/lib/fileSanitizer';
import { applyWindow, parseDicomImage, WINDOW_PRESETS, type DicomImage } from '@/lib/dicomImage';

interface Props {
  src: string;
}

export default function DicomViewer({ src }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [image, setImage] = useState<DicomImage | null>(null);
  const [error, setError] = useState('');
  const [frame, setFrame] = useState(0);
  const [win, setWin] = useState<{ center: number; width: number }>(WINDOW_PRESETS['Soft Tissue']);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(src);
        const raw = new File([await res.arrayBuffer()], 'study.dcm');
        // Blank identity tags before the bytes are parsed or held by the viewer.
        const { file } = await sanitizeFile(raw);
        const parsed = parseDicomImage(await file.arrayBuffer());
        if (cancelled) return;
        setImage(parsed);
        if (parsed.window) setWin(parsed.window);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load imaging study');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    const slice = image?.slices[frame];
    if (!image || !slice || !ctx) return;
    const pixels = applyWindow(slice, win.center, win.width);
    ctx.putImageData(new ImageData(pixels, image.columns, image.rows), 0, 0);
  }, [image, frame, win]);

  if (error)
    return (
      <p role="alert" className="text-xs text-red-600">
        {error}
      </p>
    );
  if (!image) return <p className="text-xs text-text-3">Loading imaging study…</p>;

  return (
    <div className="space-y-2" aria-label="DICOM viewer">
      <div className="overflow-hidden rounded-md bg-black">
        <canvas
          ref={canvasRef}
          width={image.columns}
          height={image.rows}
          className="mx-auto max-h-80 cursor-grab touch-none"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          onWheel={(e) => setZoom((z) => Math.min(8, Math.max(0.5, z - e.deltaY / 500)))}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) =>
            drag.current && setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })
          }
          onPointerUp={() => (drag.current = null)}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {Object.entries(WINDOW_PRESETS).map(([name, w]) => (
          <button
            key={name}
            type="button"
            onClick={() => setWin(w)}
            aria-pressed={win.center === w.center && win.width === w.width}
            className="rounded-md border border-border px-2 py-1 text-xs text-text-1 aria-pressed:bg-surface-hover"
          >
            {name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          className="rounded-md border border-border px-2 py-1 text-xs text-text-1"
        >
          Reset view
        </button>
      </div>

      <label className="flex items-center gap-2 text-xs text-text-2">
        Level (HU)
        <input
          type="range"
          min={-1000}
          max={3000}
          value={win.center}
          onChange={(e) => setWin((w) => ({ ...w, center: Number(e.target.value) }))}
        />
        <span className="font-mono">{win.center}</span>
      </label>
      <label className="flex items-center gap-2 text-xs text-text-2">
        Window (HU)
        <input
          type="range"
          min={1}
          max={4000}
          value={win.width}
          onChange={(e) => setWin((w) => ({ ...w, width: Number(e.target.value) }))}
        />
        <span className="font-mono">{win.width}</span>
      </label>

      {image.frames > 1 && (
        <label className="flex items-center gap-2 text-xs text-text-2">
          Slice
          <input
            type="range"
            min={0}
            max={image.frames - 1}
            value={frame}
            onChange={(e) => setFrame(Number(e.target.value))}
          />
          <span className="font-mono">
            {frame + 1}/{image.frames}
          </span>
        </label>
      )}
    </div>
  );
}
