'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import ConsultationView from '@/components/consultation/ConsultationView';

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
    <ProtectedRoute requiredRole="DOCTOR">
      <Suspense
        fallback={<div className="animate-pulse h-screen bg-surface-card" />}
      >
        <ConsultationContent />
      </Suspense>
    </ProtectedRoute>
  );
}
