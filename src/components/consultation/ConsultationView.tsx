'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import PictureInPictureVideo from './PictureInPictureVideo';
import MedicalRecordPanel from './MedicalRecordPanel';
import EncounterNotes from './EncounterNotes';
import ScreenShare from './ScreenShare';
import AnnotationCanvas from './AnnotationCanvas';

interface Props {
  appointmentId: string;
  patientAddress: string;
  videoRoomUrl: string;
  doctorName: string;
}

type Tab = 'records' | 'notes';

const MIN_RATIO = 0.25;
const MAX_RATIO = 0.75;

export default function ConsultationView({
  appointmentId,
  patientAddress,
  videoRoomUrl,
  doctorName,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const isDragging = useRef(false);

  const [splitRatio, setSplitRatio] = useState(0.5);
  const [isVideoMinimized, setIsVideoMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('records');
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [canvasDimensions, setCanvasDimensions] = useState({
    width: 800,
    height: 450,
  });

  useEffect(() => {
    if (screenVideoRef.current && screenStream) {
      screenVideoRef.current.srcObject = screenStream;
    }
  }, [screenStream]);

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

  function handleScreenStart(stream: MediaStream) {
    setScreenStream(stream);
  }

  function handleScreenStop() {
    setScreenStream(null);
    setIsAnnotating(false);
  }

  function handleSaveSnapshot(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotation-${appointmentId}-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const leftWidth = isVideoMinimized
    ? '0%'
    : `${splitRatio * 100}%`;
  const rightWidth = isVideoMinimized
    ? '100%'
    : `${(1 - splitRatio) * 100}%`;

  return (
    <div className="flex flex-col h-screen">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface-card shrink-0">
        <h2 className="text-sm font-semibold text-text-1 mr-auto">
          Consultation &middot; Dr. {doctorName}
        </h2>
        <button
          onClick={() => setIsVideoMinimized((v) => !v)}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-1 hover:bg-surface-hover"
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
      </div>

      {/* Split panels */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* Left: Video / Screen Share */}
        {!isVideoMinimized && (
          <>
            <div
              className="overflow-hidden relative"
              style={{ width: leftWidth }}
            >
              {screenStream ? (
                <div className="relative w-full h-full">
                  <video
                    ref={screenVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain bg-black"
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
            </div>

            <div
              onMouseDown={handleDividerDown}
              className="w-1.5 cursor-col-resize bg-border hover:bg-green transition-colors shrink-0"
            />
          </>
        )}

        {/* Right: Records / Notes */}
        <div
          className="flex flex-col overflow-hidden"
          style={{ width: rightWidth }}
        >
          <div className="flex border-b border-border shrink-0">
            {(['records', 'notes'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-xs font-medium transition-colors ${
                  activeTab === tab
                    ? 'text-text-1 border-b-2 border-green'
                    : 'text-text-3 hover:text-text-1'
                }`}
              >
                {tab === 'records' ? 'Medical Records' : 'Encounter Notes'}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {activeTab === 'records' && (
              <MedicalRecordPanel patientAddress={patientAddress} />
            )}
            {activeTab === 'notes' && (
              <EncounterNotes appointmentId={appointmentId} />
            )}
          </div>
        </div>
      </div>

      {/* Floating mini-player */}
      {isVideoMinimized && (
        <PictureInPictureVideo
          src={videoRoomUrl}
          isMinimized
          onToggleMinimize={() => setIsVideoMinimized(false)}
        />
      )}
    </div>
  );
}
