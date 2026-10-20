'use client';

import { useRef, useState, useCallback, useEffect } from 'react';

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
    setPipSupported(
      typeof document !== 'undefined' && 'pictureInPictureEnabled' in document,
    );
  }, []);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const toggleNativePiP = useCallback(async () => {
    if (!videoRef.current) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
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
  }, []);

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
