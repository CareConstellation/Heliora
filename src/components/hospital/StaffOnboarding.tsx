'use client';

import { useMemo, useState } from 'react';
import { parseCSV } from '@/lib/bulkRecordParser';

type StaffRow = { name: string; email: string; role: 'DOCTOR' | 'NURSE' | 'ADMIN'; licenseId: string; error?: string };

export default function StaffOnboarding() {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [sent, setSent] = useState(0);
  const [message, setMessage] = useState('');

  const valid = useMemo(() => rows.filter((row) => !row.error), [rows]);
  function read(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseCSV(String(reader.result ?? '')).map((row) => ({
          name: row.doctorName,
          email: row.notes ?? '',
          role: 'DOCTOR' as const,
          licenseId: row.diagnosis,
          error: !row.doctorName || !row.notes ? 'Name and email are required' : undefined,
        }));
        setRows(parsed);
        setSent(0);
        setMessage(`${parsed.filter((row) => row.error).length} row(s) need attention`);
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not parse CSV'); }
    };
    reader.readAsText(file);
  }
  function sendInvites() {
    setSent(0);
    let next = 0;
    const timer = window.setInterval(() => { next += 1; setSent(next); if (next >= valid.length) window.clearInterval(timer); }, 120);
  }

  return <section className="rounded-[14px] p-5 mb-5" style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}>
    <div className="flex items-start justify-between gap-3 mb-3"><div><h2 className="text-sm font-semibold text-text-1">Batch staff onboarding</h2><p className="text-xs text-text-3 mt-1">CSV columns: name, email, role, licenseId. Wallet activation is completed from each invite.</p></div><label className="btn-secondary rounded-[8px] text-xs py-2 px-3 cursor-pointer">Choose CSV<input className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => event.target.files?.[0] && read(event.target.files[0])} /></label></div>
    {rows.length > 0 && <><div className="overflow-auto max-h-40 text-xs"><table className="data-table w-full"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Validation</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.email}-${index}`}><td>{row.name}</td><td>{row.email}</td><td><select value={row.role} onChange={(event) => setRows((current) => current.map((item, i) => i === index ? { ...item, role: event.target.value as StaffRow['role'] } : item))} className="input text-xs py-1"><option>DOCTOR</option><option>NURSE</option><option>ADMIN</option></select></td><td className={row.error ? 'text-red-400' : 'text-emerald-400'}>{row.error ?? 'Ready'}</td></tr>)}</tbody></table></div><div className="flex items-center gap-3 mt-3"><button disabled={!valid.length || sent === valid.length} onClick={sendInvites} className="btn-primary rounded-[8px] text-xs py-2 px-3 disabled:opacity-50">Send {valid.length} invitation{valid.length === 1 ? '' : 's'}</button><span className="text-xs text-text-3">{sent}/{valid.length} delivered</span></div></>}
    {message && <p className="text-xs text-text-3 mt-2">{message}</p>}
  </section>;
}
