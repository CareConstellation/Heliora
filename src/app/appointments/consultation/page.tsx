'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import ProtectedRoute from '@/components/auth/ProtectedRoute';

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
  const params = useSearchParams();
  const appointmentId = params.get('id') ?? '';
  const patientAddress = params.get('patient') ?? '';
  const videoRoomUrl = params.get('videoUrl') ?? '';
  const doctorName = params.get('doctor') ?? '';

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

  return (
    <ConsultationView
      appointmentId={appointmentId}
      patientAddress={patientAddress}
      videoRoomUrl={videoRoomUrl}
      doctorName={doctorName}
    />
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
