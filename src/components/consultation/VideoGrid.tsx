'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { startVideoPlayback, watchVideoPlayback } from '@/lib/video';

export interface VideoGridTile {
  id: string;
  label: string;
  stream: MediaStream | null;
  /** Local previews and shared screens are muted so mobile browsers allow autoplay. */
  muted?: boolean;
}

interface Props {
  tiles: VideoGridTile[];
  /** Receives each tile's `<video>` element (or `null` on unmount) so callers can drive it. */
  onVideoElement?: (tileId: string, element: HTMLVideoElement | null) => void;
}

/**
 * Lays out one `<video>` tile per media stream. Every tile is rendered with
 * `playsInline` and `autoPlay`, which iOS Safari needs to keep video inside the page.
 * If the browser refuses autoplay, the tile shows a "Tap to Start Video" button,
 * because only a user gesture can start playback there. Interruptions, such as an
 * incoming phone call, are recovered by `watchVideoPlayback`.
 */
export default function VideoGrid({ tiles, onVideoElement }: Props) {
  const columns = tiles.length > 1 ? 'grid-cols-2' : 'grid-cols-1';

  return (
    <div className={`grid h-full w-full gap-1 bg-black ${columns}`}>
      {tiles.map((tile) => (
        <VideoTile key={tile.id} tile={tile} onVideoElement={onVideoElement} />
      ))}
    </div>
  );
}

function VideoTile({
  tile,
  onVideoElement,
}: {
  tile: VideoGridTile;
  onVideoElement?: Props['onVideoElement'];
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [failed, setFailed] = useState(false);

  const setVideoRef = useCallback(
    (element: HTMLVideoElement | null) => {
      videoRef.current = element;
      onVideoElement?.(tile.id, element);
    },
    [onVideoElement, tile.id],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.srcObject = tile.stream;
    setNeedsTap(false);
    setFailed(false);
    if (!tile.stream) return;

    let cancelled = false;
    let stopWatching: (() => void) | null = null;

    void startVideoPlayback(video).then((result) => {
      if (cancelled) return;
      setNeedsTap(result === 'blocked');
      setFailed(result === 'failed');
      stopWatching = watchVideoPlayback(video, {
        onBlocked: () => setNeedsTap(true),
        onFailed: () => setFailed(true),
        onResumed: () => {
          setNeedsTap(false);
          setFailed(false);
        },
      });
    });

    return () => {
      cancelled = true;
      stopWatching?.();
    };
  }, [tile.stream]);

  const handleTapToStart = async () => {
    const video = videoRef.current;
    if (!video) return;
    const result = await startVideoPlayback(video);
    setNeedsTap(result === 'blocked');
    setFailed(result === 'failed');
  };

  return (
    <div className="relative min-h-0 overflow-hidden bg-black">
      <video
        ref={setVideoRef}
        autoPlay
        playsInline
        muted={tile.muted ?? true}
        aria-label={tile.label}
        className="h-full w-full object-contain bg-black"
      />

      {needsTap && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <button
            type="button"
            onClick={handleTapToStart}
            className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90"
          >
            Tap to Start Video
          </button>
        </div>
      )}

      {failed && !needsTap && (
        <p className="absolute inset-x-0 bottom-8 px-3 text-center text-xs text-white">
          Video could not start. Check the camera and network connection.
        </p>
      )}

      <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-3xs text-white">
        {tile.label}
      </span>
    </div>
  );
}
