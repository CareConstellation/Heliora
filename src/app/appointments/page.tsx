'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import DoctorSearch from '@/components/appointments/DoctorSearch';
import SlotPicker from '@/components/appointments/SlotPicker';
import BookingConfirmation from '@/components/appointments/BookingConfirmation';
import AnchorQuote, { isQuoteActive } from '@/components/appointments/AnchorQuote';
import UpcomingAppointments from '@/components/appointments/UpcomingAppointments';
import EligibilityProofs from '@/components/appointments/EligibilityProofs';
import IntakeQuestionnaire from '@/components/appointments/IntakeQuestionnaire';
import { CancellationPolicyMatrix } from '@/components/appointments/CancellationPolicy';
import { createAppointment, fetchSubsidyTier } from '@/services/api.service';
import FeeInvoice from '@/components/appointments/FeeInvoice';
import { computeFeeInvoice } from '@/lib/feeSubsidy';
import { useWalletStore } from '@/store/useWalletStore';
import { STELLAR_CONFIG } from '@/lib/stellar';
import { withVideoRoom } from '@/lib/video';
import type {
  Doctor,
  TimeSlot,
  Appointment,
  Sep38FirmQuote,
  RecurringAppointmentPlan,
  EligibilityProofToken,
  EncryptedIntakePayload,
} from '@/types';
import { TransactionBuilder, Networks, Operation, Asset } from '@stellar/stellar-sdk';

type Step = 'search' | 'slots' | 'intake' | 'form' | 'confirmed';

