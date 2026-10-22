'use client';

import { useState, useCallback } from 'react';
import {
  Shield,
  CheckCircle2,
  XCircle,
  Loader2,
  Search,
  FileText,
  Hash,
  ExternalLink,
} from 'lucide-react';
import {
  buildMerkleTree,
  generateProof,
  verifyProof,
  anchorTreeToLedger,
  verifyAnchor,
  type AuditEvent,
  type MerkleProof,
  type AnchoredAuditRoot,
} from '@/lib/merkleAudit';

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

const sampleEvents: AuditEvent[] = [
  { timestamp: '2025-06-15T09:00:00Z', action: 'record_accessed', actorAddress: 'GAKP...X7QM', subjectAddress: 'GCMR...4BNP', recordId: 'HS-001337' },
  { timestamp: '2025-06-15T10:30:00Z', action: 'access_granted', actorAddress: 'GCMR...4BNP', subjectAddress: 'GPX2...9KLF', recordId: 'HS-001290' },
  { timestamp: '2025-06-15T14:15:00Z', action: 'record_created', actorAddress: 'GPX2...9KLF', subjectAddress: 'GCMR...4BNP', recordId: 'HS-001401' },
  { timestamp: '2025-06-15T16:45:00Z', action: 'record_accessed', actorAddress: 'GAPH...2MQT', subjectAddress: 'GCMR...4BNP', recordId: 'HS-001337' },
];

function truncateHash(hash: string, len = 12): string {
  if (hash.length <= len * 2) return hash;
  return `${hash.slice(0, len)}…${hash.slice(-len)}`;
}

const actionLabels: Record<AuditEvent['action'], string> = {
  record_accessed: 'Record Accessed',
  access_granted: 'Access Granted',
  access_revoked: 'Access Revoked',
  record_created: 'Record Created',
  record_updated: 'Record Updated',
};

interface Props {
  hospitalAddress: string;
}

