'use client';

import { useState, memo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Appointment, MedicalRecord } from '@/types';
import { fetchRecords, updateAppointmentStatus } from '@/services/api.service';
import { withVideoRoom } from '@/lib/video';
import NewRecordForm from './NewRecordForm';
import RecordDetailDrawer from '@/components/records/RecordDetailDrawer';
import DoctorAppointmentDrawer from '@/components/appointments/DoctorAppointmentDrawer';
import { Lock, FileText, AlertTriangle, Activity } from 'lucide-react';

interface Props {
  appointment: Appointment;
}

const STATUS_COLORS: Record<Appointment['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-green-100 text-green-700',
  completed: 'bg-green-200 text-green-800',
  cancelled: 'bg-red-100 text-red-700',
};

function AppointmentCard({ appointment: rawAppointment }: Props) {
  const appointment = withVideoRoom(rawAppointment);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [showDoctorDrawer, setShowDoctorDrawer] = useState(false);

  const intake =
    appointment.intakeSummary || appointment.intakeQuestionnaire?.previewSummary;

  const { data: patientRecords } = useQuery({
    queryKey: ['patient-records', appointment.patientAddress],
    queryFn: () => fetchRecords(appointment.patientAddress),
    enabled: expanded,
  });

  const statusMutation = useMutation({
    mutationFn: (status: Appointment['status']) => updateAppointmentStatus(appointment.id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['doctor-appointments'] }),
  });

  return (
    <div className="rounded-xl border border-border bg-surface-card shadow-card">
      <div
        className="flex items-center justify-between p-4 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <div>
          <p className="font-semibold text-text-1">
            {appointment.patientName ?? appointment.patientAddress.slice(0, 8) + '…'}
          </p>
          <p className="text-xs text-text-2">
            {new Date(appointment.datetime).toLocaleString()} · {appointment.type}
          </p>
          {intake?.chiefComplaint && (
            <p className="text-2xs text-text-3 truncate max-w-xs mt-0.5">
              Chief complaint: {intake.chiefComplaint}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {intake && (
            <span className="hidden sm:inline-flex items-center gap-1 bg-green/10 text-green text-3xs px-2 py-0.5 rounded-full font-semibold border border-green/20">
              <Lock className="w-2.5 h-2.5" /> Intake Ready
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[appointment.status]}`}
          >
            {appointment.status}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border p-4 space-y-4">
          {/* Status actions */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              {appointment.status !== 'completed' && appointment.status !== 'cancelled' && (
                <>
                  {appointment.status === 'pending' && (
                    <button
                      onClick={() => statusMutation.mutate('confirmed')}
                      disabled={statusMutation.isPending}
                      className="rounded-md bg-green px-3 py-1.5 text-xs font-medium text-[#030D09] hover:bg-green-600 disabled:opacity-50"
                    >
                      Confirm
                    </button>
                  )}
                  {appointment.status === 'confirmed' && (
                    <button
                      onClick={() => statusMutation.mutate('completed')}
                      disabled={statusMutation.isPending}
                      className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
                    >
                      Mark Complete
                    </button>
                  )}
                  <button
                    onClick={() => statusMutation.mutate('cancelled')}
                    disabled={statusMutation.isPending}
                    className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>

            {/* Quick Open Doctor Upcoming Appointment Brief */}
            <button
              onClick={() => setShowDoctorDrawer(true)}
              className="rounded-md bg-surface-inset border border-border px-3 py-1.5 text-xs font-semibold text-text-1 hover:bg-surface-hover flex items-center gap-1.5 transition-colors"
            >
              <FileText className="w-3.5 h-3.5 text-green" />
              Open Consultation Brief
            </button>
          </div>

          {/* Formatted Medical Intake Summary */}
          {intake ? (
            <div className="rounded-lg bg-surface-inset border border-border p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-text-1 flex items-center gap-1.5 text-2xs uppercase tracking-wide">
                  <Activity className="w-3.5 h-3.5 text-green" />
                  Pre-Consultation Intake Summary
                </span>
                <span className="text-3xs text-text-3 font-mono flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5 text-green" /> E2E Encrypted
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-2xs">
                <div>
                  <span className="text-text-3 font-semibold">Chief Complaint:</span>
                  <p className="font-medium text-text-1 mt-0.5">{intake.chiefComplaint || '—'}</p>
                </div>
                <div>
                  <span className="text-text-3 font-semibold">Symptom Onset:</span>
                  <p className="font-medium text-text-1 mt-0.5">{intake.symptomOnset || '—'}</p>
                </div>
              </div>

              {intake.symptoms && intake.symptoms.length > 0 && (
                <div className="pt-1">
                  <span className="text-text-3 font-semibold text-3xs block mb-1">Reported Symptoms:</span>
                  <div className="flex flex-wrap gap-1">
                    {intake.symptoms.map((s, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded bg-green/10 text-slate-800 text-3xs font-medium border border-green/20"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {intake.allergies && intake.allergies.length > 0 && (
                <div className="pt-1 border-t border-border flex items-center gap-2">
                  <span className="text-red-600 font-semibold text-3xs flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-red-600" />
                    Allergies:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {intake.allergies.map((a, idx) => (
                      <span key={idx} className="px-1.5 py-0.2 rounded bg-red-50 text-red-700 text-3xs font-medium">
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-2xs text-text-3 italic">
              Intake questionnaire answers are encrypted in appointment metadata.
            </p>
          )}

          {/* Patient medical history */}
          <div>
            <p className="text-xs font-medium text-text-2 mb-2">Patient History</p>
            {!patientRecords && <p className="text-xs text-text-3">Loading…</p>}
            {patientRecords?.length === 0 && (
              <p className="text-xs text-text-3">No records found.</p>
            )}
            {patientRecords && patientRecords.length > 0 && (
              <ul className="space-y-1">
                {patientRecords.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => setSelectedRecord(r)}
                      className="text-xs text-green hover:underline"
                    >
                      {new Date(r.date).toLocaleDateString()} — {r.diagnosis}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* New record form */}
          <div>
            <button
              onClick={() => setShowRecordForm((v) => !v)}
              className="text-xs font-medium text-green hover:underline"
            >
              {showRecordForm ? 'Hide form' : '+ Add Medical Record'}
            </button>
            {showRecordForm && (
              <div className="mt-3">
                <NewRecordForm
                  patientAddress={appointment.patientAddress}
                  patientAllergies={intake?.allergies || []}
                  onSuccess={() => setShowRecordForm(false)}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {selectedRecord && (
        <RecordDetailDrawer record={selectedRecord} onClose={() => setSelectedRecord(null)} />
      )}

      {/* Doctor Upcoming Appointment Drawer */}
      {showDoctorDrawer && (
        <DoctorAppointmentDrawer
          appointment={appointment}
          onClose={() => setShowDoctorDrawer(false)}
        />
      )}
    </div>
  );
}

export default memo(AppointmentCard);

