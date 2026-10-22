'use client';

import type { Appointment, PatientIntakeSummary } from '@/types';
import ResolvedAddress from '@/components/contacts/ResolvedAddress';
import {
  Calendar,
  Clock,
  User,
  Lock,
  AlertTriangle,
  FileText,
  Activity,
  HeartPulse,
} from 'lucide-react';

interface Props {
  appointment: Appointment;
  onClose: () => void;
}

export default function DoctorAppointmentDrawer({ appointment, onClose }: Props) {
  const intake: PatientIntakeSummary | undefined =
    appointment.intakeSummary || appointment.intakeQuestionnaire?.previewSummary;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="doctor-drawer-title"
    >
      <div
        className="h-full w-full max-w-lg bg-white shadow-2xl overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="p-6 border-b border-border bg-surface-card flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-green/10 text-green font-bold text-2xs">
                Upcoming Appointment
              </span>
              <span className="text-2xs text-text-3 font-mono">ID: {appointment.id}</span>
            </div>
            <h2 id="doctor-drawer-title" className="text-lg font-bold text-text-1 mt-1">
              Patient Consultation Brief
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close drawer"
            className="text-text-3 hover:text-text-1 text-2xl leading-none px-2 py-1"
          >
            &times;
          </button>
        </div>

        <div className="p-6 flex-1 space-y-6">
          {/* Patient Overview */}
          <div className="rounded-xl border border-border bg-surface-inset p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-2 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-text-3" />
                {appointment.patientName ? appointment.patientName : 'Patient Address'}
              </span>
              <ResolvedAddress
                address={appointment.patientAddress}
                fallback={appointment.patientAddress}
                className="text-2xs text-text-3"
              />
            </div>
            <div className="flex items-center gap-4 text-xs text-text-2 pt-1 border-t border-border">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-text-3" />
                {new Date(appointment.datetime).toLocaleDateString(undefined, { dateStyle: 'medium' })}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-text-3" />
                {new Date(appointment.datetime).toLocaleTimeString(undefined, { timeStyle: 'short' })}
              </span>
              <span className="capitalize px-2 py-0.5 rounded bg-surface-card border border-border text-2xs font-medium">
                {appointment.type}
              </span>
            </div>
          </div>

          {/* Formatted Patient Medical Intake Summary */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-text-1 flex items-center gap-2">
                <Activity className="w-4 h-4 text-green" />
                Patient Intake Questionnaire Summary
              </h3>
              <span className="inline-flex items-center gap-1 bg-green/10 text-green text-3xs px-2 py-0.5 rounded-full font-semibold border border-green/20">
                <Lock className="w-2.5 h-2.5" /> E2E Encrypted
              </span>
            </div>

            {intake ? (
              <div className="rounded-xl border border-border bg-surface-card p-4 space-y-4 shadow-sm">
                {/* Chief Complaint */}
                <div className="space-y-1">
                  <span className="text-2xs font-bold text-text-3 uppercase tracking-wider">
                    Chief Complaint
                  </span>
                  <p className="text-sm font-semibold text-text-1 bg-surface-inset p-2.5 rounded-lg border border-border">
                    {intake.chiefComplaint || 'No chief complaint provided'}
                  </p>
                </div>

                {/* Symptom Onset */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-2xs font-bold text-text-3 uppercase tracking-wider block mb-1">
                      Symptom Onset
                    </span>
                    <span className="font-medium text-text-1 bg-surface-inset px-2.5 py-1 rounded border border-border inline-block">
                      {intake.symptomOnset || 'Not specified'}
                    </span>
                  </div>
                  <div>
                    <span className="text-2xs font-bold text-text-3 uppercase tracking-wider block mb-1">
                      Intake Submission Time
                    </span>
                    <span className="text-text-2 text-2xs inline-block pt-1">
                      {appointment.intakeQuestionnaire?.timestamp
                        ? new Date(appointment.intakeQuestionnaire.timestamp).toLocaleString()
                        : 'Pre-booking verified'}
                    </span>
                  </div>
                </div>

                {/* Reported Symptoms */}
                {intake.symptoms && intake.symptoms.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-2xs font-bold text-text-3 uppercase tracking-wider">
                      Reported Symptoms ({intake.symptoms.length})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {intake.symptoms.map((symptom, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-md bg-green/10 text-slate-800 text-xs font-medium border border-green/20 flex items-center gap-1"
                        >
                          <HeartPulse className="w-3 h-3 text-green" />
                          {symptom}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Documented Allergies */}
                {intake.allergies && intake.allergies.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-border">
                    <span className="text-2xs font-bold text-red-600 uppercase tracking-wider flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-red-600" />
                      Documented Drug Allergies
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {intake.allergies.map((allergy, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-md bg-red-50 text-red-700 text-xs font-semibold border border-red-200"
                        >
                          {allergy}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Current Active Medications */}
                {intake.currentMedications && (
                  <div className="space-y-1 pt-2 border-t border-border">
                    <span className="text-2xs font-bold text-text-3 uppercase tracking-wider">
                      Active Medications & Supplements
                    </span>
                    <p className="text-xs text-text-1 font-mono bg-surface-inset p-2 rounded border border-border">
                      {intake.currentMedications}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-text-3 text-xs">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No intake questionnaire submitted for this booking.
              </div>
            )}
          </div>

          {/* Consultation Notes */}
          {appointment.notes && (
            <div className="space-y-1">
              <span className="text-2xs font-bold text-text-3 uppercase tracking-wider">
                Patient Consultation Notes
              </span>
              <p className="text-xs text-text-1 bg-surface-inset p-3 rounded-lg border border-border whitespace-pre-wrap">
                {appointment.notes}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