export default function AuditTrailVerifier({ hospitalAddress: _hospitalAddress }: Props) {
  const [events] = useState<AuditEvent[]>(sampleEvents);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [proof, setProof] = useState<MerkleProof | null>(null);
  const [anchor, setAnchor] = useState<AnchoredAuditRoot | null>(null);
  const [proofValid, setProofValid] = useState<boolean | null>(null);
  const [anchorValid, setAnchorValid] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateProof = useCallback(async (index: number) => {
    setLoading(true);
    setError(null);
    setProofValid(null);
    setAnchorValid(null);
    setSelectedIndex(index);
    try {
      const tree = await buildMerkleTree(events);
      const p = generateProof(tree, index);
      setProof(p);

      const valid = await verifyProof(p);
      setProofValid(valid);

      const a = await anchorTreeToLedger(tree, new Date().toISOString().split('T')[0]!, HORIZON_URL);
      setAnchor(a);

      const av = await verifyAnchor(a, HORIZON_URL);
      setAnchorValid(av.valid);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Proof generation failed');
    } finally {
      setLoading(false);
    }
  }, [events]);

  return (
    <div className="space-y-4">
      {/* Events table */}
      <div
        className="rounded-[14px] overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div>
            <h2 className="text-sm font-semibold text-text-1">Audit Event Log</h2>
            <p className="text-xs text-text-3 mt-0.5">
              {events.length} events · select an event to generate a Merkle inclusion proof
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" style={{ color: '#00C896' }} />
            <span className="text-xs font-medium" style={{ color: '#00C896' }}>
              Stellar Anchored
            </span>
          </div>
        </div>

        <table className="data-table w-full">
          <thead>
            <tr>
              <th>#</th>
              <th>Action</th>
              <th className="hidden sm:table-cell">Actor</th>
              <th className="hidden md:table-cell">Record</th>
              <th>Time</th>
              <th className="text-right">Proof</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event, i) => (
              <tr key={i} className={selectedIndex === i ? 'bg-surface-hover' : ''}>
                <td className="text-xs text-text-3 font-mono">{i}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-text-3 shrink-0" />
                    <span className="text-xs font-medium text-text-1">{actionLabels[event.action]}</span>
                  </div>
                </td>
                <td className="hidden sm:table-cell text-xs text-text-2 font-mono">{event.actorAddress}</td>
                <td className="hidden md:table-cell text-xs text-text-2 font-mono">{event.recordId}</td>
                <td className="text-xs text-text-2 whitespace-nowrap">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </td>
                <td>
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleGenerateProof(i)}
                      disabled={loading}
                      className="flex items-center gap-1 text-2xs font-semibold px-2.5 py-1 rounded-md disabled:opacity-50"
                      style={{
                        background: selectedIndex === i ? 'rgba(0,200,150,0.15)' : 'rgba(0,200,150,0.08)',
                        color: '#00C896',
                        border: '1px solid rgba(0,200,150,0.2)',
                      }}
                    >
                      {loading && selectedIndex === i ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Search className="w-3 h-3" />
                      )}
                      Prove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Proof result */}
      {proof && (
        <div
          className="rounded-[14px] p-5 space-y-4"
          style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-1">Merkle Inclusion Proof</h3>
            {proofValid !== null && (
              proofValid ? (
                <span className="badge-green"><CheckCircle2 className="w-2.5 h-2.5" /> Verified</span>
              ) : (
                <span className="badge-red"><XCircle className="w-2.5 h-2.5" /> Invalid</span>
              )
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-[10px]" style={{ background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-2xs text-text-3 mb-1">Leaf Index</p>
              <p className="text-xs font-mono text-text-1">{proof.leafIndex} of {proof.treeSize}</p>
            </div>
            <div className="p-3 rounded-[10px]" style={{ background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-2xs text-text-3 mb-1">Proof Depth</p>
              <p className="text-xs font-mono text-text-1">{proof.siblings.length} siblings (⌈log₂ {proof.treeSize}⌉)</p>
            </div>
          </div>

          <div className="p-3 rounded-[10px]" style={{ background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-2xs text-text-3 mb-1">Leaf Hash</p>
            <p className="text-xs font-mono text-text-1 break-all">{proof.leafHash}</p>
          </div>

          <div className="space-y-1.5">
            <p className="text-2xs text-text-3">Sibling Path</p>
            {proof.siblings.map((s, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-md" style={{ background: 'var(--bg-inset)' }}>
                <Hash className="w-3 h-3 text-text-3 shrink-0" />
                <span className="text-2xs font-mono text-text-2 break-all flex-1">{truncateHash(s.hash)}</span>
                <span className="text-2xs text-text-3">{s.position}</span>
              </div>
            ))}
          </div>

          <div className="p-3 rounded-[10px]" style={{ background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-2xs text-text-3 mb-1">Merkle Root</p>
            <p className="text-xs font-mono text-text-1 break-all">{proof.root}</p>
          </div>
        </div>
      )}

      {/* Stellar anchor */}
      {anchor && (
        <div
          className="rounded-[14px] p-5 space-y-3"
          style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-1">Stellar Ledger Anchor</h3>
            {anchorValid !== null && (
              anchorValid ? (
                <span className="badge-green"><CheckCircle2 className="w-2.5 h-2.5" /> Ledger Verified</span>
              ) : (
                <span className="badge-red"><XCircle className="w-2.5 h-2.5" /> Mismatch</span>
              )
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-[10px]" style={{ background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-2xs text-text-3 mb-1">Ledger Sequence</p>
              <p className="text-xs font-mono text-text-1">#{anchor.ledgerSequence}</p>
            </div>
            <div className="p-3 rounded-[10px]" style={{ background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-2xs text-text-3 mb-1">Closed At</p>
              <p className="text-xs text-text-1">{new Date(anchor.ledgerClosedAt).toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-[10px]" style={{ background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-2xs text-text-3 mb-1">Audit Date</p>
              <p className="text-xs text-text-1">{anchor.date}</p>
            </div>
          </div>

          <div className="p-3 rounded-[10px]" style={{ background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-2xs text-text-3 mb-1">Ledger Hash</p>
            <p className="text-xs font-mono text-text-1 break-all">{anchor.ledgerHash}</p>
          </div>

          <a
            href={`${HORIZON_URL}/ledgers/${anchor.ledgerSequence}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs font-medium transition-colors hover:text-text-1"
            style={{ color: '#00C896' }}
          >
            <ExternalLink className="w-3 h-3" />
            View on Stellar Horizon
          </a>
        </div>
      )}

      {error && (
        <div
          className="rounded-[12px] px-4 py-3 flex items-center gap-3"
          style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <XCircle className="w-4 h-4 shrink-0" style={{ color: '#F87171' }} />
          <p className="text-sm text-text-1">{error}</p>
        </div>
      )}
    </div>
  );
}
