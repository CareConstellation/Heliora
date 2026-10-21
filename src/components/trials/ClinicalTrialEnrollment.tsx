'use client';

import { useState, useCallback } from 'react';
import {
  FlaskConical,
  Shield,
  CheckCircle2,
  Loader2,
  Eye,
  EyeOff,
  Download,
  AlertCircle,
} from 'lucide-react';
import {
  blindMessage,
  unblindSignature,
  verifySignature,
  buildTrialCredential,
  buildReceipt,
  serializeReceipt,
  type BlindSignatureReceipt,
} from '@/lib/blindSignature';

interface Study {
  id: string;
  title: string;
  condition: string;
  institution: string;
  signerPublicKey: JsonWebKey;
}

const sampleStudies: Study[] = [
  {
    id: 'TRIAL-001',
    title: 'Phase III Cardiac Drug Study',
    condition: 'Cardiovascular Disease',
    institution: 'Metro General Hospital',
    signerPublicKey: {},
  },
  {
    id: 'TRIAL-002',
    title: 'Diabetes Prevention Research',
    condition: 'Type 2 Diabetes',
    institution: 'University Medical Center',
    signerPublicKey: {},
  },
];

type EnrollmentStep = 'select' | 'blinding' | 'signing' | 'unblinding' | 'complete';

interface Props {
  patientAddress: string;
}

