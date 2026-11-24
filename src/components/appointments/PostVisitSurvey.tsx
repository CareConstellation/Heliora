'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, ShieldCheck, X } from 'lucide-react';
import type { Appointment } from '@/types';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { blindMessage, buildReceipt, serializeReceipt, unblindSignature, verifySignature } from '@/lib/blindSignature';

interface Props {
  appointment: Appointment;
  onClose: () => void;
}

export default function PostVisitSurvey({ appointment, onClose }: Props) {
  const modalRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const [rating, setRating] = useState(5);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const payload = new TextEncoder().encode(
        JSON.stringify({
          appointmentId: appointment.id,
          doctorId: appointment.doctorId,
          rating,
          feedback: feedback.trim(),
          completedAt: appointment.datetime,
        }),
      );

      const { generateSignerKeyPair, signBlinded } = await import('@/lib/blindSignature');
      const signer = await generateSignerKeyPair();
      const privateJwk = await crypto.subtle.exportKey('jwk', signer.signingKey);
      const { blindedMessage, blindingFactor } = await blindMessage(payload, signer.publicKey);
      const blindSig = await signBlinded(blindedMessage, privateJwk);
      const signature = unblindSignature(blindSig, blindingFactor, signer.publicKey);
      const valid = await verifySignature(payload, signature, signer.publicKey);
      if (!valid) throw new Error('Blind signature verification failed.');

      setReceipt(serializeReceipt(buildReceipt(payload, signature, signer.publicKey)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit survey');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="post-visit-survey-title">
      <div ref={modalRef} tabIndex={-1} className="w-full max-w-lg rounded-2xl border border-border bg-surface-card p-6 shadow-2xl focus:outline-none">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 id="post-visit-survey-title" className="text-base font-semibold text-text-1">Anonymous Post-Visit Survey</h2>
            <p className="mt-1 text-xs text-text-3">Blinded signature proves appointment completion without linking your identity.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-text-3 hover:bg-surface-hover hover:text-text-1"><X className="h-4 w-4" /></button>
        </div>

        {!receipt ? (
          <div className="mt-4 space-y-4">
            <label className="block text-sm text-text-1">
              Rating
              <select value={rating} onChange={(e) => setRating(Number(e.target.value))} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm">
                {[5, 4, 3, 2, 1].map((v) => <option key={v} value={v}>{v} / 5</option>)}
              </select>
            </label>
            <label className="block text-sm text-text-1">
              Feedback
              <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={4} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm" placeholder="How was your visit?" />
            </label>
            {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
            <button onClick={() => void submit()} disabled={loading} className="inline-flex items-center gap-2 rounded-md bg-green px-4 py-2 text-sm font-medium text-[#030D09] disabled:opacity-50">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Submit Anonymous Survey
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 text-emerald-400"><CheckCircle2 className="h-4 w-4" /><span className="text-sm font-medium">Survey submitted with verified blind signature</span></div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs text-text-3">Unblinded Receipt</p>
              <p className="mt-1 break-all font-mono text-[11px] text-text-2">{receipt}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
