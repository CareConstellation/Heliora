'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { CheckCircle2, Mic, PhoneOff } from 'lucide-react';
import PictureInPictureVideo from './PictureInPictureVideo';
import MedicalRecordPanel from './MedicalRecordPanel';
import EncounterNotes from './EncounterNotes';
import ScreenShare from './ScreenShare';
import AnnotationCanvas from './AnnotationCanvas';
import EncryptedChat from './EncryptedChat';
import ReconnectionOverlay from './ReconnectionOverlay';
import LiveSubtitles from './LiveSubtitles';
import TranscriptionConsentModal from './TranscriptionConsentModal';
import ConsultationToolbar from './ConsultationToolbar';
import VideoSettingsModal, { describeBackgroundEffect } from './VideoSettingsModal';
import RemoteAudio from './RemoteAudio';
import FeedbackNotice from './FeedbackNotice';
import EmergencyDispatchModal from './EmergencyDispatchModal';
import { setupAutomatedReconnection, type ReconnectionManager } from '@/lib/video';
import {
  getSpeechRecognitionConstructor,
  summarizeClinicalEncounter,
  type ISpeechRecognition,
  type ISpeechRecognitionEvent,
} from '@/lib/transcription';
import { useConsultationMedia } from '@/hooks/useConsultationMedia';
import { useAudioOutput, useFeedbackSuppression } from '@/hooks/useCallAudio';
import { useAuthStore } from '@/store/authStore';
import type {
  TranscriptSegment,
  TranscriptionConsentState,
  ReconnectionStatus,
  ClinicalDraftNote,
} from '@/types';
import { Mic, PhoneOff, CheckCircle2, Siren } from 'lucide-react';

interface Props {
  appointmentId: string;
  patientAddress: string;
  videoRoomUrl: string;
  doctorName: string;
  /**
   * Local camera/microphone stream. When provided, audio runs through the
   * noise cancellation graph (#256) and video through background effects (#255).
   */
  localStream?: MediaStream | null;
  /** Call peer connection. When provided, adaptive bitrate control runs (#254). */
  peerConnection?: RTCPeerConnection | null;
}

type Tab = 'records' | 'notes' | 'chat' | 'vitals';

const MIN_RATIO = 0.25;
const MAX_RATIO = 0.75;

