'use client';

import { useState } from 'react';
import { FileText, Search, Shield } from 'lucide-react';
import type { AuditEvent } from '@/lib/merkleAudit';
import AuditLogViewer from './AuditLogViewer';

const sampleEvents: AuditEvent[] = [
  { timestamp: '2025-06-15T09:00:00Z', action: 'record_accessed', actorAddress: 'GAKP...X7QM', subjectAddress: 'GCMR...4BNP', recordId: 'HS-001337' },
  { timestamp: '2025-06-15T10:30:00Z', action: 'access_granted', actorAddress: 'GCMR...4BNP', subjectAddress: 'GPX2...9KLF', recordId: 'HS-001290' },
  { timestamp: '2025-06-15T14:15:00Z', action: 'record_created', actorAddress: 'GPX2...9KLF', subjectAddress: 'GCMR...4BNP', recordId: 'HS-001401' },
  { timestamp: '2025-06-15T16:45:00Z', action: 'record_accessed', actorAddress: 'GAPH...2MQT', subjectAddress: 'GCMR...4BNP', recordId: 'HS-001337' },
];

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

  return (
    <div className="space-y-4">
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
                      onClick={() => setSelectedIndex(i)}
                      className="flex items-center gap-1 text-2xs font-semibold px-2.5 py-1 rounded-md"
                      style={{
                        background: selectedIndex === i ? 'rgba(0,200,150,0.15)' : 'rgba(0,200,150,0.08)',
                        color: '#00C896',
                        border: '1px solid rgba(0,200,150,0.2)',
                      }}
                    >
                      <Search className="w-3 h-3" />
                      Prove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedIndex !== null && (
        <AuditLogViewer
          isOpen={selectedIndex !== null}
          onClose={() => setSelectedIndex(null)}
          events={events}
          selectedIndex={selectedIndex}
        />
      )}
    </div>
  );
}
