'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, MapPin, Siren, X } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { freighterMessageSigner, type MessageSigner } from '@/lib/stellar';
import {
  buildEmergencyDispatchPayload,
  createEmergencyProfileStore,
  dispatchEmergencyWebhook,
  emergencyGateRemainingMs,
  formatEmergencyAddress,
  INITIAL_EMERGENCY_GATE,
  loadPatientEmergencyProfile,
  pressEmergencyGate,
  signEmergencyDispatch,
  type DispatchEmergencyOptions,
  type EmergencyAddress,
  type EmergencyDispatchReceipt,
  type EmergencyGateState,
  type EmergencyProfile,
} from '@/lib/breakGlassMultiSigProtocol';
import type { EncryptedLocalStore } from '@/lib/encryptedLocalStore';

interface Props {
  appointmentId: string;
  patientAddress: string;
  /** Stellar address of the person pressing the button; signs the webhook. */
  initiatorAddress: string | null;
  initiatorRole: 'DOCTOR' | 'PATIENT';
  onClose: () => void;
  onDispatched?: (receipt: EmergencyDispatchReceipt) => void;
  /* Injection points for tests. */
  profileStore?: EncryptedLocalStore<EmergencyProfile>;
  signMessage?: MessageSigner;
  dispatchOptions?: DispatchEmergencyOptions;
  now?: () => number;
}

type Phase = 'confirm' | 'sending' | 'sent' | 'failed';

const REASONS = [
  'Cardiac / chest pain',
  'Difficulty breathing',
  'Unresponsive / loss of consciousness',
  'Suspected stroke',
  'Severe bleeding or injury',
  'Self-harm risk',
  'Other medical emergency',
];

const EMPTY_ADDRESS: EmergencyAddress = { line1: '', city: '', country: '' };

/**
 * In-call emergency dispatch (#268). Loads the patient's encrypted emergency
 * address, requires two deliberate clicks, signs the dispatch with the
 * initiator's wallet and posts it to the emergency webhook.
 */
