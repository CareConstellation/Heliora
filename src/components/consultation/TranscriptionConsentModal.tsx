'use client';

import React from 'react';
import { Mic, ShieldCheck, CheckCircle2, Clock, X, Lock } from 'lucide-react';
import type { TranscriptionConsentState } from '@/types';

interface Props {
  consentState: TranscriptionConsentState;
  userRole?: 'DOCTOR' | 'PATIENT' | string;
  onGrantConsent: (role: 'DOCTOR' | 'PATIENT') => void;
  onCancel: () => void;
}

/**
 * Mutual opt-in consent modal for Web Speech API consultation transcription.
 * Both doctor and patient must explicitly consent prior to audio transcription.
 * (Issue #64)
 *
 * Algorithmic Complexity:
 * - Time: O(1) single-pass render.
 * - Space: O(1) constant memory.
 */
export default function TranscriptionConsentModal({
  consentState,
  userRole = 'DOCTOR',
  onGrantConsent,
  onCancel,
}: Props) {
  const currentPartyIsDoctor = userRole === 'DOCTOR';
  const hasCurrentUserConsented = currentPartyIsDoctor
    ? consentState.doctorConsented
    : consentState.patientConsented;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="transcription-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface-card p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-green/10 text-green border border-green/20">
              <Mic className="w-6 h-6" />
            </div>
            <div>
              <h3 id="transcription-modal-title" className="text-base font-bold text-text-1">
                Enable Call Transcription
              </h3>
              <p className="text-xs text-text-3 mt-0.5">
                Mutual doctor & patient consent is required by clinical privacy standards.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="text-text-3 hover:text-text-1 text-xl leading-none p-1 rounded-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Informational Guidance */}
        <div className="rounded-xl border border-border bg-surface-inset p-4 space-y-2.5 text-xs text-text-2">
          <div className="flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-green shrink-0 mt-0.5" />
            <p>
              <span className="font-semibold text-text-1">Privacy & HIPAA Safeguards:</span> Audio is processed locally in-browser via the Web Speech API. Neither raw audio nor audio recordings are stored on centralized servers.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Lock className="w-4 h-4 text-green shrink-0 mt-0.5" />
            <p>
              <span className="font-semibold text-text-1">Automated Clinical Notes:</span> Real-time subtitles stream to the consultation display and a draft encounter note will be auto-summarized for the medical record.
            </p>
          </div>
        </div>

        {/* Dual-Party Consent Audit Status */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-2xs font-bold uppercase tracking-wider text-text-3">
              Mutual Opt-In Consent Verification
            </span>
            <span className="text-3xs font-mono text-text-3">Both parties required</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Doctor Consent Status & Trigger */}
            <div
              className={`rounded-xl border p-3 flex flex-col justify-between space-y-3 ${
                consentState.doctorConsented
                  ? 'bg-green/10 border-green/30 text-green'
                  : 'bg-surface-inset border-border text-text-2'
              }`}
            >
              <div>
                <span className="text-xs font-semibold block">Doctor Consent</span>
                <span className="text-3xs text-text-3">Clinical provider authorization</span>
              </div>

              {consentState.doctorConsented ? (
                <div className="flex items-center gap-1.5 text-2xs font-medium text-green">
                  <CheckCircle2 className="w-4 h-4 text-green" />
                  <span>Consent Granted</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onGrantConsent('DOCTOR')}
                  className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-green text-[#030D09] hover:bg-green-400 transition-colors shadow-sm"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Doctor: Enable Call Transcription</span>
                </button>
              )}
            </div>

            {/* Patient Consent Status & Trigger */}
            <div
              className={`rounded-xl border p-3 flex flex-col justify-between space-y-3 ${
                consentState.patientConsented
                  ? 'bg-green/10 border-green/30 text-green'
                  : 'bg-surface-inset border-border text-text-2'
              }`}
            >
              <div>
                <span className="text-xs font-semibold block">Patient Consent</span>
                <span className="text-3xs text-text-3">Informed patient authorization</span>
              </div>

              {consentState.patientConsented ? (
                <div className="flex items-center gap-1.5 text-2xs font-medium text-green">
                  <CheckCircle2 className="w-4 h-4 text-green" />
                  <span>Consent Granted</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onGrantConsent('PATIENT')}
                  className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-green text-[#030D09] hover:bg-green-400 transition-colors shadow-sm"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Patient: Enable Call Transcription</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-3 border-t border-border flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium text-text-2 hover:text-text-1 rounded-lg border border-border hover:bg-surface-hover transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => {
              if (!hasCurrentUserConsented) {
                onGrantConsent(currentPartyIsDoctor ? 'DOCTOR' : 'PATIENT');
              }
            }}
            disabled={consentState.isMutualConsent}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#030D09] bg-green hover:bg-green-400 disabled:opacity-80 disabled:cursor-default rounded-lg transition-colors shadow-sm"
          >
            <CheckCircle2 className="w-4 h-4" />
            {consentState.isMutualConsent
              ? 'Mutual Consent Active'
              : hasCurrentUserConsented
                ? 'Waiting for Other Party…'
                : 'Enable Call Transcription'}
          </button>
        </div>
      </div>
    </div>
  );
}