export default function ClinicalTrialEnrollment({ patientAddress }: Props) {
  const [selectedStudy, setSelectedStudy] = useState<Study | null>(null);
  const [step, setStep] = useState<EnrollmentStep>('select');
  const [receipt, setReceipt] = useState<BlindSignatureReceipt | null>(null);
  const [receiptValid, setReceiptValid] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const handleEnroll = useCallback(async (study: Study) => {
    setSelectedStudy(study);
    setLoading(true);
    setError(null);
    setReceiptValid(null);

    try {
      // Step 1: Build credential (no wallet address included)
      setStep('blinding');
      const eligibilityHash = Array.from(
        new Uint8Array(await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(`${patientAddress}:${study.condition}`),
        )),
      ).map((b) => b.toString(16).padStart(2, '0')).join('');

      const { encoded } = buildTrialCredential(
        study.condition,
        study.id,
        eligibilityHash,
      );

      // Step 2: Generate signer keys (in production, the hospital provides these)
      const { generateSignerKeyPair, signBlinded } = await import('@/lib/blindSignature');
      const signer = await generateSignerKeyPair();

      // Step 3: Blind the credential locally
      const { blindedMessage, blindingFactor } = await blindMessage(encoded, signer.publicKey);

      // Step 4: Send blinded message to signer (hospital signs without seeing content)
      setStep('signing');
      const signerPrivateJwk = await crypto.subtle.exportKey('jwk', signer.privateKey);
      const blindSig = await signBlinded(blindedMessage, signerPrivateJwk);

      // Step 5: Unblind signature locally
      setStep('unblinding');
      const signature = unblindSignature(blindSig, blindingFactor, signer.publicKey);

      // Step 6: Verify the unblinded signature
      const valid = await verifySignature(encoded, signature, signer.publicKey);
      setReceiptValid(valid);

      // Step 7: Build receipt
      const r = buildReceipt(encoded, signature, signer.publicKey);
      setReceipt(r);
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrollment failed');
      setStep('select');
    } finally {
      setLoading(false);
    }
  }, [patientAddress]);

  const handleDownloadReceipt = useCallback(() => {
    if (!receipt) return;
    const json = serializeReceipt(receipt);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trial-receipt-${selectedStudy?.id ?? 'unknown'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [receipt, selectedStudy]);

  const stepLabels: Record<EnrollmentStep, string> = {
    select: 'Select a Study',
    blinding: 'Blinding credentials locally…',
    signing: 'Hospital signing (blind)…',
    unblinding: 'Unblinding signature…',
    complete: 'Enrollment complete',
  };

  return (
    <div
      className="rounded-[14px] overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-[9px] flex items-center justify-center"
            style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.12)' }}
          >
            <FlaskConical className="w-4 h-4" style={{ color: '#8B5CF6' }} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-1">Anonymous Clinical Trial Enrollment</h2>
            <p className="text-xs text-text-3 mt-0.5">
              Volunteer for research without revealing your identity
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <EyeOff className="w-3.5 h-3.5" style={{ color: '#8B5CF6' }} />
          <span className="text-xs font-medium" style={{ color: '#8B5CF6' }}>Blind Signatures</span>
        </div>
      </div>

      {/* Progress indicator */}
      {step !== 'select' && step !== 'complete' && (
        <div className="px-5 py-3 flex items-center gap-3" style={{ background: 'rgba(139,92,246,0.04)', borderBottom: '1px solid rgba(139,92,246,0.08)' }}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: '#8B5CF6' }} />
          <span className="text-xs font-medium" style={{ color: '#8B5CF6' }}>{stepLabels[step]}</span>
        </div>
      )}

      {/* Study list */}
      {step === 'select' && (
        <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          {sampleStudies.map((study) => (
            <div
              key={study.id}
              className="px-5 py-4 flex items-center justify-between hover:bg-surface-hover transition-colors"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <FlaskConical className="w-4 h-4 text-text-3" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text-1 truncate">{study.title}</p>
                  <p className="text-2xs text-text-3">{study.institution} · {study.condition}</p>
                </div>
              </div>
              <button
                onClick={() => handleEnroll(study)}
                disabled={loading}
                className="flex items-center gap-1.5 text-2xs font-semibold px-3 py-1.5 rounded-md shrink-0 disabled:opacity-50"
                style={{
                  background: 'rgba(139,92,246,0.1)',
                  color: '#8B5CF6',
                  border: '1px solid rgba(139,92,246,0.2)',
                }}
              >
                <Shield className="w-3 h-3" />
                Enroll Anonymously
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Completion */}
      {step === 'complete' && receipt && (
        <div className="px-5 py-5 space-y-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5" style={{ color: '#00C896' }} />
            <div>
              <p className="text-sm font-semibold text-text-1">Enrolled Successfully</p>
              <p className="text-xs text-text-3">
                Your identity is not linked to this enrollment.
                {receiptValid ? ' Signature verified.' : ''}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-[10px]" style={{ background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-2xs text-text-3 mb-1">Study</p>
              <p className="text-xs font-medium text-text-1">{selectedStudy?.title}</p>
            </div>
            <div className="p-3 rounded-[10px]" style={{ background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-2xs text-text-3 mb-1">Signature Status</p>
              {receiptValid ? (
                <span className="badge-green"><CheckCircle2 className="w-2.5 h-2.5" /> Valid</span>
              ) : (
                <span className="badge-red">Invalid</span>
              )}
            </div>
          </div>

          {/* Receipt toggle */}
          <div>
            <button
              onClick={() => setShowReceipt((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium transition-colors hover:text-text-1"
              style={{ color: '#8B5CF6' }}
            >
              {showReceipt ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showReceipt ? 'Hide Receipt' : 'View Receipt'}
            </button>
            {showReceipt && (
              <pre className="mt-2 p-3 rounded-[10px] text-2xs font-mono text-text-2 overflow-x-auto max-h-32" style={{ background: 'var(--bg-inset)' }}>
                {serializeReceipt(receipt)}
              </pre>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadReceipt}
              className="flex items-center gap-1.5 text-2xs font-semibold px-3 py-1.5 rounded-md"
              style={{
                background: 'rgba(0,200,150,0.1)',
                color: '#00C896',
                border: '1px solid rgba(0,200,150,0.2)',
              }}
            >
              <Download className="w-3 h-3" />
              Download Receipt
            </button>
            <button
              onClick={() => { setStep('select'); setReceipt(null); setReceiptValid(null); setSelectedStudy(null); }}
              className="text-2xs font-medium text-text-3 hover:text-text-1 px-3 py-1.5"
            >
              Enroll in another study
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="px-5 py-3">
          <div
            className="rounded-[10px] px-4 py-3 flex items-center gap-3"
            style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            <AlertCircle className="w-4 h-4 shrink-0" style={{ color: '#F87171' }} />
            <p className="text-xs text-text-1">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}
