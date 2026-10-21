'use client';

import type { MedicalRecord } from '@/types';
import RecordIpfsStatus from './RecordIpfsStatus';
import DicomViewer from './DicomViewer';

interface Props {
  record: MedicalRecord;
  onClose: () => void;
}

export default function RecordDetailDrawer({ record, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-detail-title"
    >
      <div
        className="h-full w-full max-w-md bg-white shadow-xl overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 id="record-detail-title" className="text-lg font-semibold text-slate-900">
            Record Details
          </h2>
          <button
            onClick={onClose}
            aria-label="Close record details"
            className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        <dl className="space-y-4 text-sm">
          <div>
            <dt className="font-medium text-slate-500">Date</dt>
            <dd className="mt-1 text-slate-900">{new Date(record.date).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Doctor</dt>
            <dd className="mt-1 text-slate-900">{record.doctorName}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Diagnosis</dt>
            <dd className="mt-1 text-slate-900">{record.diagnosis}</dd>
          </div>
          {record.prescription && (
            <div>
              <dt className="font-medium text-slate-500">Prescription</dt>
              <dd className="mt-1 text-slate-900">{record.prescription}</dd>
            </div>
          )}
          {record.notes && (
            <div>
              <dt className="font-medium text-slate-500">Notes</dt>
              <dd className="mt-1 text-slate-900 whitespace-pre-wrap">{record.notes}</dd>
            </div>
          )}
          <RecordIpfsStatus recordId={record.id} />
        </dl>

        {record.dicomUrl && (
          <section className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Imaging</h3>
            <DicomViewer src={record.dicomUrl} />
          </section>
        )}
      </div>
    </div>
  );
}
