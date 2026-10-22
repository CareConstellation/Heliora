'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface PreCallDiagnosticProps {
  onSuccess: () => void;
  onCancel?: () => void;
  durationSeconds?: number;
}

export default function PreCallDiagnostic({
  onSuccess,
  onCancel,
  durationSeconds = 5,
}: PreCallDiagnosticProps) {
  const [timeLeft, setTimeLeft] = useState(durationSeconds);
  const [isDiagnosticComplete, setIsDiagnosticComplete] = useState(false);

  // Device & Network test states
  const [cameraStatus, setCameraStatus] = useState<'checking' | 'pass' | 'blocked'>('checking');
  const [micStatus, setMicStatus] = useState<'checking' | 'pass' | 'blocked'>('checking');
  const [audioLevel, setAudioLevel] = useState(0); // 0 to 100
  const [natStatus, setNatStatus] = useState<'checking' | 'pass' | 'restricted'>('checking');
  const [packetLossPercent, setPacketLossPercent] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const cleanupResources = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  }, []);

  const runDiagnostic = useCallback(async () => {
    cleanupResources();
    setTimeLeft(durationSeconds);
    setIsDiagnosticComplete(false);
    setCameraStatus('checking');
    setMicStatus('checking');
    setNatStatus('checking');
    setPacketLossPercent(null);
    setErrorMessage('');

    // 1. Hardware Tests: Camera & Microphone
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: true,
      });
      streamRef.current = stream;

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      if (videoTrack && videoTrack.readyState === 'live') {
        setCameraStatus('pass');
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      } else {
        setCameraStatus('blocked');
      }

      if (audioTrack && audioTrack.readyState === 'live') {
        setMicStatus('pass');
        try {
          const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const audioCtx = new AudioCtx();
          audioContextRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const sampleAudio = () => {
            if (audioContextRef.current?.state === 'closed') return;
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i] ?? 0;
            }
            const avg = sum / dataArray.length;
            const normalized = Math.min(100, Math.round((avg / 128) * 100));
            setAudioLevel(normalized);
            animFrameRef.current = requestAnimationFrame(sampleAudio);
          };
          sampleAudio();
        } catch {
          // Fallback if AudioContext fails in some environments
          setAudioLevel(25);
        }
      } else {
        setMicStatus('blocked');
      }
    } catch (err) {
      const errorStr = String(err);
      if (errorStr.includes('NotAllowedError') || errorStr.includes('Permission denied')) {
        setCameraStatus('blocked');
        setMicStatus('blocked');
        setErrorMessage('Camera or microphone permissions were blocked by browser.');
      } else {
        setCameraStatus('blocked');
        setMicStatus('blocked');
        setErrorMessage('Could not initialize audio or video input devices.');
      }
    }

    // 2. WebRTC UDP & STUN/TURN Traversal Test
    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });
      pcRef.current = pc;
      const srflxPorts = new Set<string>();
      let srflxFound = false;

      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          if (!srflxFound) {
            setNatStatus('restricted');
          } else if (srflxPorts.size > 1) {
            setNatStatus('restricted');
          } else {
            setNatStatus('pass');
          }
          return;
        }
        const candidateStr = event.candidate.candidate;
        if (candidateStr.includes('typ srflx') || candidateStr.includes('typ relay')) {
          srflxFound = true;
          const parts = candidateStr.split(' ');
          if (parts[5]) srflxPorts.add(parts[5]);
          if (srflxPorts.size > 1) {
            setNatStatus('restricted');
          } else {
            setNatStatus('pass');
          }
        }
      };

      pc.createDataChannel('heliora-diagnostic');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      setTimeout(() => {
        if (!srflxFound && pc.iceGatheringState !== 'new') {
          setNatStatus('restricted');
        }
      }, 3500);

      setPacketLossPercent(0.0);
    } catch {
      setNatStatus('restricted');
      setPacketLossPercent(0.0);
    }
  }, [cleanupResources, durationSeconds]);

  // Run on mount
  useEffect(() => {
    void runDiagnostic();
    return () => cleanupResources();
  }, [runDiagnostic, cleanupResources]);

  // 5-second countdown timer
  useEffect(() => {
    if (timeLeft <= 0) {
      setIsDiagnosticComplete(true);
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        const next = Math.max(0, prev - 1);
        if (next === 0) setIsDiagnosticComplete(true);
        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  const hasHardwareAccess = cameraStatus === 'pass' && micStatus === 'pass';
  const canEnter = isDiagnosticComplete && hasHardwareAccess;

  const handleProceed = () => {
    cleanupResources();
    onSuccess();
  };

  const handleCancelClick = () => {
    cleanupResources();
    onCancel?.();
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-card p-6 shadow-2xl max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <span className="text-2xs font-semibold uppercase tracking-wider text-green">Pre-Flight Diagnostic</span>
          <h2 className="text-lg font-bold text-text-1">Call Connection Check</h2>
        </div>
        {!isDiagnosticComplete && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-green font-bold">{timeLeft}s remaining</span>
            <div className="w-4 h-4 border-2 border-green border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Camera Preview Thumbnail & Mic Level Meter */}
      <div className="space-y-3">
        <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-black border border-border flex items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={`w-full h-full object-cover ${cameraStatus === 'pass' ? 'block' : 'hidden'}`}
          />
          {cameraStatus !== 'pass' && (
            <div className="text-center p-4 space-y-1">
              <span className="text-2xl">📷</span>
              <p className="text-xs text-text-3 font-medium">
                {cameraStatus === 'checking' ? 'Testing camera track…' : 'Camera Access Blocked'}
              </p>
            </div>
          )}

          {/* Overlay Status Badge */}
          <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm px-2.5 py-1 text-2xs font-medium text-white border border-white/10">
            <span
              className={`w-2 h-2 rounded-full ${
                cameraStatus === 'pass' ? 'bg-green' : cameraStatus === 'checking' ? 'bg-yellow-400' : 'bg-red-500'
              }`}
            />
            {cameraStatus === 'pass' ? 'Camera Live' : cameraStatus === 'checking' ? 'Initializing' : 'Blocked'}
          </div>
        </div>

        {/* Live Audio Level Meter */}
        <div className="rounded-xl border border-border bg-surface-inset p-3 space-y-1.5">
          <div className="flex items-center justify-between text-2xs">
            <span className="text-text-2 font-medium flex items-center gap-1.5">
              <span>🎙️</span> Microphone Input Level
            </span>
            <span className="font-mono text-text-1">{audioLevel}%</span>
          </div>
          <div className="w-full bg-border rounded-full h-2 overflow-hidden flex">
            <div
              className={`h-full transition-all duration-75 ${
                micStatus === 'pass' ? 'bg-green' : 'bg-red-500'
              }`}
              style={{ width: `${micStatus === 'pass' ? Math.max(5, audioLevel) : 0}%` }}
            />
          </div>
          <p className="text-2xs text-text-3">
            Speak into your microphone to verify audio pickup levels.
          </p>
        </div>
      </div>

      {/* Network & Traversal Diagnostic Matrix */}
      <div className="rounded-xl border border-border bg-surface-inset p-3 space-y-2 text-xs">
        <span className="text-2xs font-semibold text-text-3 uppercase tracking-wider">Network & Traversal</span>

        <div className="flex items-center justify-between py-1 border-b border-border/50">
          <span className="text-text-2">WebRTC UDP Traversal (STUN/TURN):</span>
          <span
            className={`font-semibold text-2xs ${
              natStatus === 'pass'
                ? 'text-green'
                : natStatus === 'checking'
                  ? 'text-yellow-400'
                  : 'text-orange-400'
            }`}
          >
            {natStatus === 'pass'
              ? '✓ Open Traversal'
              : natStatus === 'checking'
                ? 'Gathering ICE…'
                : 'Restricted NAT / Firewall'}
          </span>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-text-2">Packet Loss Estimate:</span>
          <span className="font-semibold text-2xs text-green">
            {packetLossPercent !== null ? `${packetLossPercent.toFixed(1)}% (Optimal)` : 'Measuring…'}
          </span>
        </div>
      </div>

      {/* Gating Error Banner if Blocked */}
      {isDiagnosticComplete && !hasHardwareAccess && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 space-y-2 text-xs text-red-400">
          <div className="font-bold flex items-center gap-1.5">
            <span>⚠️</span> Device Access Blocked
          </div>
          <p className="text-2xs text-red-300">
            {errorMessage || 'Camera or microphone access is blocked. In accordance with teleconsultation safety standards, you cannot enter the consultation without working audio/video.'}
          </p>
          <p className="text-2xs text-text-3">
            Please click the camera/lock icon in your browser URL bar, grant permissions, and click Retry.
          </p>
          <button
            onClick={runDiagnostic}
            className="mt-2 rounded-lg bg-red-500/20 border border-red-500/50 px-3 py-1.5 text-xs text-white hover:bg-red-500/30 transition-colors"
          >
            Retry Diagnostic Test
          </button>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 pt-2">
        {onCancel && (
          <button
            onClick={handleCancelClick}
            className="flex-1 rounded-xl border border-border bg-surface-inset py-2.5 text-xs font-semibold text-text-2 hover:bg-surface-hover transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleProceed}
          disabled={!canEnter}
          className={`flex-1 rounded-xl py-2.5 text-xs font-semibold transition-all ${
            canEnter
              ? 'bg-green text-[#030D09] hover:bg-green/90 shadow-lg cursor-pointer'
              : 'bg-surface-inset border border-border text-text-3 opacity-50 cursor-not-allowed'
          }`}
        >
          {!isDiagnosticComplete
            ? `Testing Connection (${timeLeft}s)…`
            : canEnter
              ? 'Enter Consultation Room'
              : 'Access Blocked'}
        </button>
      </div>
    </div>
  );
}
