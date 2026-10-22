'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Eye, EyeOff, Sliders } from 'lucide-react';
import { createVideoBlurProcessor } from '@/lib/videoBackgroundBlur';

interface VideoBackgroundBlurProps {
  localVideoStream: MediaStream | null;
  onProcessedStreamReady?: (stream: MediaStream) => void;
}

export function VideoBackgroundBlur({ localVideoStream, onProcessedStreamReady }: VideoBackgroundBlurProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const processorRef = useRef<any>(null);

  const [blurEnabled, setBlurEnabled] = useState(true);
  const [blurStrength, setBlurStrength] = useState(15);
  const [frameRate, setFrameRate] = useState(24);
  const [isSupported, setIsSupported] = useState(true);
  const [hasProcessedStream, setHasProcessedStream] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!localVideoStream || !videoRef.current || !canvasRef.current) return;

    const initializeProcessor = async () => {
      try {
        const processor = await createVideoBlurProcessor(videoRef.current!, canvasRef.current!, {
          enabled: blurEnabled,
          blurStrength,
          frameRate,
        });

        if (!processor.isSupported()) {
          setIsSupported(false);
          return;
        }

        processorRef.current = processor;
        processor.start();

        // Capture the canvas stream for transmission
        const canvasStream = await processor.getLocalMediaTrack(canvasRef.current!);
        if (canvasStream) {
          onProcessedStreamReady?.(canvasStream);
          setHasProcessedStream(true);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to initialize background blur';
        setError(message);
        console.error('Background blur initialization error:', err);
      }
    };

    videoRef.current.srcObject = localVideoStream;
    void videoRef.current.play().catch(() => {
      // Autoplay can be blocked until the user interacts with the page.
    });

    const timer = setTimeout(() => {
      void initializeProcessor();
    }, 500);

    return () => {
      clearTimeout(timer);
      if (processorRef.current) {
        processorRef.current.stop();
      }
    };
  }, [localVideoStream, blurEnabled, blurStrength, frameRate, onProcessedStreamReady]);

  const handleBlurToggle = () => {
    setBlurEnabled(!blurEnabled);
    if (processorRef.current) {
      processorRef.current.updateOptions({ enabled: !blurEnabled });
    }
  };

  const handleBlurStrengthChange = (value: number) => {
    setBlurStrength(value);
    if (processorRef.current) {
      processorRef.current.updateOptions({ blurStrength: value });
    }
  };

  const handleFrameRateChange = (value: number) => {
    setFrameRate(value);
    if (processorRef.current) {
      processorRef.current.updateOptions({ frameRate: value });
    }
  };

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

      <div className="space-y-4">
        {/* Video preview hidden - only used for processing */}
        <video
          ref={videoRef}
          className="hidden"
          playsInline
          muted
          autoPlay
        />

        {/* Canvas showing processed output */}
        <canvas
          ref={canvasRef}
          className="h-auto w-full rounded border border-gray-200 bg-black dark:border-gray-700"
        />

        {/* Controls */}
        {isSupported && (
          <div className="space-y-3 border-t border-gray-200 pt-3 dark:border-gray-800">
            <button
              onClick={handleBlurToggle}
              className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {blurEnabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              {blurEnabled ? 'Disable' : 'Enable'} Background Blur
            </button>

            {blurEnabled && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                      <Sliders className="h-4 w-4" />
                      Blur Strength
                    </label>
                    <span className="text-sm font-mono text-gray-600 dark:text-gray-400">{blurStrength}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={blurStrength}
                    onChange={(e) => handleBlurStrengthChange(parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Target Frame Rate</label>
                    <span className="text-sm font-mono text-gray-600 dark:text-gray-400">{frameRate} FPS</span>
                  </div>
                  <select
                    value={frameRate}
                    onChange={(e) => handleFrameRateChange(parseInt(e.target.value))}
                    className="w-full rounded border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
                  >
                    <option value={15}>15 FPS (low performance impact)</option>
                    <option value={24}>24 FPS (recommended)</option>
                    <option value={30}>30 FPS (high performance impact)</option>
                  </select>
                </div>
              </>
            )}
          </div>
        )}

        <p className="text-xs text-gray-500 dark:text-gray-400">
          {hasProcessedStream ? '✓ Processed stream ready for transmission' : 'Processing video stream...'}
        </p>
      </div>
    </div>
  );
}
