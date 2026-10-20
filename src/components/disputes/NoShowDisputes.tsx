'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { fetchDisputeCases, requestDisputeAttestation } from '@/services/api.service';
import {
  buildResolveNoShowOperation,
  evaluateAttendance,
  verifyDisputeAttestation,
} from '@/lib/disputeOracle';
import { freighterSigner, invokeSorobanContract } from '@/lib/stellar';
import { useToast } from '@/hooks/useToast';
import type { AppointmentAttendance, AttendanceVerdict } from '@/types';

const VERDICT_BADGE: Record<AttendanceVerdict, { className: string; label: string }> = {
  PENDING: { className: 'badge-muted', label: 'In progress' },
  ATTENDED: { className: 'badge-green', label: 'Attended' },
  PATIENT_NO_SHOW: { className: 'badge-yellow', label: 'Patient no-show' },
  DOCTOR_NO_SHOW: { className: 'badge-red', label: 'Doctor no-show' },
};

const formatTime = (unixSeconds: number | null) =>
  unixSeconds === null
    ? '—'
    : new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface Props {
  hospitalAddress: string;
}

/**
 * Telemedicine attendance review. Each appointment's Daily call log is compared
 * with its scheduled window. When the doctor did not join within 15 minutes, the
 * oracle-signed attestation is verified and submitted to the arbitration
 * contract, which refunds the patient in full.
 */
export default function NoShowDisputes({ hospitalAddress }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = ['disputeCases', hospitalAddress];

  const {
    data: cases,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () => fetchDisputeCases(hospitalAddress),
    refetchInterval: 60_000, // pending verdicts settle as grace windows pass
  });

  const refund = useMutation({
    mutationFn: async (attendance: AppointmentAttendance) => {
      const evaluation = evaluateAttendance(attendance);
      if (evaluation.verdict !== 'DOCTOR_NO_SHOW') {
        throw new Error('Refunds apply only when the doctor did not join within 15 minutes.');
      }
      const signed = await requestDisputeAttestation(attendance.appointmentId);
      verifyDisputeAttestation(signed, attendance, evaluation);
      return invokeSorobanContract(
        hospitalAddress,
        buildResolveNoShowOperation(signed),
        freighterSigner,
      );
    },
    onSuccess: (txHash, attendance) => {
      queryClient.setQueryData<AppointmentAttendance[]>(queryKey, (prev) =>
        prev?.map((c) =>
          c.appointmentId === attendance.appointmentId ? { ...c, refundTxHash: txHash } : c,
        ),
      );
      toast('Patient refunded in full.', 'success');
    },
    onError: (err: Error) => toast(err.message || 'Refund failed. Please try again.', 'error'),
  });

  return (
    <div
      className="rounded-[14px] overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <h2 className="text-sm font-semibold text-text-1">Missed Consultations</h2>
        <p className="text-xs text-text-3 mt-0.5">
          Call attendance vs. scheduled time · doctors must join within 15 minutes
        </p>
      </div>

      {isLoading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-text-3" />
        </div>
      ) : isError ? (
        <div className="py-12 text-center">
          <p className="text-sm text-text-2">Could not load consultation logs.</p>
          <button
            onClick={() => refetch()}
            className="mt-2 btn-secondary rounded-[6px] text-2xs py-1 px-2.5"
          >
            Retry
          </button>
        </div>
      ) : !cases?.length ? (
        <p className="py-12 text-center text-sm text-text-2">
          No telemedicine consultations to review.
        </p>
      ) : (
        <table className="data-table w-full">
          <thead>
            <tr>
              <th>Appointment</th>
              <th className="hidden sm:table-cell">Scheduled</th>
              <th className="hidden md:table-cell">Doctor joined</th>
              <th className="hidden md:table-cell">Patient joined</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => {
              const { verdict, doctorJoinedAt, patientJoinedAt } = evaluateAttendance(c);
              const badge = VERDICT_BADGE[verdict];
              const pending =
                refund.isPending && refund.variables?.appointmentId === c.appointmentId;
              return (
                <tr key={c.appointmentId}>
                  <td className="text-xs font-mono text-text-1">{c.appointmentId}</td>
                  <td className="hidden sm:table-cell text-xs text-text-2 whitespace-nowrap">
                    {new Date(c.scheduledStart).toLocaleString()}
                  </td>
                  <td className="hidden md:table-cell text-xs text-text-2">
                    {formatTime(doctorJoinedAt)}
                  </td>
                  <td className="hidden md:table-cell text-xs text-text-2">
                    {formatTime(patientJoinedAt)}
                  </td>
                  <td>
                    <span className={badge.className}>{badge.label}</span>
                  </td>
                  <td className="text-right">
                    {c.refundTxHash ? (
                      <span className="text-2xs font-mono text-text-3" title={c.refundTxHash}>
                        Refunded · {c.refundTxHash.slice(0, 8)}…
                      </span>
                    ) : verdict === 'DOCTOR_NO_SHOW' ? (
                      <button
                        onClick={() => refund.mutate(c)}
                        disabled={refund.isPending}
                        className="btn-primary rounded-[6px] text-2xs py-1 px-2.5 inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        {pending && <Loader2 className="w-3 h-3 animate-spin" />}
                        {pending ? 'Refunding…' : 'Refund patient'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