export default function ConsultationView({
  appointmentId,
  patientAddress,
  videoRoomUrl,
  doctorName,
  localStream = null,
  peerConnection = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const isDragging = useRef(false);
  const callStartedAtRef = useRef<number | null>(null);

  // Start the visit clock once the consultation is on screen (#271).
  useEffect(() => {
    callStartedAtRef.current = Date.now();
  }, []);

  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isVideoMinimized, setIsVideoMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('records');
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [canvasDimensions, setCanvasDimensions] = useState({
    width: 800,
    height: 450,
  });

  /* ── Media processing: ABR (#254), backdrops (#255), noise cancel (#256) ── */
  const media = useConsultationMedia({ localStream, peerConnection });
  const [showVideoSettings, setShowVideoSettings] = useState(false);
  const outgoingStream = media.outgoingStream;

  /* ── Speaker selection (#267) & acoustic feedback ducking (#269) ── */
  const audioOutput = useAudioOutput();
  const localMicTrack = localStream?.getAudioTracks()[0] ?? null;
  const feedback = useFeedbackSuppression(localMicTrack);

  /* ── In-call emergency dispatch (#268) ─────────────────────────── */
  const walletAddress = useAuthStore((state) => state.walletAddress);
  const userRole = useAuthStore((state) => state.role);
  const [showEmergency, setShowEmergency] = useState(false);

  /* ── Automated Reconnection & State Recovery (#66) ────────────────── */
  const [reconnectionStatus, setReconnectionStatus] = useState<ReconnectionStatus>({
    state: 'connected',
    remainingSeconds: 30,
    attemptCount: 0,
  });
  const reconnectionManagerRef = useRef<ReconnectionManager | null>(null);
  const [isAudioOnly, setIsAudioOnly] = useState(false);
  const [isPiPAvailable, setIsPiPAvailable] = useState(false);
  const [isNativePiPActive, setIsNativePiPActive] = useState(false);

  useEffect(() => {
    const manager = setupAutomatedReconnection({
      peerConnection,
      timeoutMs: 30_000,
      onStatusChange: (status) => {
        setReconnectionStatus(status);
      },
      onReconnected: () => {
        setReconnectionStatus({
          state: 'connected',
          remainingSeconds: 30,
          attemptCount: 0,
          message: 'Connection restored successfully.',
        });
      },
      onTimeout: () => {
        console.warn('Consultation reconnection timed out after 30 seconds.');
      },
      getLocalMediaStream: () => outgoingStream ?? screenStream,
    });

    reconnectionManagerRef.current = manager;
    return () => {
      manager.cleanup();
    };
  }, [screenStream, outgoingStream, peerConnection]);

  /* ── Audio Transcription & Mutual Consent (#64) ──────────────────── */
  const [consentState, setConsentState] = useState<TranscriptionConsentState>({
    doctorConsented: false,
    patientConsented: false,
    isMutualConsent: false,
  });
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);
  const [activeSegment, setActiveSegment] = useState<TranscriptSegment | null>(null);
  const [draftNote, setDraftNote] = useState<ClinicalDraftNote | null>(null);
  const [isCallEnded, setIsCallEnded] = useState(false);

  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  // Sync mutual consent across browser tabs / windows
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const channel = new BroadcastChannel(`heliora-transcription-${appointmentId}`);
      channel.onmessage = (evt) => {
        const data = evt.data as { type: string; role?: 'DOCTOR' | 'PATIENT' };
        if (data.type === 'CONSENT_GRANTED' && data.role) {
          setConsentState((prev) => {
            const next = {
              ...prev,
              doctorConsented: data.role === 'DOCTOR' ? true : prev.doctorConsented,
              patientConsented: data.role === 'PATIENT' ? true : prev.patientConsented,
            };
            next.isMutualConsent = next.doctorConsented && next.patientConsented;
            return next;
          });
        }
      };
      broadcastChannelRef.current = channel;

      return () => {
        channel.close();
      };
    } catch (err) {
      console.warn('BroadcastChannel error:', err);
    }
  }, [appointmentId]);

  const handleGrantConsent = useCallback(
    (role: 'DOCTOR' | 'PATIENT') => {
      setConsentState((prev) => {
        const next = {
          ...prev,
          doctorConsented: role === 'DOCTOR' ? true : prev.doctorConsented,
          patientConsented: role === 'PATIENT' ? true : prev.patientConsented,
        };
        next.isMutualConsent = next.doctorConsented && next.patientConsented;
        if (next.isMutualConsent) {
          setIsTranscribing(true);
          setShowConsentModal(false);
        }
        return next;
      });

      try {
        broadcastChannelRef.current?.postMessage({
          type: 'CONSENT_GRANTED',
          role,
        });
      } catch (err) {
        console.warn('Failed to broadcast consent:', err);
      }
    },
    [],
  );

  // Web Speech API Continuous Transcription Controller
  useEffect(() => {
    if (!consentState.isMutualConsent || !isTranscribing) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
        recognitionRef.current = null;
      }
      return;
    }

    const SpeechConstructor = getSpeechRecognitionConstructor();
    if (!SpeechConstructor) {
      console.warn('Web Speech API is not supported in this browser environment.');
      return;
    }

    try {
      const recognition = new SpeechConstructor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: ISpeechRecognitionEvent) => {
        let interimText = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results.item(i);
          const transcriptText = item.item(0).transcript;
          if (item.isFinal) {
            finalText += transcriptText;
          } else {
            interimText += transcriptText;
          }
        }

        if (finalText.trim()) {
          const segment: TranscriptSegment = {
            id: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            speaker: 'doctor',
            text: finalText.trim(),
            isFinal: true,
            timestamp: Date.now(),
          };
          setTranscripts((prev) => [...prev, segment]);
          setActiveSegment(segment);
        } else if (interimText.trim()) {
          setActiveSegment({
            id: 'interim',
            speaker: 'doctor',
            text: interimText.trim(),
            isFinal: false,
            timestamp: Date.now(),
          });
        }
      };

      recognition.onerror = (e) => {
        if (e.error !== 'no-speech') {
          console.warn('Speech recognition notification:', e.error);
        }
      };

      recognition.onend = () => {
        // Automatically restart speech recognition while call is active and mutually consented
        if (isTranscribing && consentState.isMutualConsent && recognitionRef.current) {
          try {
            recognition.start();
          } catch {}
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.warn('Speech recognition start failed:', err);
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
        recognitionRef.current = null;
      }
    };
  }, [consentState.isMutualConsent, isTranscribing]);

  // End consultation trigger: finalizes transcription and summarizes notes
  const handleEndConsultation = useCallback(() => {
    setIsTranscribing(false);
    setIsCallEnded(true);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    // Always produce structured draft notes when call concludes
    const note = summarizeClinicalEncounter(
      appointmentId,
      patientAddress,
      transcripts,
      doctorName,
    );
    setDraftNote(note);
    setActiveTab('notes');

    onCallEnded?.({
      durationMs: callStartedAtRef.current === null ? 0 : Date.now() - callStartedAtRef.current,
      draft: note,
    });
  }, [appointmentId, patientAddress, transcripts, doctorName, onCallEnded]);

  /* ── Existing Screen Share & Divider Logic ───────────────────────── */
  const handleScreenVideoElement = useCallback((_tileId: string, element: HTMLVideoElement | null) => {
    screenVideoRef.current = element;
  }, []);

  const handleDividerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
  }, []);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setSplitRatio(
        Math.max(
          MIN_RATIO,
          Math.min(MAX_RATIO, (e.clientX - rect.left) / rect.width),
        ),
      );
    }
    function onMouseUp() {
      isDragging.current = false;
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width } = entry.contentRect;
      const w = Math.round(width * splitRatio);
      setCanvasDimensions({ width: w, height: Math.round((w * 9) / 16) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [splitRatio]);

  /* ── Native Picture-in-Picture for the shared screen (#265) ───────── */
  useEffect(() => {
    setIsPiPAvailable(isPictureInPictureAvailable(document));
  }, []);

  useEffect(() => {
    const video = screenVideoRef.current;
    if (!video || !screenStream) return;

    const onEnter = () => setIsNativePiPActive(true);
    const onLeave = () => setIsNativePiPActive(false);
    video.addEventListener('enterpictureinpicture', onEnter);
    video.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter);
      video.removeEventListener('leavepictureinpicture', onLeave);
      // The element may be gone, so the browser may not fire leavepictureinpicture.
      setIsNativePiPActive(false);
    };
  }, [screenStream, isVideoMinimized]);

  async function handleTogglePiP() {
    const video = screenVideoRef.current;
    if (!video) return;

    try {
      setIsNativePiPActive(await toggleVideoPictureInPicture(video, document));
    } catch (err) {
      console.warn('Picture-in-Picture request failed:', err);
      setIsNativePiPActive(false);
    }
  }

  function handleScreenStart(stream: MediaStream) {
    setScreenStream(stream);
  }

  function handleScreenStop() {
    setScreenStream(null);
    setIsAnnotating(false);
  }

  // One AES-GCM key per consultation, held in memory only.
  useEffect(() => {
    let cancelled = false;
    createEncounterKey()
      .then((key) => {
        if (!cancelled) setEncounterKey(key);
      })
      .catch((err) => console.warn('Encounter key could not be created:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  // Capture notices reach other open views of this consultation.
  useEffect(() => {
    const channel = createSnapshotChannel(appointmentId, () => {
      setCaptureNotice('A snapshot of this consultation was captured.');
    });
    snapshotChannelRef.current = channel;
    return () => {
      channel.close();
      snapshotChannelRef.current = null;
    };
  }, [appointmentId]);

  const handleSnapshotCaptured = useCallback((record: EncryptedSnapshotRecord) => {
    setSnapshots((prev) => [...prev, record]);
    snapshotChannelRef.current?.announce(record.capturedAt);
    playCaptureChime();
    setCaptureNotice('Snapshot captured. A capture notice was shared with this consultation.');
  }, []);

  const dismissCaptureNotice = useCallback(() => setCaptureNotice(null), []);

  const getSnapshotSource = useCallback(() => screenVideoRef.current, []);

  function handleSaveSnapshot(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotation-${appointmentId}-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const leftWidth = isVideoMinimized ? '0%' : `${splitRatio * 100}%`;
  const rightWidth = isVideoMinimized ? '100%' : `${(1 - splitRatio) * 100}%`;

  return (
    <div className="relative flex flex-col h-screen bg-surface-card">
      {/* Consultation Toolbar */}
      <div className="flex items-center gap-2.5 px-4 py-2 border-b border-border bg-surface-card shrink-0">
        <h2 className="text-sm font-semibold text-text-1 mr-auto flex items-center gap-2">
          <span>Consultation &middot; Dr. {doctorName}</span>
          {draftNote && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-3xs font-semibold bg-green/10 text-green border border-green/20">
              <CheckCircle2 className="w-2.5 h-2.5" /> Note Draft Ready
            </span>
          )}
        </h2>

        {/* Call Transcription Trigger Button */}
        <button
          type="button"
          onClick={() => {
            if (!consentState.isMutualConsent) {
              setShowConsentModal(true);
            } else {
              setIsTranscribing((v) => !v);
            }
          }}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            isTranscribing
              ? 'bg-red-500/10 text-red-600 border border-red-500/30'
              : consentState.isMutualConsent
                ? 'bg-surface-inset border border-border text-text-1 hover:bg-surface-hover'
                : 'border border-border text-text-2 hover:bg-surface-hover hover:text-text-1'
          }`}
        >
          {isTranscribing ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              <span>Transcribing</span>
            </>
          ) : (
            <>
              <Mic className="w-3.5 h-3.5 text-green" />
              <span>{consentState.isMutualConsent ? 'Resume Transcribing' : 'Transcription'}</span>
            </>
          )}
        </button>

        <ConsultationToolbar
          noiseCancellationEnabled={media.noiseCancellationEnabled}
          noiseCancellationAvailable={media.noiseCancellationAvailable}
          onToggleNoiseCancellation={media.toggleNoiseCancellation}
          onOpenVideoSettings={() => setShowVideoSettings(true)}
          backgroundEffectLabel={describeBackgroundEffect(media.backgroundSettings)}
          connectionSample={media.connectionSample}
        />

        {/* Video Controls */}
        <button
          type="button"
          onClick={() => setIsVideoMinimized((v) => !v)}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-1 hover:bg-surface-hover transition-colors"
        >
          {isVideoMinimized ? 'Show Video' : 'Picture-in-Picture'}
        </button>

        <ScreenShare
          isSharing={!!screenStream}
          onStreamStart={handleScreenStart}
          onStreamStop={handleScreenStop}
        />

        {screenStream && (
          <button
            type="button"
            onClick={() => setIsAnnotating((v) => !v)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              isAnnotating
                ? 'bg-yellow-500 text-black'
                : 'border border-border text-text-1 hover:bg-surface-hover'
            }`}
          >
            {isAnnotating ? 'Annotating' : 'Annotate'}
          </button>
        )}

        {screenStream && (
          <button
            type="button"
            onClick={() => setShowSnapshot(true)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-1 hover:bg-surface-hover transition-colors"
          >
            Snapshot
          </button>
        )}

        {/* End Consultation Button */}
        <button
          type="button"
          onClick={handleEndConsultation}
          disabled={isCallEnded}
          className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors shadow-sm ml-1"
        >
          <PhoneOff className="w-3.5 h-3.5" />
          <span>{isCallEnded ? 'Call Concluded' : 'End Call'}</span>
        </button>
      </div>

      {/* Split Panels */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* Left: Video / Screen Share with Reconnection & Subtitle Overlays */}
        {!isVideoMinimized && (
          <>
            <div
              className="overflow-hidden relative bg-black"
              style={{ width: leftWidth }}
            >
              {screenStream ? (
                <div className="relative w-full h-full">
                  <VideoGrid
                    tiles={[{ id: 'screen', label: 'Shared screen', stream: screenStream, muted: true }]}
                    onVideoElement={handleScreenVideoElement}
                  />
                  {isAnnotating && (
                    <AnnotationCanvas
                      width={canvasDimensions.width}
                      height={canvasDimensions.height}
                      videoRef={screenVideoRef}
                      onSaveSnapshot={handleSaveSnapshot}
                    />
                  )}
                </div>
              ) : (
                <PictureInPictureVideo
                  src={videoRoomUrl}
                  isMinimized={false}
                  onToggleMinimize={() => setIsVideoMinimized(true)}
                />
              )}

              {/* Acoustic feedback notice; playback ducked by 20 dB (#269) */}
              {feedback.ducked && (
                <FeedbackNotice frequencyHz={feedback.frequencyHz} onDismiss={feedback.dismiss} />
              )}

              {/* Real-time Subtitles Across Lower Third of Video (#64) */}
              <LiveSubtitles
                activeSegment={activeSegment}
                history={transcripts}
                isTranscribing={isTranscribing}
              />

              {/* Audio-only mode keeps the call's audio running behind this card (#270) */}
              {isAudioOnly && !screenStream && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-surface-card p-6 text-center">
                  <Mic className="w-6 h-6 text-green" />
                  <p className="text-sm font-semibold text-text-1">Audio-only mode</p>
                  <p className="text-xs text-text-3 max-w-xs">
                    The call continues with sound. Turn off your camera in the call controls to stop
                    sending video.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsAudioOnly(false)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-1 hover:bg-surface-hover transition-colors"
                  >
                    Show video
                  </button>
                </div>
              )}

              {/* Automated Reconnection Overlay with 30s countdown (#66, #270) */}
              <ReconnectionOverlay
                status={reconnectionStatus}
                onRetry={() => reconnectionManagerRef.current?.retry()}
                onSwitchToAudioOnly={() => {
                  setIsAudioOnly(true);
                  setReconnectionStatus((prev) => ({ ...prev, state: 'connected' }));
                }}
                onDismiss={() => {
                  setReconnectionStatus((prev) => ({ ...prev, state: 'connected' }));
                }}
              />
            </div>

            <div
              onMouseDown={handleDividerDown}
              className="w-1.5 cursor-col-resize bg-border hover:bg-green transition-colors shrink-0"
            />
          </>
        )}

        {/* Right: Records / Encounter Notes */}
        <div
          className="flex flex-col overflow-hidden"
          style={{ width: rightWidth }}
        >
          <div className="flex border-b border-border shrink-0">
            {(['records', 'notes', 'chat', 'vitals'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-xs font-medium transition-colors ${
                  activeTab === tab
                    ? 'text-text-1 border-b-2 border-green'
                    : 'text-text-3 hover:text-text-1'
                }`}
              >
                {tab === 'records'
                  ? 'Medical Records'
                  : tab === 'notes'
                    ? 'Encounter Notes'
                    : tab === 'chat'
                      ? 'Secure Chat'
                      : 'Vitals'}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-hidden">
            {activeTab === 'records' && (
              <MedicalRecordPanel patientAddress={patientAddress} />
            )}
            {activeTab === 'notes' && (
              <EncounterNotes
                appointmentId={appointmentId}
                initialDraftContent={draftNote?.notes}
              />
            )}
            {activeTab === 'chat' && <EncryptedChat appointmentId={appointmentId} />}
            {activeTab === 'vitals' && <VitalsPanel />}
          </div>
        </div>
      </div>

      {/* Floating mini-player when minimized */}
      {isVideoMinimized && (
        <div className="relative">
          <PictureInPictureVideo
            src={videoRoomUrl}
            isMinimized
            onToggleMinimize={() => setIsVideoMinimized(false)}
          />
          <LiveSubtitles
            activeSegment={activeSegment}
            history={transcripts}
            isTranscribing={isTranscribing}
          />
        </div>
      )}

      {/* Background blur / clinical backdrop settings (#255) */}
      {showVideoSettings && (
        <VideoSettingsModal
          settings={media.backgroundSettings}
          onChange={media.setBackgroundSettings}
          onClose={() => setShowVideoSettings(false)}
          previewStream={media.previewStream}
          stats={media.backgroundStats}
          audioOutput={audioOutput}
        />
      )}

      {/* Remote participant audio: routed to the chosen speaker, ducked on feedback */}
      <RemoteAudio
        peerConnection={peerConnection}
        gain={feedback.gain}
        registerElement={audioOutput.registerElement}
        unregisterElement={audioOutput.unregisterElement}
      />

      {showEmergency && (
        <EmergencyDispatchModal
          appointmentId={appointmentId}
          patientAddress={patientAddress}
          initiatorAddress={walletAddress}
          initiatorRole={userRole === 'PATIENT' ? 'PATIENT' : 'DOCTOR'}
          onClose={() => setShowEmergency(false)}
        />
      )}

      {/* Mutual Consent Modal (#64) */}
      {showConsentModal && (
        <TranscriptionConsentModal
          consentState={consentState}
          userRole="DOCTOR"
          onGrantConsent={handleGrantConsent}
          onCancel={() => setShowConsentModal(false)}
        />
      )}
    </div>
  );
}
