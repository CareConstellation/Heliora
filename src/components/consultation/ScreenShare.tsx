'use client';

import { useRef, useCallback } from 'react';

interface Props {
  onStreamStart: (stream: MediaStream) => void;
  onStreamStop: () => void;
  isSharing: boolean;
}

export default function ScreenShare({ onStreamStart, onStreamStop, isSharing }: Props) {
  const streamRef = useRef<MediaStream | null>(null);

  const startSharing = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      streamRef.current = stream;

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        streamRef.current = null;
        onStreamStop();
      });

      onStreamStart(stream);
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') {
        console.error('Screen share failed:', err);
      }
    }
  }, [onStreamStart, onStreamStop]);

  const stopSharing = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    onStreamStop();
  }, [onStreamStop]);

  return (
    <button
      onClick={isSharing ? stopSharing : startSharing}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        isSharing
          ? 'bg-red-500 text-white hover:bg-red-600'
          : 'border border-border text-text-1 hover:bg-surface-hover'
      }`}
    >
      {isSharing ? 'Stop Sharing' : 'Share Screen'}
    </button>
  );
}
