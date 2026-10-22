'use client';

import { useState } from 'react';
import type { MedicalRecord } from '@/types';
import {
  anchorConsentReceipt,
  type AnchoredConsentReceipt,
  type ConsentAgreementParams,
} from '@/lib/crypto';
import { downloadConsentReceiptPDF } from '@/lib/medicalPdfGenerator';
import { useWalletStore } from '@/store/useWalletStore';
import { useToast } from '@/hooks/useToast';
import { ShieldCheck, Download, CheckCircle2, Building2, FlaskConical, Stethoscope, X } from 'lucide-react';

interface Props {
  record: MedicalRecord;
  onClose: () => void;
}

export default function ConsentReceiptModal({ record, onClose }: Props) {
  const { publicKey } = useWalletStore();
  const { toast } = useToast();

  const [recipient, setRecipient] = useState('');
  const [recipientType, setRecipientType] = useState<'laboratory' | 'insurance' | 'external_provider'>('laboratory');
  const [purpose, setPurpose] = useState('Laboratory Diagnostic Review & Pathology Processing');
  const [durationDays, setDurationDays] = useState(30);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [anchoredReceipt, setAnchoredReceipt] = useState<AnchoredConsentReceipt | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Compute dummy or actual content hash for the record
  const recordHash = record.id.startsWith('hash_')
    ? record.id
    : `rec_sha256_${record.id}_${(record.diagnosis || '').length.toString(16)}`;

  async function handleAnchorConsent(e: React.FormEvent) {
    e.preventDefault();
    if (!recipient.trim()) {
      toast('Recipient address is required.', 'error');
      return;
    }
    if (!purpose.trim()) {
      toast('Consent purpose is required.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const params: ConsentAgreementParams = {
        recordId: record.id,
        recordHash,
        recipient: recipient.trim(),
        recipientType,
        purpose: purpose.trim(),
        durationDays,
      };

      const receipt = await anchorConsentReceipt(params, publicKey || record.patientAddress);
      setAnchoredReceipt(receipt);
      toast('Consent receipt anchored on Soroban ledger.', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to anchor consent receipt.';
      toast(msg, 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDownloadPdf() {
    if (!anchoredReceipt) return;
    setIsDownloading(true);
    try {
      await downloadConsentReceiptPDF(anchoredReceipt, record.doctorName);
      toast('Consent receipt PDF proof downloaded.', 'success');
    } catch {
      toast('Failed to generate consent receipt PDF.', 'error');
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-green/10 p-2 text-green">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Verifiable Consent Receipt</h2>
              <p className="text-xs text-slate-500">Anchor cryptographic transmission token on Soroban</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!anchoredReceipt ? (
          <form onSubmit={handleAnchorConsent} className="space-y-4 text-xs">
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Target Entity / Recipient Type
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { type: 'laboratory' as const, label: 'External Lab', icon: FlaskConical },
                  { type: 'insurance' as const, label: 'Insurance Provider', icon: Building2 },
                  { type: 'external_provider' as const, label: 'Clinician / Specialist', icon: Stethoscope },
                ].map((item) => {
                  const Icon = item.icon;
                  const active = recipientType === item.type;
                  return (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => setRecipientType(item.type)}
                      className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-center transition-all ${
                        active
                          ? 'border-green bg-green/10 text-slate-900 font-semibold ring-1 ring-green'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className="h-4 w-4 mb-1 text-green" />
                      <span className="text-2xs">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Recipient Wallet Address / DID
              </label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="e.g. GAB37K... or LAB_PROVIDER_PUBKEY"
                required
                className="w-full rounded-lg border border-slate-200 p-2 text-xs font-mono text-slate-900 focus:border-green focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Clinical Consent Purpose
              </label>
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Reason for data disclosure"
                required
                className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-900 focus:border-green focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Authorized Access Duration
              </label>
              <select
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-900 focus:border-green focus:outline-hidden"
              >
                <option value={7}>7 Days (Rapid Lab Analysis)</option>
                <option value={30}>30 Days (Standard Care Episode)</option>
                <option value={90}>90 Days (Multi-stage Adjudication)</option>
                <option value={365}>1 Year (Longitudinal Trial / Chronic)</option>
              </select>
            </div>

            <div className="rounded-lg bg-slate-50 p-3 text-2xs text-slate-600 space-y-1">
              <p className="font-semibold text-slate-900">Cryptographic Digest Guarantee:</p>
              <p>
                A deterministic SHA-256 digest of this agreement will be recorded permanently in the
                Soroban consent smart contract.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-4 py-2 font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-lg bg-green px-4 py-2 font-semibold text-[#030D09] hover:bg-green-600 disabled:opacity-50"
              >
                {isSubmitting ? 'Anchoring On-Chain…' : 'Anchor & Issue Receipt'}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 text-xs">
            <div className="rounded-lg bg-green-50 p-3 text-green-800 flex items-start gap-2">
              <CheckCircle2 className="h-5 w-5 text-green mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">Consent Receipt Successfully Anchored</p>
                <p className="text-2xs mt-0.5 text-green-700">
                  Unique on-chain consent receipt created and verified on Soroban.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2 text-2xs">
              <div>
                <span className="text-slate-500 block">Receipt ID:</span>
                <span className="font-mono font-bold text-slate-900 break-all">{anchoredReceipt.receiptId}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Agreement SHA-256 Digest:</span>
                <span className="font-mono text-slate-700 break-all">{anchoredReceipt.agreementDigest}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Ledger Transaction Hash:</span>
                <span className="font-mono text-slate-700 break-all">{anchoredReceipt.ledgerTxHash}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Valid Until:</span>
                <span className="text-slate-900 font-medium">{new Date(anchoredReceipt.validUntil).toLocaleString()}</span>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={isDownloading}
                className="flex-1 rounded-lg bg-green py-2 font-semibold text-[#030D09] hover:bg-green-600 flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                {isDownloading ? 'Generating PDF…' : 'Download Cryptographic PDF Proof'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-4 py-2 font-medium text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
