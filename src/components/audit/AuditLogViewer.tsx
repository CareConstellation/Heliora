'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, ShieldCheck, X, XCircle } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import {
  anchorTreeToLedger,
  buildMerkleTree,
  generateProof,
  verifyAnchor,
  verifyProof,
  type AuditEvent,
  type AnchoredAuditRoot,
  type MerkleProof,
} from '@/lib/merkleAudit';

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  events: AuditEvent[];
  selectedIndex: number;
}

export default function AuditLogViewer({ isOpen, onClose, events, selectedIndex }: Props) {
  const modalRef = useFocusTrap<HTMLDivElement>(isOpen, onClose);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<MerkleProof | null>(null);
  const [proofValid, setProofValid] = useState<boolean | null>(null);
  const [anchor, setAnchor] = useState<AnchoredAuditRoot | null>(null);
  const [anchorValid, setAnchorValid] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      setProof(null);
      setProofValid(null);
      setAnchor(null);
      setAnchorValid(null);
      try {
        const tree = await buildMerkleTree(events);
        const nextProof = generateProof(tree, selectedIndex);
        const isValid = await verifyProof(nextProof);
        const nextAnchor = await anchorTreeToLedger(tree, new Date().toISOString().split('T')[0]!, HORIZON_URL);
        const anchorResult = await verifyAnchor(nextAnchor, HORIZON_URL);
        if (cancelled) return;
        setProof(nextProof);
        setProofValid(isValid);
        setAnchor(nextAnchor);
        setAnchorValid(anchorResult.valid);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to verify proof');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [events, isOpen, selectedIndex]);

  if (!isOpen) return null;
  const event = events[selectedIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="audit-log-viewer-title">
      <div ref={modalRef} tabIndex={-1} className="w-full max-w-2xl rounded-2xl border border-border bg-surface-card p-6 shadow-2xl focus:outline-none">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 id="audit-log-viewer-title" className="text-base font-semibold text-text-1">Audit Inclusion Proof</h2>
            <p className="mt-1 text-xs text-text-3">Verifies Merkle inclusion proof against anchored Stellar ledger root.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-text-3 hover:bg-surface-hover hover:text-text-1"><X className="h-4 w-4" /></button>
        </div>

        {loading && <div className="flex items-center gap-2 py-8 text-sm text-text-2"><Loader2 className="h-4 w-4 animate-spin" />Generating proof…</div>}
        {error && <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

        {!loading && proof && event && (
          <div className="mt-4 space-y-4 text-sm">
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs text-text-3">Event</p>
              <p className="font-medium text-text-1">{event.action} · {event.recordId}</p>
              <p className="text-xs text-text-3">{event.timestamp}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Status label="Merkle Proof" ok={proofValid} />
              <Status label="On-chain Root" ok={anchorValid} />
            </div>

            <Field label="Leaf Hash" value={proof.leafHash} />
            <Field label="Merkle Root" value={proof.root} />
            {anchor && <Field label={`Stellar Ledger #${anchor.ledgerSequence}`} value={anchor.ledgerHash} />}
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs text-text-3">Siblings ({proof.siblings.length})</p>
              <div className="mt-2 space-y-1 max-h-40 overflow-auto">
                {proof.siblings.map((s, i) => (
                  <p key={i} className="break-all font-mono text-[11px] text-text-2">{s.position}: {s.hash}</p>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Status({ label, ok }: { label: string; ok: boolean | null }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs text-text-3">{label}</p>
      <div className="mt-1 flex items-center gap-2 font-medium text-text-1">
        {ok === null ? <Loader2 className="h-4 w-4 animate-spin" /> : ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
        {ok === null ? 'Checking' : ok ? 'Verified' : 'Invalid'}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs text-text-3">{label}</p>
      <p className="mt-1 break-all font-mono text-[11px] text-text-1">{value}</p>
    </div>
  );
}
