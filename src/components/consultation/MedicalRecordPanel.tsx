'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchRecords } from '@/services/api.service';
import type { MedicalRecord } from '@/types';

interface Props {
  patientAddress: string;
}

function RecordItem({ record }: { record: MedicalRecord }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-surface-card p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-text-1">{record.diagnosis}</p>
          <p className="text-xs text-text-3">
            Dr. {record.doctorName} &middot;{' '}
            {new Date(record.date).toLocaleDateString()}
          </p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-text-3 hover:text-text-1"
        >
          {expanded ? 'Less' : 'More'}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 pt-2 border-t border-border space-y-1 text-xs text-text-2">
          {record.prescription && (
            <p>
              <span className="font-medium">Rx:</span> {record.prescription}
            </p>
          )}
          {record.notes && (
            <p>
              <span className="font-medium">Notes:</span> {record.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function MedicalRecordPanel({ patientAddress }: Props) {
  const { data: records, isLoading } = useQuery({
    queryKey: ['patient-records', patientAddress],
    queryFn: () => fetchRecords(patientAddress),
    enabled: !!patientAddress,
  });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3 p-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg bg-surface-card" />
        ))}
      </div>
    );
  }

  if (!records?.length) {
    return (
      <p className="p-4 text-sm text-text-3">
        No medical records found for this patient.
      </p>
    );
  }

  return (
    <div className="overflow-y-auto p-4 space-y-3 h-full">
      {records.map((record) => (
        <RecordItem key={record.id} record={record} />
      ))}
    </div>
  );
}
