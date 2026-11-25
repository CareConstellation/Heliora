'use client';

import { Suspense, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import PreCallDiagnostic from '@/components/consultation/PreCallDiagnostic';

const ConsultationView = dynamic(
  () => import('@/components/consultation/ConsultationView'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-screen bg-surface-card">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
          <p className="text-xs text-text-3">Loading encrypted consultation suite…</p>
        </div>
      </div>
    ),
  },
);

function ConsultationContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [visitSummary, setVisitSummary] = useState<VisitSummary | null>(null);
  const appointmentId = params.get('id') ?? '';
  const patientAddress = params.get('patient') ?? '';
  const videoRoomUrl = params.get('videoUrl') ?? '';
  const doctorName = params.get('doctor') ?? '';
  const [precallDone, setPrecallDone] = useState(false);

  // Hooks stay above the early return so the call-end flow is always registered (#271).
  const handleCallEnded = useCallback(
    ({ durationMs, draft }: ConsultationEndPayload) => {
      setVisitSummary(
        buildVisitSummary({
          appointmentId,
          doctorName,
          durationMs,
          diagnosis: draft.diagnosis,
          prescriptionText: draft.prescription,
        }),
      );
    },
    [appointmentId, doctorName],
  );

  const handleCloseSummary = useCallback(() => setVisitSummary(null), []);

  const handleScheduleFollowUp = useCallback(() => {
    setVisitSummary(null);
    router.push('/appointments');
  }, [router]);

  if (!appointmentId || !patientAddress || !videoRoomUrl) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-sm text-text-3">
          Missing consultation parameters. Please access this page from an
          active appointment.
        </p>
      </div>
    );
  }

  if (!precallDone) {
    // Camera and microphone are released by the check before the call starts.
    return <PreCallDiagnostic onContinue={() => setPrecallDone(true)} />;
  }

  return (
    <>
      <ConsultationView
        appointmentId={appointmentId}
        patientAddress={patientAddress}
        videoRoomUrl={videoRoomUrl}
        doctorName={doctorName}
        onCallEnded={handleCallEnded}
      />
      {visitSummary && (
        <PostConsultationSummaryModal
          summary={visitSummary}
          onClose={handleCloseSummary}
          onScheduleFollowUp={handleScheduleFollowUp}
        />
      )}
    </>
  );
}

export default function ConsultationPage() {
  return (
    <ProtectedRoute requiredRole={['DOCTOR', 'PATIENT']}>
      <Suspense
        fallback={<div className="animate-pulse h-screen bg-surface-card" />}
      >
        <ConsultationContent />
      </Suspense>
    </ProtectedRoute>
  );
}
