'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import VideoGrid from './VideoGrid';
import {
  buildPreCallRecommendations,
  computeVuLevel,
  getTurnConfigFromEnv,
  isSignalDetected,
  measureTurnRoundTrip,
  type PreCallRecommendation,
  type PreCallReport,
} from '@/lib/preCallDiagnostics';

interface Props {
  /** Called after all camera and microphone tracks have been released. */
  onContinue: () => void;
}

type Phase = 'idle' | 'checking' | 'ready';

/** How long the microphone meter runs before it is judged for a voice signal. */
const MIC_LISTEN_MS = 4_000;

const SEVERITY_STYLES: Record<PreCallRecommendation['severity'], string> = {
  ok: 'border-green/30 bg-green/10 text-text-1',
  warning: 'border-yellow-500/30 bg-yellow-500/10 text-text-1',
  error: 'border-red-500/30 bg-red-500/10 text-red-700',
};

/**
 * Runs before a consultation starts: previews the camera, shows a live microphone
 * meter, measures the round trip to the call relay, and explains what to fix.
 * All media tracks are released before `onContinue`, so the call can use the devices.
 */
export default function PreCallDiagnostic({ onContinue }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [level, setLevel] = useState(0);
  const [recommendations, setRecommendations] = useState<PreCallRecommendation[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const peakLevelRef = useRef(0);

  const stopMedia = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    setLevel(0);
  }, []);

  useEffect(() => () => stopMedia(), [stopMedia]);

  const startMicrophoneMeter = (mediaStream: MediaStream) => {
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor || mediaStream.getAudioTracks().length === 0) return;

    const context = new AudioContextCtor();
    audioContextRef.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(mediaStream).connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      const current = computeVuLevel(samples);
      peakLevelRef.current = Math.max(peakLevelRef.current, current);
      setLevel(current);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  };

  const runChecks = async () => {
    stopMedia();
    peakLevelRef.current = 0;
    setPhase('checking');
    setRecommendations([]);

    let mediaErrorName: string | null = null;
    let mediaStream: MediaStream | null = null;
    const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (!getUserMedia) {
      // Camera and microphone access needs a secure context (HTTPS or localhost).
      mediaErrorName = 'SecurityError';
    } else {
      try {
        mediaStream = await getUserMedia({ video: true, audio: true });
      } catch (err) {
        mediaErrorName = (err as { name?: string } | null)?.name ?? 'UnknownError';
      }
    }

    if (mediaStream) {
      streamRef.current = mediaStream;
      setStream(mediaStream);
      startMicrophoneMeter(mediaStream);
    }

    await new Promise((resolve) => setTimeout(resolve, MIC_LISTEN_MS));

    const turnConfig = getTurnConfigFromEnv();
    const roundTripMs = turnConfig ? await measureTurnRoundTrip(turnConfig) : null;

    const report: PreCallReport = {
      mediaErrorName,
      micSignalDetected: isSignalDetected(peakLevelRef.current),
      roundTripMs,
      turnConfigured: turnConfig !== null,
    };
    setRecommendations(buildPreCallRecommendations(report));
    setPhase('ready');
  };

  const handleContinue = () => {
    stopMedia();
    onContinue();
  };

  const meterPercent = Math.round(level * 100);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-y-auto p-6">
      <header>
        <h1 className="text-lg font-semibold text-text-1">Pre-call check</h1>
        <p className="text-sm text-text-3">
          Confirm your camera, microphone and connection before you join the consultation.
        </p>
      </header>

      <div className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
        {stream ? (
          <VideoGrid tiles={[{ id: 'preview', label: 'Your camera', stream, muted: true }]} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/70">
            Camera preview appears here
          </div>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs text-text-3">Microphone level</p>
        <div
          role="meter"
          aria-label="Microphone level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={meterPercent}
          className="h-2 w-full overflow-hidden rounded-full bg-surface-inset"
        >
          <div
            className="h-full bg-green transition-[width] duration-100"
            style={{ width: `${meterPercent}%` }}
          />
        </div>
      </div>

      {phase === 'checking' && (
        <p role="status" className="text-xs text-text-2">
          Checking camera, microphone and connection…
        </p>
      )}

      {recommendations.length > 0 && (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {recommendations.map((item) => (
            <li key={item.id} className={`rounded-md border px-3 py-2 text-sm ${SEVERITY_STYLES[item.severity]}`}>
              {item.message}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={runChecks}
          disabled={phase === 'checking'}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-1 hover:bg-surface-hover disabled:opacity-50"
        >
          {phase === 'idle' ? 'Start check' : 'Run check again'}
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={phase === 'checking'}
          className="rounded-md bg-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {phase === 'ready' ? 'Join consultation' : 'Skip check'}
        </button>
      </div>
    </div>
  );
}
