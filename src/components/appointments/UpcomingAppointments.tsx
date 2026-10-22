'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchAppointments,
  cancelAppointmentWithPenalty,
  type ApiError,
} from '@/services/api.service';
import { useWalletStore } from '@/store/useWalletStore';
import { isVideoLinkActive } from '@/lib/video';
import { useToast } from '@/hooks/useToast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import PreCallDiagnostic from '@/components/ui/PreCallDiagnostic';
import WaitingRoom from '@/components/appointments/WaitingRoom';
import DoctorAppointmentDrawer from '@/components/appointments/DoctorAppointmentDrawer';
import { CancellationEstimateDisplay, calculateCancellationAmounts } from './CancellationPolicy';
import type { Appointment } from '@/types';

type AppointmentTab = 'upcoming' | 'canceled';

interface CancelMutationContext {
  previousAppointments: Appointment[] | undefined;
}

export default function UpcomingAppointments() {
  const { publicKey } = useWalletStore();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<AppointmentTab>('upcoming');
  const [appointmentToCancel, setAppointmentToCancel] = useState<Appointment | null>(null);
  const [diagnosticAppt, setDiagnosticAppt] = useState<Appointment | null>(null);
  const [waitingRoomAppt, setWaitingRoomAppt] = useState<Appointment | null>(null);
  const [drawerAppt, setDrawerAppt] = useState<Appointment | null>(null);

  const appointmentsQueryKey = ['patient-appointments', publicKey] as const;

  const { data: appointments, isLoading } = useQuery({
    queryKey: appointmentsQueryKey,
    queryFn: () => fetchAppointments(publicKey!, 'patient'),
    enabled: !!publicKey,
  });

  const cancelMutation = useMutation<Appointment, ApiError, Appointment, CancelMutationContext>({
    mutationFn: (appointment) => cancelAppointmentWithPenalty(appointment.id, true),
    onMutate: async (appointment) => {
      // Stop in-flight refetches so they cannot overwrite the optimistic update.
      await queryClient.cancelQueries({ queryKey: appointmentsQueryKey });

      // Snapshot the previous list so onError can restore it exactly.
      const previousAppointments = queryClient.getQueryData<Appointment[]>(appointmentsQueryKey);

      queryClient.setQueryData<Appointment[]>(appointmentsQueryKey, (current) =>
        current?.map((item) =>
          item.id === appointment.id ? { ...item, status: 'cancelled' as const } : item,
        ),
      );

      // Move the appointment to the Canceled tab immediately, before the request resolves.
      setAppointmentToCancel(null);
      setActiveTab('canceled');

      return { previousAppointments };
    },
    onError: (error, appointment, context) => {
      // Roll the cache back to the pre-mutation snapshot.
      if (context?.previousAppointments) {
        queryClient.setQueryData(appointmentsQueryKey, context.previousAppointments);
      } else {
        void queryClient.invalidateQueries({ queryKey: appointmentsQueryKey });
      }

      setActiveTab('upcoming');
      toast(
        `Could not cancel your appointment with Dr. ${appointment.doctorName}. Your appointment was restored. ${
          error.message || 'Please try again.'
        }`,
        'error',
        { label: 'Retry', onClick: () => cancelMutation.mutate(appointment) },
      );
    },
    onSuccess: () => {
      toast('Appointment cancelled', 'success');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentsQueryKey });
    },
  });

  const upcoming =
    appointments?.filter((a) => a.status !== 'cancelled' && a.status !== 'completed') ?? [];

  const canceled = appointments?.filter((a) => a.status === 'cancelled') ?? [];

  const visibleAppointments = activeTab === 'upcoming' ? upcoming : canceled;

  if (isLoading) return <div className="animate-pulse h-24 rounded-xl bg-surface-card" />;

  const cancelMessage = appointmentToCancel
    ? (() => {
        const { refundAmount, forfeitAmount, tier } = calculateCancellationAmounts(
          appointmentToCancel.fee,
          appointmentToCancel.datetime,
        );
        return (
          `Cancel appointment with Dr. ${appointmentToCancel.doctorName}?\n\n` +
          `Window: ${tier.label}\n` +
          `Refund: ${refundAmount.toFixed(2)} XLM (${tier.refundPercent}%)\n` +
          `Forfeit to doctor: ${forfeitAmount.toFixed(2)} XLM (${tier.forfeitPercent}%)`
        );
      })()
    : '';

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Appointments"
        className="flex gap-1 rounded-lg border border-border bg-surface-card p-1"
      >
        <button
          type="button"
          role="tab"
          id="appointments-tab-upcoming"
          aria-selected={activeTab === 'upcoming'}
          aria-controls="appointments-tabpanel"
          onClick={() => setActiveTab('upcoming')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'upcoming'
              ? 'bg-surface-hover text-text-1'
              : 'text-text-2 hover:text-text-1'
          }`}
        >
          Upcoming ({upcoming.length})
        </button>
        <button
          type="button"
          role="tab"
          id="appointments-tab-canceled"
          aria-selected={activeTab === 'canceled'}
          aria-controls="appointments-tabpanel"
          onClick={() => setActiveTab('canceled')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'canceled'
              ? 'bg-surface-hover text-text-1'
              : 'text-text-2 hover:text-text-1'
          }`}
        >
          Canceled ({canceled.length})
        </button>
      </div>

      <div
        role="tabpanel"
        id="appointments-tabpanel"
        aria-labelledby={
          activeTab === 'upcoming' ? 'appointments-tab-upcoming' : 'appointments-tab-canceled'
        }
        className="space-y-3"
      >
        {visibleAppointments.length === 0 ? (
          <p className="text-sm text-text-3 text-center py-4">
            {activeTab === 'upcoming' ? 'No upcoming appointments.' : 'No canceled appointments.'}
          </p>
        ) : (
          visibleAppointments.map((appt) => (
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
                      : appt.status === 'cancelled'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {appt.status}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {activeTab === 'upcoming' && (appt.intakeSummary || appt.intakeQuestionnaire) && (
                  <button
                    type="button"
                    onClick={() => setDrawerAppt(appt)}
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-2 hover:bg-surface-hover hover:text-text-1 transition-colors"
                  >
                    Intake Brief
                  </button>
                )}
                {activeTab === 'upcoming' &&
                  appt.type === 'telemedicine' &&
                  isVideoLinkActive(appt) && (
                    <button
                      type="button"
                      onClick={() => setDiagnosticAppt(appt)}
                      className="rounded-md bg-green/10 border border-green/30 px-2.5 py-1 text-xs font-medium text-green hover:bg-green/20 transition-colors"
                    >
                      Join Video Call
                    </button>
                  )}
                {activeTab === 'upcoming' && (
                  <button
                    onClick={() => setAppointmentToCancel(appt)}
                    disabled={cancelMutation.isPending}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

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
            onConfirm={() => cancelMutation.mutate(appointmentToCancel)}
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
        <DoctorAppointmentDrawer appointment={drawerAppt} onClose={() => setDrawerAppt(null)} />
      )}
    </div>
  );
}
