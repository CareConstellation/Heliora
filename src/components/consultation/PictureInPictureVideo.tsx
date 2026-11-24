'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { isPictureInPictureAvailable, toggleVideoPictureInPicture } from '@/lib/video';

interface Props {
  src?: string;
  stream?: MediaStream | null;
  isMinimized: boolean;
  onToggleMinimize: () => void;
}

export default function PictureInPictureVideo({
  src,
  stream,
  isMinimized,
  onToggleMinimize,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);

  useEffect(() => {
    setPipSupported(isPictureInPictureAvailable(document));
  }, []);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Native PiP keeps the element's audio playing, so two-way sound is unaffected (#265).
  const toggleNativePiP = useCallback(async () => {
    if (!videoRef.current) return;

    try {
      const active = await toggleVideoPictureInPicture(videoRef.current, document);
      setIsPiPActive(active);
    } catch {
      onToggleMinimize();
    }
  }, [onToggleMinimize]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnter = () => setIsPiPActive(true);
    const onLeave = () => setIsPiPActive(false);

    video.addEventListener('enterpictureinpicture', onEnter);
    video.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter);
      video.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, [src, stream]);

  if (src && !stream) {
    return (
      <div
        className={
          isMinimized
            ? 'fixed bottom-4 right-4 z-50 w-72 aspect-video rounded-xl shadow-2xl overflow-hidden border border-border'
            : 'w-full h-full relative'
        }
      >
        <iframe
          src={src}
          allow="camera; microphone; fullscreen; display-capture"
          className="w-full h-full bg-black"
          title="Video consultation"
        />
        <button
          onClick={onToggleMinimize}
          className="absolute top-2 right-2 rounded-md bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80"
        >
          {isMinimized ? 'Expand' : 'Minimize'}
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-contain bg-black"
      />
      {isPiPActive && (
        <span
          role="status"
          className="absolute top-2 left-2 rounded-md bg-green px-2 py-1 text-xs font-semibold text-[#030D09]"
        >
          PiP active
        </span>
      )}
      {pipSupported && (
        <button
          onClick={toggleNativePiP}
          className="absolute top-2 right-2 rounded-md bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80"
        >
          {isPiPActive ? 'Exit PiP' : 'Picture-in-Picture'}
        </button>
      )}
    </div>
  );
}
