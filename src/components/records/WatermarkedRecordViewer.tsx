'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useWalletStore } from '@/store/useWalletStore';
import {
  computeViewerFingerprint,
  renderCanvasWatermark,
  embedSteganographicWatermark,
  type WatermarkPayload,
  type WatermarkConfig,
} from '@/lib/crypto';

interface Props {
  src: string;
  alt?: string;
  type: 'image' | 'pdf';
  className?: string;
}

async function getIpHash(): Promise<string> {
  try {
    const res = await fetch('/api/viewer-ip-hash');
    const data = await res.json();
    return typeof data.ipHash === 'string' ? data.ipHash.slice(0, 16) : '0000000000000000';
  } catch {
    const fallback = `${Date.now()}-${Math.random()}`;
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fallback));
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
  }
}

export default function WatermarkedRecordViewer({ src, alt, type, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { publicKey } = useWalletStore();

  const applyWatermark = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !publicKey) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ipHash = await getIpHash();
    const payload: WatermarkPayload = {
      viewerPublicKey: publicKey,
      viewerIpHash: ipHash,
      viewedAt: new Date().toISOString(),
    };
    const fingerprint = await computeViewerFingerprint(payload);
    const config: WatermarkConfig = { payload, fingerprint };

    if (type === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        embedSteganographicWatermark(imageData, fingerprint);
        ctx.putImageData(imageData, 0, 0);

        renderCanvasWatermark(ctx, canvas.width, canvas.height, config);
      };
      img.src = src;
    } else {
      canvas.width = containerRef.current?.clientWidth ?? 800;
      canvas.height = containerRef.current?.clientHeight ?? 1100;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      renderCanvasWatermark(ctx, canvas.width, canvas.height, config);
    }
  }, [src, type, publicKey]);

  useEffect(() => {
    void applyWatermark();
  }, [applyWatermark]);

  const preventExtraction = useCallback((e: React.MouseEvent | React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative', userSelect: 'none', WebkitUserSelect: 'none' }}
      onContextMenu={preventExtraction}
      onDragStart={preventExtraction}
    >
      {type === 'pdf' && (
        <iframe
          src={src}
          title={alt ?? 'Medical record'}
          className="w-full h-full border-0"
          style={{ pointerEvents: 'auto' }}
        />
      )}
      <canvas
        ref={canvasRef}
        style={{
          position: type === 'pdf' ? 'absolute' : 'relative',
          top: 0,
          left: 0,
          width: '100%',
          height: type === 'pdf' ? '100%' : 'auto',
          pointerEvents: type === 'pdf' ? 'none' : 'auto',
        }}
      />
    </div>
  );
}
