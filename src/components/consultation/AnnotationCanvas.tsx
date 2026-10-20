'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import type { AnnotationTool, AnnotationStroke } from '@/types';

interface Props {
  width: number;
  height: number;
  onSaveSnapshot?: (blob: Blob) => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

const TOOL_STYLES: Record<AnnotationTool, { lineWidth: number; opacity: number }> = {
  pen: { lineWidth: 2, opacity: 1 },
  arrow: { lineWidth: 2, opacity: 1 },
  highlighter: { lineWidth: 20, opacity: 0.3 },
  text: { lineWidth: 0, opacity: 1 },
};

const PALETTE = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#FFFFFF'] as const;
const DEFAULT_COLOR: string = PALETTE[0];

function renderStroke(ctx: CanvasRenderingContext2D, stroke: AnnotationStroke) {
  const style = TOOL_STYLES[stroke.tool];
  ctx.save();
  ctx.globalAlpha = style.opacity;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (stroke.tool === 'pen' || stroke.tool === 'highlighter') {
    const first = stroke.points[0];
    if (stroke.points.length < 2 || !first) {
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < stroke.points.length; i++) {
      const pt = stroke.points[i];
      if (pt) ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
  } else if (stroke.tool === 'arrow') {
    const start = stroke.points[0];
    const end = stroke.points[stroke.points.length - 1];
    if (stroke.points.length < 2 || !start || !end) {
      ctx.restore();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const headLen = 15;
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(
      end.x - headLen * Math.cos(angle - Math.PI / 6),
      end.y - headLen * Math.sin(angle - Math.PI / 6),
    );
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(
      end.x - headLen * Math.cos(angle + Math.PI / 6),
      end.y - headLen * Math.sin(angle + Math.PI / 6),
    );
    ctx.stroke();
  } else if (stroke.tool === 'text' && stroke.text) {
    const anchor = stroke.points[0];
    if (!anchor) { ctx.restore(); return; }
    ctx.font = '16px sans-serif';
    ctx.fillText(stroke.text, anchor.x, anchor.y);
  }

  ctx.restore();
}

export default function AnnotationCanvas({
  width,
  height,
  onSaveSnapshot,
  videoRef,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<AnnotationStroke[]>([]);
  const [activeTool, setActiveTool] = useState<AnnotationTool>('pen');
  const [activeColor, setActiveColor] = useState<string>(DEFAULT_COLOR);
  const [isDrawing, setIsDrawing] = useState(false);
  const currentPoints = useRef<{ x: number; y: number }[]>([]);

  const getCanvasPoint = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
      };
    },
    [],
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes) renderStroke(ctx, stroke);
  }, [strokes]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const point = getCanvasPoint(e);

      if (activeTool === 'text') {
        const text = prompt('Enter annotation text:');
        if (!text) return;
        setStrokes((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            tool: 'text',
            points: [point],
            color: activeColor,
            lineWidth: 0,
            text,
          },
        ]);
        return;
      }

      setIsDrawing(true);
      currentPoints.current = [point];
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    },
    [activeTool, activeColor, getCanvasPoint],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawing) return;
      currentPoints.current.push(getCanvasPoint(e));

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      redraw();
      renderStroke(ctx, {
        id: 'preview',
        tool: activeTool,
        points: currentPoints.current,
        color: activeColor,
        lineWidth: TOOL_STYLES[activeTool].lineWidth,
      });
    },
    [isDrawing, activeTool, activeColor, getCanvasPoint, redraw],
  );

  const handlePointerUp = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);

    if (currentPoints.current.length >= 2) {
      setStrokes((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          tool: activeTool,
          points: [...currentPoints.current],
          color: activeColor,
          lineWidth: TOOL_STYLES[activeTool].lineWidth,
        },
      ]);
    }
    currentPoints.current = [];
  }, [isDrawing, activeTool, activeColor]);

  function handleUndo() {
    setStrokes((prev) => prev.slice(0, -1));
  }

  function handleClear() {
    setStrokes([]);
  }

  function handleSaveSnapshot() {
    if (!onSaveSnapshot) return;
    const mergeCanvas = document.createElement('canvas');
    mergeCanvas.width = width;
    mergeCanvas.height = height;
    const ctx = mergeCanvas.getContext('2d');
    if (!ctx) return;

    if (videoRef?.current) {
      ctx.drawImage(videoRef.current, 0, 0, width, height);
    }
    if (canvasRef.current) {
      ctx.drawImage(canvasRef.current, 0, 0);
    }

    mergeCanvas.toBlob((blob) => {
      if (blob) onSaveSnapshot(blob);
    }, 'image/png');
  }

  return (
    <div className="absolute inset-0">
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-lg bg-black/70 px-2 py-1.5">
        {(['pen', 'arrow', 'highlighter', 'text'] as AnnotationTool[]).map(
          (tool) => (
            <button
              key={tool}
              onClick={() => setActiveTool(tool)}
              className={`rounded px-2 py-1 text-xs font-medium capitalize transition-colors ${
                activeTool === tool
                  ? 'bg-white text-black'
                  : 'text-white hover:bg-white/20'
              }`}
            >
              {tool}
            </button>
          ),
        )}
        <div className="mx-1 h-4 w-px bg-white/30" />
        {PALETTE.map((color: string) => (
          <button
            key={color}
            onClick={() => setActiveColor(color)}
            className={`h-5 w-5 rounded-full border-2 transition-colors ${
              activeColor === color ? 'border-white' : 'border-transparent'
            }`}
            style={{ backgroundColor: color }}
          />
        ))}
        <div className="mx-1 h-4 w-px bg-white/30" />
        <button
          onClick={handleUndo}
          disabled={strokes.length === 0}
          className="rounded px-2 py-1 text-xs font-medium text-white hover:bg-white/20 disabled:opacity-30"
        >
          Undo
        </button>
        <button
          onClick={handleClear}
          disabled={strokes.length === 0}
          className="rounded px-2 py-1 text-xs font-medium text-white hover:bg-white/20 disabled:opacity-30"
        >
          Clear
        </button>
        {onSaveSnapshot && (
          <button
            onClick={handleSaveSnapshot}
            className="rounded bg-green px-2 py-1 text-xs font-semibold text-[#030D09] hover:bg-green-600"
          >
            Save Snapshot
          </button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ width: '100%', height: '100%', touchAction: 'none' }}
        className="cursor-crosshair"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
}