function BookingFlow() {
  const { publicKey } = useWalletStore();
  const [step, setStep] = useState<Step>('search');
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [recurringPlan, setRecurringPlan] = useState<RecurringAppointmentPlan | null>(null);
  const [eligibilityProofs, setEligibilityProofs] = useState<EligibilityProofToken[]>([]);
  const [encryptedIntake, setEncryptedIntake] = useState<EncryptedIntakePayload | null>(null);
  const [form, setForm] = useState({
    type: 'in-person' as 'in-person' | 'telemedicine',
    notes: '',
    paymentMethod: 'stellar' as 'stellar' | 'anchor' | 'traditional',
  });
  const [confirmed, setConfirmed] = useState<Appointment | null>(null);
  // Firm SEP-38 quote held across checkout steps until it expires or is used.
  const [quote, setQuote] = useState<Sep38FirmQuote | null>(null);

  // Validation state
  const [slotError, setSlotError] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const queryClient = useQueryClient();
  const subsidyKey = ['subsidy-tier', publicKey];
  const { data: subsidy } = useQuery({
    queryKey: subsidyKey,
    queryFn: () => fetchSubsidyTier(publicKey!),
    enabled: !!publicKey,
    retry: false,
  });

  const BASE_FEE = 10; // XLM
  const listFee = recurringPlan ? recurringPlan.finalBundleFee : BASE_FEE;
  const invoice = computeFeeInvoice(listFee, subsidy);
  const effectiveFee = invoice.patientPays;

  // Derived validation: doctor is guaranteed by the step flow, slot must be chosen, recurring slots must be available, intake must be completed
  const isFormValid =
    !!doctor &&
    !!slot &&
    !!encryptedIntake &&
    (!recurringPlan || recurringPlan.allAvailable) &&
    (form.paymentMethod !== 'anchor' || isQuoteActive(quote));

  const bookMutation = useMutation({
    mutationFn: async () => {
      if (!doctor || !slot || !publicKey) throw new Error('Missing data');
      if (!encryptedIntake) throw new Error('Medical intake questionnaire must be completed before booking.');
      if (recurringPlan && !recurringPlan.allAvailable) {
        throw new Error('One or more recurring slots are unavailable. Please select another starting slot.');
      }
      if (form.paymentMethod === 'anchor' && !isQuoteActive(quote)) {
        throw new Error('Your exchange-rate quote has expired. Request a new one.');
      }

      // Re-verify the subsidy tier right before the fee is locked, so a stale tier can't be charged.
      const freshSubsidy = await queryClient
        .fetchQuery({ queryKey: subsidyKey, queryFn: () => fetchSubsidyTier(publicKey), staleTime: 0 })
        .catch(() => subsidy);
      const fee = computeFeeInvoice(listFee, freshSubsidy).patientPays;

      if (form.paymentMethod === 'stellar' && window.freighter && fee > 0) {
        const server = new (await import('@stellar/stellar-sdk')).Horizon.Server(
          STELLAR_CONFIG.horizonUrl ?? 'https://horizon-testnet.stellar.org',
        );
        const account = await server.loadAccount(publicKey);
        const tx = new TransactionBuilder(account, {
          fee: '100',
          networkPassphrase:
            STELLAR_CONFIG.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET,
        })
          .addOperation(
            Operation.payment({
              destination: doctor.address,
              asset: Asset.native(),
              amount: String(fee),
            }),
          )
          .setTimeout(30)
          .build();

        const signed = await window.freighter.signTransaction(tx.toXDR(), {
          networkPassphrase:
            STELLAR_CONFIG.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET,
        });
        const server2 = new (await import('@stellar/stellar-sdk')).Horizon.Server(
          STELLAR_CONFIG.horizonUrl ?? 'https://horizon-testnet.stellar.org',
        );
        await server2.submitTransaction(
          (await import('@stellar/stellar-sdk')).TransactionBuilder.fromXDR(
            signed,
            STELLAR_CONFIG.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET,
          ),
        );
      }

      return createAppointment({
        doctorId: doctor.id,
        doctorName: doctor.name,
        patientAddress: publicKey,
        datetime: slot.datetime,
        type: form.type,
        notes: form.notes,
        fee,
        isRecurring: !!recurringPlan,
        recurrenceRule: recurringPlan?.rrule,
        recurringPlan: recurringPlan ?? undefined,
        bundleTotal: recurringPlan?.finalBundleFee,
        intakeQuestionnaire: encryptedIntake,
        intakeSummary: encryptedIntake.previewSummary,
        ...(form.paymentMethod === 'anchor' && quote ? { quoteId: quote.id } : {}),
      });
    },
    onSuccess: (appt) => {
      setQuote(null);
      setConfirmed(withVideoRoom(appt));
      setStep('confirmed');
    },
  });

  function handleSlotContinue() {
    if (!slot) {
      setSlotError('Please select a time slot before continuing.');
      return;
    }
    if (recurringPlan && !recurringPlan.allAvailable) {
      setSlotError('Cannot proceed: one or more recurring cadence slots are unavailable. Please select another slot.');
      return;
    }
    setSlotError('');
    setStep('intake');
  }

  function handleIntakeComplete(payload: EncryptedIntakePayload) {
    setEncryptedIntake(payload);
    setStep('form');
  }

  function handleSubmit() {
    setSubmitAttempted(true);
    if (!isFormValid) return;
    bookMutation.mutate();
  }


  if (step === 'confirmed' && confirmed) {
    return (
      <BookingConfirmation
        appointment={confirmed}
        onDone={() => { setStep('search'); setDoctor(null); setSlot(null); setRecurringPlan(null); setConfirmed(null); setSubmitAttempted(false); setEligibilityProofs([]); }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-slate-400">
        {(['search', 'slots', 'intake', 'form'] as Step[]).map((s, i) => (
          <span
            key={s}
            className={`flex items-center gap-1 ${step === s ? 'text-green font-medium' : ''}`}
          >
            {i > 0 && <span>›</span>}
            {s === 'search'
              ? 'Find Doctor'
              : s === 'slots'
                ? 'Pick Slot'
                : s === 'intake'
                  ? 'Intake Form'
                  : 'Book & Pay'}
          </span>
        ))}
      </div>

      {step === 'search' && (
        <DoctorSearch
          onSelect={(d) => {
            setDoctor(d);
            setStep('slots');
          }}
        />
      )}

      {step === 'slots' && doctor && (
        <div>
          <button onClick={() => setStep('search')} className="text-xs text-slate-400 hover:text-slate-600 mb-3">← Back</button>
          <p className="font-semibold text-slate-900 mb-4">Dr. {doctor.name} — {doctor.specialty}</p>
          <SlotPicker
            doctorId={doctor.id}
            selected={slot}
            onSelect={(s) => { setSlot(s); setSlotError(''); }}
            recurringPlan={recurringPlan}
            onSelectRecurringPlan={setRecurringPlan}
            baseFee={BASE_FEE}
          />
          {/* Inline slot validation error */}
          {slotError && (
            <p role="alert" className="mt-2 text-xs text-red-600">{slotError}</p>
          )}
          <button
            onClick={handleSlotContinue}
            className="mt-4 w-full rounded-md bg-green py-2 text-sm font-semibold text-[#030D09] hover:bg-green-600"
          >
            Continue to Intake Questionnaire
          </button>
        </div>
      )}

      {step === 'intake' && doctor && slot && (
        <div>
          <button onClick={() => setStep('slots')} className="text-xs text-slate-400 hover:text-slate-600 mb-3">
            ← Back to Slots
          </button>
          <IntakeQuestionnaire
            doctorName={doctor.name}
            doctorAddress={doctor.address}
            onComplete={handleIntakeComplete}
            onCancel={() => setStep('slots')}
          />
        </div>
      )}

      {step === 'form' && doctor && slot && (
        <div>
          <button
            onClick={() => setStep('intake')}
            className="text-xs text-slate-400 hover:text-slate-600 mb-3"
          >
            ← Back to Intake
          </button>

          <div className="space-y-4">
            {/* Doctor field — read-only, shown as confirmation */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Doctor <span className="text-red-500">*</span>
              </label>
              <div className="rounded-md border border-border bg-surface-inset px-3 py-2 text-sm text-text-1">
                Dr. {doctor.name} — {doctor.specialty}
              </div>
              {submitAttempted && !doctor && (
                <p role="alert" className="mt-1 text-xs text-red-600">A doctor selection is required.</p>
              )}
            </div>

            {/* Slot field — read-only, shown as confirmation */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Appointment Slot <span className="text-red-500">*</span>
              </label>
              <div className="rounded-md border border-border bg-surface-inset px-3 py-2 text-sm text-text-1">
                {new Date(slot.datetime).toLocaleString()}
              </div>
              {submitAttempted && !slot && (
                <p role="alert" className="mt-1 text-xs text-red-600">An appointment slot is required.</p>
              )}
            </div>

            {/* Patient Intake Status */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Medical Intake Questionnaire <span className="text-red-500">*</span>
              </label>
              <div className="rounded-md border border-green/30 bg-green/10 px-3 py-2 text-xs text-text-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-green font-bold">✓ Encrypted Submission Attached</span>
                  {encryptedIntake?.previewSummary?.chiefComplaint && (
                    <span className="text-text-2 truncate max-w-[200px] sm:max-w-xs">
                      — {encryptedIntake.previewSummary.chiefComplaint}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setStep('intake')}
                  className="text-2xs font-semibold text-green hover:underline"
                >
                  Edit Answers
                </button>
              </div>
            </div>


            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Appointment Type
              </label>
              <div className="flex gap-3">
                {(['in-person', 'telemedicine'] as const).map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="type"
                      value={t}
                      checked={form.type === t}
                      onChange={() => setForm((f) => ({ ...f, type: t }))}
                    />
                    {t === 'in-person' ? 'In-Person' : 'Telemedicine'}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Notes (optional)
              </label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Any symptoms, questions, or context for the doctor…"
                className="w-full rounded-md border border-border bg-surface-inset px-3 py-2 text-sm text-text-1 focus:outline-none focus:ring-2 focus:ring-border-focus"
              />
            </div>

            <EligibilityProofs proofs={eligibilityProofs} onChange={setEligibilityProofs} />

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Payment Method
              </label>
              <div className="flex gap-3">
                {(['stellar', 'anchor', 'traditional'] as const).map((m) => (
                  <label key={m} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="payment"
                      value={m}
                      checked={form.paymentMethod === m}
                      onChange={() => setForm((f) => ({ ...f, paymentMethod: m }))}
                    />
                    {m === 'stellar'
                      ? `Stellar (${effectiveFee} XLM)`
                      : m === 'anchor'
                        ? 'Other currency'
                        : 'Traditional'}
                  </label>
                ))}
              </div>
            </div>

            {form.paymentMethod === 'anchor' && (
              <AnchorQuote
                buyAsset="stellar:native"
                buyAmount={String(effectiveFee)}
                quote={quote}
                onQuote={setQuote}
              />
            )}

            <CancellationPolicyMatrix doctorId={doctor.id} />

            <div className="rounded-lg bg-slate-50 p-3 text-sm space-y-1">
              <p className="text-slate-600">
                <span className="font-medium">Dr. {doctor.name}</span> ·{' '}
                {new Date(slot.datetime).toLocaleString()}
              </p>
              {recurringPlan ? (
                <div className="text-xs text-slate-700 space-y-0.5 pt-1 border-t border-slate-200">
                  <p className="font-semibold text-slate-900">
                    Recurring Cadence: {recurringPlan.cadence.toUpperCase()} ({recurringPlan.count} Sessions)
                  </p>
                  <p className="font-mono text-2xs text-slate-500">{recurringPlan.rrule}</p>
                  <p className="text-slate-500">
                    {recurringPlan.count} × {BASE_FEE} XLM = {recurringPlan.totalOriginalFee} XLM
                    {recurringPlan.bundleDiscountPercent > 0 && (
                      <span className="text-green font-medium ml-1">
                        (-{recurringPlan.bundleDiscountPercent}% bundle savings)
                      </span>
                    )}
                  </p>
                  <p className="font-bold text-slate-900 text-sm pt-0.5">
                    Bundle Total: {recurringPlan.finalBundleFee} XLM
                  </p>
                </div>
              ) : (
                <p className="text-slate-500 text-xs mt-0.5">Fee: {BASE_FEE} XLM</p>
              )}
              <FeeInvoice invoice={invoice} />
            </div>

            {bookMutation.isError && (
              <p role="alert" className="text-xs text-red-600">Booking failed. Please try again.</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={bookMutation.isPending || (submitAttempted && !isFormValid)}
              aria-disabled={bookMutation.isPending || (submitAttempted && !isFormValid)}
              className="w-full rounded-md bg-green py-2 text-sm font-semibold text-[#030D09] hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bookMutation.isPending ? 'Processing…' : 'Confirm & Pay'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppointmentsPage() {
  return (
    <ProtectedRoute requiredRole="PATIENT">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-10">
        <div>
          <h1 className="text-2xl font-bold text-text-1 mb-6">Book an Appointment</h1>
          <BookingFlow />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-text-1 mb-4">Upcoming Appointments</h2>
          <UpcomingAppointments />
        </div>
      </div>
    </ProtectedRoute>
  );
}