export default function EmergencyDispatchModal({
  appointmentId,
  patientAddress,
  initiatorAddress,
  initiatorRole,
  onClose,
  onDispatched,
  profileStore,
  signMessage = freighterMessageSigner,
  dispatchOptions,
  now = Date.now,
}: Props) {
  const modalRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const [profile, setProfile] = useState<EmergencyProfile | null>(null);
  const [profileState, setProfileState] = useState<'loading' | 'loaded' | 'missing' | 'error'>('loading');
  const [manualAddress, setManualAddress] = useState<EmergencyAddress>(EMPTY_ADDRESS);
  const [reason, setReason] = useState(REASONS[0]!);
  const [gate, setGate] = useState<EmergencyGateState>(INITIAL_EMERGENCY_GATE);
  const [remainingMs, setRemainingMs] = useState(0);
  const [phase, setPhase] = useState<Phase>('confirm');
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<EmergencyDispatchReceipt | null>(null);

  useEffect(() => {
    let cancelled = false;
    const store = profileStore ?? createEmergencyProfileStore();
    void loadPatientEmergencyProfile(patientAddress, store).then(({ profile: p, error: err }) => {
      if (cancelled) return;
      setProfile(p);
      setProfileState(p ? 'loaded' : err ? 'error' : 'missing');
    });
    return () => {
      cancelled = true;
    };
  }, [patientAddress, profileStore]);

  // Countdown while armed; disarm when the confirmation window lapses.
  useEffect(() => {
    if (gate.status !== 'armed') {
      setRemainingMs(0);
      return;
    }
    const update = () => {
      const left = emergencyGateRemainingMs(gate, now());
      setRemainingMs(left);
      if (left <= 0) setGate(INITIAL_EMERGENCY_GATE);
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [gate, now]);

  const manualComplete =
    manualAddress.line1.trim() !== '' && manualAddress.city.trim() !== '' && manualAddress.country.trim() !== '';
  const location = profile
    ? { formatted: formatEmergencyAddress(profile.address), address: profile.address, source: 'encrypted-profile' as const }
    : manualComplete
      ? { formatted: formatEmergencyAddress(manualAddress), address: manualAddress, source: 'confirmed-verbally' as const }
      : null;

  async function send(confirmedGate: EmergencyGateState) {
    if (!initiatorAddress) {
      setError('Connect your wallet to sign the emergency dispatch.');
      setPhase('failed');
      return;
    }
    setPhase('sending');
    setError(null);
    try {
      const payload = buildEmergencyDispatchPayload({
        appointmentId,
        patientAddress,
        initiatedBy: initiatorAddress,
        initiatorRole,
        reason,
        gate: confirmedGate,
        location,
        ...(profile?.phone ? { callbackPhone: profile.phone } : {}),
      });
      const signed = await signEmergencyDispatch(payload, signMessage);
      const result = await dispatchEmergencyWebhook(signed, dispatchOptions);
      setReceipt(result);
      setPhase('sent');
      onDispatched?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('failed');
      // Require a fresh two-step confirmation for the retry.
      setGate(INITIAL_EMERGENCY_GATE);
    }
  }

  function handlePress() {
    if (phase === 'sending' || phase === 'sent') return;
    const result = pressEmergencyGate(gate, now());
    setGate(result.state);
    if (result.action === 'confirmed') void send(result.state);
  }

  const armed = gate.status === 'armed';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-dispatch-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-red-500/40 bg-surface-card p-6 shadow-2xl space-y-4 focus:outline-none"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Siren className="h-5 w-5 text-red-600" aria-hidden="true" />
            <h3 id="emergency-dispatch-title" className="text-base font-bold text-text-1">
              Emergency dispatch (911)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close emergency dispatch"
            disabled={phase === 'sending'}
            className="rounded-md p-1 text-text-3 hover:bg-surface-hover hover:text-text-1 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {phase === 'sent' && receipt ? (
          <div role="status" className="space-y-2 rounded-lg border border-green/30 bg-green/5 p-3 text-xs text-text-1">
            <p className="flex items-center gap-1.5 font-semibold text-green">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Emergency services notified
            </p>
            <p>
              Reference <span className="font-mono">{receipt.dispatchId}</span>. Stay on the call with the patient
              until responders arrive.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-text-1">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Patient location
              </p>
              {profileState === 'loading' && (
                <p className="text-xs text-text-3">Decrypting emergency profile…</p>
              )}
              {profileState === 'loaded' && profile && (
                <p data-testid="emergency-address" className="rounded-md bg-surface-inset p-2 text-xs text-text-1">
                  {formatEmergencyAddress(profile.address)}
                  {profile.address.accessNotes && (
                    <span className="block text-text-3">Access: {profile.address.accessNotes}</span>
                  )}
                </p>
              )}
              {(profileState === 'missing' || profileState === 'error') && (
                <div className="space-y-2">
                  <p role="alert" className="flex items-start gap-1.5 rounded-md bg-yellow-500/10 p-2 text-xs text-yellow-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {profileState === 'error'
                      ? 'The saved emergency address could not be decrypted.'
                      : 'No emergency address is on file.'}{' '}
                    Ask the patient where they are and enter it below.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ['line1', 'Street address', 'col-span-2'],
                        ['city', 'City', ''],
                        ['region', 'State / region', ''],
                        ['postalCode', 'Postal code', ''],
                        ['country', 'Country', ''],
                      ] as const
                    ).map(([key, label, span]) => (
                      <input
                        key={key}
                        aria-label={label}
                        placeholder={label}
                        value={manualAddress[key] ?? ''}
                        onChange={(e) => setManualAddress((a) => ({ ...a, [key]: e.target.value }))}
                        className={`rounded-md border border-border bg-surface-inset px-2 py-1.5 text-xs text-text-1 ${span}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <label className="block space-y-1 text-xs font-semibold text-text-1">
              <span>Reason</span>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-inset px-2 py-1.5 text-xs font-normal"
              >
                {REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>

            {error && (
              <p role="alert" className="rounded-md bg-red-500/10 p-2 text-xs text-red-600">
                Dispatch failed: {error}. If the patient is in danger, call 911 directly now.
              </p>
            )}

            <button
              type="button"
              onClick={handlePress}
              disabled={phase === 'sending' || profileState === 'loading'}
              data-armed={armed}
              className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold text-white transition-colors disabled:opacity-60 ${
                armed ? 'animate-pulse bg-red-700' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {phase === 'sending' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Notifying emergency services…
                </>
              ) : armed ? (
                `Tap again to confirm dispatch (${Math.ceil(remainingMs / 1000)}s)`
              ) : (
                'Request emergency services'
              )}
            </button>
            <p className="text-3xs text-text-3">
              Two taps are required. This sends a signed alert with the patient&apos;s location
              {location ? '' : ' (location unknown — dispatcher will call back)'} to emergency dispatch.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
