'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createNoiseCancellationPipeline,
  enforceAudioTrackConstraints,
  isNoiseCancellationSupported,
  startAdaptiveBitrate,
  type AdaptiveBitrateSample,
  type NoiseCancellationPipeline,
} from '@/lib/video';
import {
  BackgroundEffectProcessor,
  DEFAULT_BACKGROUND_SETTINGS,
  type BackgroundEffectSettings,
  type BackgroundEffectStats,
} from '@/lib/videoBackgroundBlur';

export interface ConsultationMediaInput {
  /** Local camera + microphone stream, when the call exposes one. */
  localStream?: MediaStream | null | undefined;
  /** Peer connection carrying the call, when the call exposes one. */
  peerConnection?: RTCPeerConnection | null | undefined;
}

/**
 * Wires the consultation's local media through the noise cancellation graph
 * (#256) and background effect processor (#255), swaps the processed tracks
 * onto the peer connection's senders, and runs adaptive bitrate control
 * (#254). Every stage is optional: with no stream or peer connection the hook
 * only holds the user's preferences.
 */
export function useConsultationMedia({ localStream, peerConnection }: ConsultationMediaInput) {
  const [noiseCancellationEnabled, setNoiseCancellationEnabled] = useState(true);
  const [backgroundSettings, setBackgroundSettings] =
    useState<BackgroundEffectSettings>(DEFAULT_BACKGROUND_SETTINGS);
  const [connectionSample, setConnectionSample] = useState<AdaptiveBitrateSample | null>(null);
  const [backgroundStats, setBackgroundStats] = useState<BackgroundEffectStats | null>(null);
  const [processedAudioTrack, setProcessedAudioTrack] = useState<MediaStreamTrack | null>(null);
  const [processedVideoTrack, setProcessedVideoTrack] = useState<MediaStreamTrack | null>(null);

  const audioPipelineRef = useRef<NoiseCancellationPipeline | null>(null);
  const processorRef = useRef<BackgroundEffectProcessor | null>(null);
  const settingsRef = useRef(backgroundSettings);
  settingsRef.current = backgroundSettings;

  const micTrack = localStream?.getAudioTracks()[0] ?? null;
  const cameraTrack = localStream?.getVideoTracks()[0] ?? null;
  const effectWanted = backgroundSettings.mode !== 'none';

  /* ── #254 adaptive bitrate ─────────────────────────────────── */
  useEffect(() => {
    if (!peerConnection) {
      setConnectionSample(null);
      return;
    }
    const controller = startAdaptiveBitrate(peerConnection, { onSample: setConnectionSample });
    return () => controller.stop();
  }, [peerConnection]);

  /* ── #256 noise cancellation graph ─────────────────────────── */
  useEffect(() => {
    if (!micTrack || !isNoiseCancellationSupported()) {
      setProcessedAudioTrack(null);
      return;
    }
    void enforceAudioTrackConstraints(micTrack);
    let pipeline: NoiseCancellationPipeline;
    try {
      pipeline = createNoiseCancellationPipeline(new MediaStream([micTrack]));
    } catch (err) {
      console.warn('Noise cancellation unavailable:', err);
      setProcessedAudioTrack(null);
      return;
    }
    audioPipelineRef.current = pipeline;
    setProcessedAudioTrack(pipeline.stream.getAudioTracks()[0] ?? null);
    return () => {
      audioPipelineRef.current = null;
      void pipeline.close();
    };
  }, [micTrack]);

  useEffect(() => {
    audioPipelineRef.current?.setEnabled(noiseCancellationEnabled);
  }, [noiseCancellationEnabled, processedAudioTrack]);

  /* ── #255 background effects (only runs while an effect is chosen) ── */
  useEffect(() => {
    if (!cameraTrack || !effectWanted || !BackgroundEffectProcessor.isSupported()) {
      setProcessedVideoTrack(null);
      setBackgroundStats(null);
      return;
    }
    let cancelled = false;
    const processor = new BackgroundEffectProcessor({
      onStatusChange: () => setBackgroundStats(processor.getStats()),
    });
    processor.setSettings(settingsRef.current);
    processorRef.current = processor;

    processor
      .start(new MediaStream([cameraTrack]))
      .then((stream) => {
        if (!cancelled) setProcessedVideoTrack(stream.getVideoTracks()[0] ?? null);
      })
      .catch((err) => {
        console.warn('Background effects unavailable:', err);
        if (!cancelled) setBackgroundStats({ ...processor.getStats(), status: 'unavailable' });
      });

    const statsTimer = setInterval(() => setBackgroundStats(processor.getStats()), 1000);
    return () => {
      cancelled = true;
      clearInterval(statsTimer);
      processorRef.current = null;
      processor.destroy();
      setProcessedVideoTrack(null);
    };
  }, [cameraTrack, effectWanted]);

  useEffect(() => {
    processorRef.current?.setSettings(backgroundSettings);
  }, [backgroundSettings]);

  /* ── Put the processed tracks on the wire ──────────────────── */
  const outgoingAudio =
    noiseCancellationEnabled && processedAudioTrack ? processedAudioTrack : micTrack;
  const outgoingVideo =
    effectWanted && processedVideoTrack && backgroundStats?.status !== 'unavailable'
      ? processedVideoTrack
      : cameraTrack;

  useEffect(() => {
    if (!peerConnection) return;
    for (const sender of peerConnection.getSenders()) {
      const kind = sender.track?.kind;
      const next = kind === 'audio' ? outgoingAudio : kind === 'video' ? outgoingVideo : null;
      if (next && sender.track !== next) {
        sender.replaceTrack(next).catch((err) => {
          console.warn(`Failed to replace outgoing ${kind} track:`, err);
        });
      }
    }
  }, [peerConnection, outgoingAudio, outgoingVideo]);

  const previewStream = useMemo(
    () => (outgoingVideo ? new MediaStream([outgoingVideo]) : null),
    [outgoingVideo],
  );

  const outgoingStream = useMemo(() => {
    const tracks = [outgoingAudio, outgoingVideo].filter((t): t is MediaStreamTrack => !!t);
    return tracks.length > 0 ? new MediaStream(tracks) : null;
  }, [outgoingAudio, outgoingVideo]);

  return {
    noiseCancellationEnabled,
    noiseCancellationAvailable: !!micTrack && isNoiseCancellationSupported(),
    toggleNoiseCancellation: () => setNoiseCancellationEnabled((v) => !v),
    backgroundSettings,
    setBackgroundSettings,
    backgroundStats,
    connectionSample,
    previewStream,
    outgoingStream,
  };
}
