'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAppointments, cancelAppointmentWithPenalty } from '@/services/api.service';
import { useWalletStore } from '@/store/useWalletStore';
import { isVideoLinkActive } from '@/lib/video';
import { useToast } from '@/hooks/useToast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import PreCallDiagnostic from '@/components/ui/PreCallDiagnostic';
import WaitingRoom from '@/components/appointments/WaitingRoom';
import DoctorAppointmentDrawer from '@/components/appointments/DoctorAppointmentDrawer';
import { CancellationEstimateDisplay, calculateCancellationAmounts } from './CancellationPolicy';
import type { Appointment } from '@/types';

export default function UpcomingAppointments() {
  const { publicKey } = useWalletStore();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [appointmentToCancel, setAppointmentToCancel] = useState<Appointment | null>(null);
  const [diagnosticAppt, setDiagnosticAppt] = useState<Appointment | null>(null);
  const [waitingRoomAppt, setWaitingRoomAppt] = useState<Appointment | null>(null);
  const [drawerAppt, setDrawerAppt] = useState<Appointment | null>(null);

  const { data: appointments, isLoading } = useQuery({
    queryKey: ['patient-appointments', publicKey],
    queryFn: () => fetchAppointments(publicKey!, 'patient'),
    enabled: !!publicKey,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelAppointmentWithPenalty(id, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient-appointments', publicKey] });
      toast('Appointment cancelled', 'success');
      setAppointmentToCancel(null);
    },
    onError: () => {
      toast('Failed to cancel appointment', 'error');
    },
  });

  const upcoming =
    appointments?.filter((a) => a.status !== 'cancelled' && a.status !== 'completed') ?? [];

  if (isLoading) return <div className="animate-pulse h-24 rounded-xl bg-surface-card" />;

  if (upcoming.length === 0)
    return <p className="text-sm text-text-3 text-center py-4">No upcoming appointments.</p>;

  const cancelMessage = appointmentToCancel
    ? (() => {
        const { refundAmount, forfeitAmount, tier } = calculateCancellationAmounts(
          appointmentToCancel.fee,
          appointmentToCancel.datetime,
        );
        return `Cancel appointment with Dr. ${appointmentToCancel.doctorName}?\n\n` +
          `Window: ${tier.label}\n` +
          `Refund: ${refundAmount.toFixed(2)} XLM (${tier.refundPercent}%)\n` +
          `Forfeit to doctor: ${forfeitAmount.toFixed(2)} XLM (${tier.forfeitPercent}%)`;
      })()
    : '';

  return (
    <div className="space-y-3">
      {upcoming.map((appt) => (
        <div
          key={appt.id}
          className="flex items-center justify-between rounded-xl border border-border bg-surface-card p-4"
        >
          <div>
            <p className="font-medium text-text-1">Dr. {appt.doctorName}</p>
            <p className="text-xs text-text-2">
              {new Date(appt.datetime).toLocaleString()} · {appt.type}
            </p>
            <span
              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                appt.status === 'confirmed'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}
            >
              {appt.status}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {(appt.intakeSummary || appt.intakeQuestionnaire) && (
              <button
                type="button"
                onClick={() => setDrawerAppt(appt)}
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-2 hover:bg-surface-hover hover:text-text-1 transition-colors"
              >
                Intake Brief
              </button>
            )}
            {appt.type === 'telemedicine' && isVideoLinkActive(appt) && (
              <button
                type="button"
                onClick={() => setDiagnosticAppt(appt)}
                className="rounded-md bg-green/10 border border-green/30 px-2.5 py-1 text-xs font-medium text-green hover:bg-green/20 transition-colors"
              >
                Join Video Call
              </button>
            )}
            <button
              onClick={() => setAppointmentToCancel(appt)}
              disabled={cancelMutation.isPending}
              className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ))}


      {appointmentToCancel && (
        <>
          <CancellationEstimateDisplay
            appointmentId={appointmentToCancel.id}
            fee={appointmentToCancel.fee}
          />
          <ConfirmDialog
            title="Cancel appointment"
            message={cancelMessage}
            confirmLabel="Cancel & accept penalty"
            cancelLabel="Keep appointment"
            isLoading={cancelMutation.isPending}
            onConfirm={() => cancelMutation.mutate(appointmentToCancel.id)}
            onCancel={() => setAppointmentToCancel(null)}
          />
        </>
      )}

      {/* Pre-Call Hardware & Network Diagnostic Modal */}
      {diagnosticAppt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <PreCallDiagnostic
            onSuccess={() => {
              const appt = diagnosticAppt;
              setDiagnosticAppt(null);
              setWaitingRoomAppt(appt);
            }}
            onCancel={() => setDiagnosticAppt(null)}
          />
        </div>
      )}

      {/* Dynamic Waiting Room Modal */}
      {waitingRoomAppt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <WaitingRoom
            appointmentId={waitingRoomAppt.id}
            doctorName={waitingRoomAppt.doctorName}
            videoRoomUrl={waitingRoomAppt.videoRoomUrl}
            onEnterCall={() => {
              if (waitingRoomAppt.videoRoomUrl) {
                window.open(waitingRoomAppt.videoRoomUrl, '_blank');
              }
              setWaitingRoomAppt(null);
            }}
            onClose={() => setWaitingRoomAppt(null)}
          />
        </div>
      )}

      {/* Patient Intake Brief Drawer */}
      {drawerAppt && (
        <DoctorAppointmentDrawer
          appointment={drawerAppt}
          onClose={() => setDrawerAppt(null)}
        />
      )}
    </div>
  );
}

