'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, X } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useToast } from '@/hooks/useToast';
import { BreakGlassMultiSigProtocol, type BreakGlassApproval, type BreakGlassKey, type BreakGlassRequest } from '@/lib/breakGlassMultiSigProtocol';
import { Keypair } from '@stellar/stellar-sdk';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  patientAddress: string;
  onEmergencyAccessGranted?: (payload: { request: BreakGlassRequest; accessToken: string; expiresAt: number }) => void;
}

const protocol = new BreakGlassMultiSigProtocol();

function mockSigner(seed: string): Keypair {
  return Keypair.fromRawEd25519Seed(Uint8Array.from(Buffer.from(seed.padEnd(32, '0').slice(0, 32))));
}

export default function EmergencyAccessModal({ isOpen, onClose, patientAddress, onEmergencyAccessGranted }: Props) {
  const modalRef = useFocusTrap<HTMLDivElement>(isOpen, onClose);
  const { toast } = useToast();
  const [reason, setReason] = useState<'critical_condition' | 'life_threatening' | 'emergency_access'>('life_threatening');
  const [urgencyLevel, setUrgencyLevel] = useState<1 | 2 | 3>(3);
  const [request, setRequest] = useState<BreakGlassRequest | null>(null);
  const [approvals, setApprovals] = useState<BreakGlassApproval[]>([]);
  const [loading, setLoading] = useState(false);

  const signers = useMemo<BreakGlassKey[]>(() => {
    const a = mockSigner('hospital_director');
    const b = mockSigner('chief_medical_officer');
    return [
      protocol.initializeBreakGlassKey(a, 'hospital_director', 'Metro General'),
      protocol.initializeBreakGlassKey(b, 'chief_medical_officer', 'Metro General'),
    ];
  }, []);
  const [licenseVerified, setLicenseVerified] = useState(false);

  async function verifyActiveLicensesOnChain(keys: BreakGlassKey[]) {
    // Minimal on-chain license check hook: all certified signers must be active.
    // In production this should query the on-chain license registry contract.
    return keys.every((k) => k.isActive);
  }

  if (!isOpen) return null;

  async function createRequest() {
    setLoading(true);
    try {
      const initiator = mockSigner('emergency_admin');
      const req = protocol.createBreakGlassRequest(initiator, 'emergency_admin', patientAddress, reason, urgencyLevel);
      setRequest(req);
      setApprovals([]);
    } finally {
      setLoading(false);
    }
  }

  async function approve() {
    if (!request) return;
    setLoading(true);
    try {
      const signerA = mockSigner('hospital_director');
      const signerB = mockSigner('chief_medical_officer');
      let current = request;
      const nextApprovals: BreakGlassApproval[] = [...approvals];
      for (const [signer, role] of [[signerA, 'hospital_director'], [signerB, 'chief_medical_officer']] as const) {
        if (current.currentSignatures.has(signer.publicKey())) continue;
        const res = protocol.submitApproval(current, signer, role);
        current = res.requestUpdated;
        nextApprovals.push(res.approval);
        if (res.approved) break;
      }
      setRequest(current);
      setApprovals(nextApprovals);
      if (current.status === 'approved') {
        const ok = await verifyActiveLicensesOnChain(signers);
        setLicenseVerified(ok);
        if (!ok) throw new Error('Active on-chain license verification failed for one or more signers.');
        const exec = protocol.executeBreakGlassAccess(current, signers);
        if (exec.accessGranted) {
          toast('Emergency access granted. Patient alert notification triggered.', 'success');
          onEmergencyAccessGranted?.({ request: current, accessToken: exec.accessToken, expiresAt: exec.expiresAt });
        }
      }
    } finally {
      setLoading(false);
    }
  }

  const progress = request ? protocol.getApprovalProgress(request) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="break-glass-title">
      <div ref={modalRef} tabIndex={-1} className="w-full max-w-lg rounded-2xl border border-red-500/30 bg-surface-card p-6 shadow-2xl focus:outline-none">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 id="break-glass-title" className="flex items-center gap-2 text-base font-semibold text-text-1"><ShieldAlert className="h-4 w-4 text-red-400" />Emergency Break-Glass Access</h2>
            <p className="mt-1 text-xs text-text-3">Requires multi-party certified hospital signatures before key release.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-text-3 hover:bg-surface-hover hover:text-text-1"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-4 space-y-4">
          <label className="block text-sm text-text-1">Reason
            <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <option value="life_threatening">Life threatening</option>
              <option value="critical_condition">Critical condition</option>
              <option value="emergency_access">Emergency access</option>
            </select>
          </label>
          <label className="block text-sm text-text-1">Urgency
            <select value={urgencyLevel} onChange={(e) => setUrgencyLevel(Number(e.target.value) as 1 | 2 | 3)} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm">
              <option value={3}>Level 3 - Immediate</option>
              <option value={2}>Level 2 - Urgent</option>
              <option value={1}>Level 1 - Elevated</option>
            </select>
          </label>

          {!request ? (
            <button onClick={() => void createRequest()} disabled={loading} className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}Create Emergency Request
            </button>
          ) : (
            <div className="space-y-3 rounded-lg border border-border bg-surface p-3 text-sm">
              <p className="text-text-1 font-medium">Request {request.requestId.slice(0, 20)}…</p>
              <p className="text-xs text-text-3">Status: {request.status} · signatures {progress?.current}/{progress?.required}</p>
              <div className="h-2 rounded bg-surface-hover"><div className="h-2 rounded bg-red-500" style={{ width: `${progress?.percentage ?? 0}%` }} /></div>
              <div className="text-xs text-text-3">Authorized signers: {signers.map((s) => s.role).join(', ')}</div>
              <div className="text-xs text-text-3">On-chain license check: {licenseVerified ? 'verified' : 'pending'}</div>
              {request.status !== 'approved' ? (
                <button onClick={() => void approve()} disabled={loading} className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}Collect Certified Signatures
                </button>
              ) : (
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-medium"><CheckCircle2 className="h-4 w-4" />Threshold met. Emergency key released and patient alerted.</div>
              )}
              {approvals.length > 0 && <p className="text-[11px] text-text-3 break-all">Approvals: {approvals.map((a) => a.approverRole).join(', ')}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
