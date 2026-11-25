'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyAudioOutputDevice,
  createFeedbackDetector,
  DEFAULT_AUDIO_OUTPUT_ID,
  isAudioOutputSelectionSupported,
  isNoiseCancellationSupported,
  listAudioOutputDevices,
  loadPreferredAudioOutput,
  playTestSpeakerSample,
  savePreferredAudioOutput,
  type AudioOutputDevice,
  type FeedbackDetector,
  type FeedbackDetectorStatus,
} from '@/lib/video';

const NOT_DUCKED: FeedbackDetectorStatus = { ducked: false, frequencyHz: null, gain: 1 };

/**
 * Watches the local microphone for acoustic feedback (#269). Returns the
 * gain remote playback should use and a `dismiss` that restores full volume.
 */
export function useFeedbackSuppression(micTrack: MediaStreamTrack | null) {
  const [status, setStatus] = useState<FeedbackDetectorStatus>(NOT_DUCKED);
  const detectorRef = useRef<FeedbackDetector | null>(null);

  useEffect(() => {
    if (!micTrack || !isNoiseCancellationSupported()) {
      setStatus(NOT_DUCKED);
      return;
    }
    let detector: FeedbackDetector;
    try {
      detector = createFeedbackDetector(new MediaStream([micTrack]), { onChange: setStatus });
    } catch (err) {
      console.warn('Feedback detection unavailable:', err);
      return;
    }
    detectorRef.current = detector;
    return () => {
      detectorRef.current = null;
      setStatus(NOT_DUCKED);
      void detector.stop();
    };
  }, [micTrack]);

  const dismiss = useCallback(() => {
    detectorRef.current?.reset();
    setStatus(NOT_DUCKED);
  }, []);

  return { ...status, dismiss };
}

export type SpeakerTestState = 'idle' | 'playing' | 'error';

/**
 * Speaker selection (#267): enumerates `audiooutput` devices, keeps the list
 * fresh on `devicechange`, persists the choice and routes every registered
 * media element to it with `setSinkId`.
 */
export function useAudioOutput() {
  const supported = isAudioOutputSelectionSupported();
  const [devices, setDevices] = useState<AudioOutputDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string>(() => loadPreferredAudioOutput());
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<SpeakerTestState>('idle');
  const elementsRef = useRef(new Set<HTMLMediaElement>());
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const refresh = useCallback(async () => {
    try {
      const list = await listAudioOutputDevices();
      setDevices(list);
      // Selected device was unplugged: fall back to the system default.
      if (
        list.length > 0 &&
        selectedRef.current !== DEFAULT_AUDIO_OUTPUT_ID &&
        !list.some((d) => d.deviceId === selectedRef.current)
      ) {
        setSelectedId(DEFAULT_AUDIO_OUTPUT_ID);
      }
    } catch (err) {
      console.warn('Could not list audio output devices:', err);
    }
  }, []);

  useEffect(() => {
    if (!supported) return;
    void refresh();
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    const onDeviceChange = () => void refresh();
    md?.addEventListener?.('devicechange', onDeviceChange);
    return () => md?.removeEventListener?.('devicechange', onDeviceChange);
  }, [supported, refresh]);

  useEffect(() => {
    if (!supported) return;
    void applyAudioOutputDevice(elementsRef.current, selectedId).then(({ error: err }) => {
      setError(err ? `Could not switch speaker: ${err.message}` : null);
    });
  }, [supported, selectedId]);

  const selectDevice = useCallback((deviceId: string) => {
    setSelectedId(deviceId);
    savePreferredAudioOutput(deviceId);
  }, []);

  /** Ref callback for any `<audio>`/`<video>` that plays call audio. */
  const registerElement = useCallback(
    (el: HTMLMediaElement | null) => {
      if (!el) return;
      elementsRef.current.add(el);
      if (supported) void applyAudioOutputDevice([el], selectedRef.current);
    },
    [supported],
  );

  const unregisterElement = useCallback((el: HTMLMediaElement | null) => {
    if (el) elementsRef.current.delete(el);
  }, []);

  const testSpeaker = useCallback(async () => {
    setTestState('playing');
    try {
      const audio = await playTestSpeakerSample(selectedRef.current);
      audio.addEventListener('ended', () => setTestState('idle'), { once: true });
    } catch (err) {
      setTestState('error');
      setError(`Test sound could not play: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  return {
    supported,
    devices,
    selectedId,
    selectDevice,
    error,
    testState,
    testSpeaker,
    refresh,
    registerElement,
    unregisterElement,
  };
}

export type AudioOutputControls = ReturnType<typeof useAudioOutput>;
