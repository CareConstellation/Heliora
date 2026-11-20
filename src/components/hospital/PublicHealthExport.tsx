'use client';

import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { deidentifyRecords, downloadPublicHealthExport } from '@/lib/publicHealthExport';

export default function PublicHealthExport({ rows, firstAdmin }: { rows: Record<string, unknown>[]; firstAdmin?: string | null }) {
  const [secondAdmin, setSecondAdmin] = useState('');
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const safeRows = useMemo(() => deidentifyRecords(rows), [rows]);
  const approved = Boolean(firstAdmin && secondAdmin.trim() && secondAdmin.trim() !== firstAdmin);

  return (
    <section className="mt-5 rounded-[14px] p-5" style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }} aria-labelledby="public-health-export-title">
      <h2 id="public-health-export-title" className="text-sm font-semibold text-text-1">Public-health export</h2>
      <p className="mt-1 text-xs text-text-3">Preview is de-identified before download. Two distinct hospital administrators must approve.</p>
      <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-black/20 p-3 text-2xs text-text-2">{JSON.stringify(safeRows.slice(0, 3), null, 2)}</pre>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-text-2">Format<select value={format} onChange={(event) => setFormat(event.target.value as 'csv' | 'json')} className="ml-2 rounded border p-1 text-black"><option value="csv">CDC CSV</option><option value="json">WHO JSON</option></select></label>
        <label className="text-xs text-text-2">Second admin wallet<input value={secondAdmin} onChange={(event) => setSecondAdmin(event.target.value)} placeholder="G…" className="ml-2 rounded border p-1 text-black" /></label>
        <button type="button" disabled={!approved || safeRows.length === 0} onClick={() => downloadPublicHealthExport(rows, format)} className="btn-secondary rounded-[9px] px-3 py-1.5 text-xs disabled:opacity-50"><Download className="mr-1 inline h-3.5 w-3.5" />Download</button>
      </div>
    </section>
  );
}
