'use client';

import { useState } from 'react';
type Claim = { id: string; receipt: string; submitted: string; covered: number; copay: number; status: 'Submitted' | 'In Review' | 'Approved' | 'Disbursed' };
const initial: Claim[] = [{ id: 'CLM-1042', receipt: 'HS-001188', submitted: 'May 15, 2025', covered: 420, copay: 80, status: 'In Review' }];
const statuses: Claim['status'][] = ['Submitted', 'In Review', 'Approved', 'Disbursed'];
export default function InsuranceClaims() {
  const [claims, setClaims] = useState(initial);
  return <section className="rounded-[14px] p-5 mb-5" style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}><div className="flex items-start justify-between mb-4"><div><h2 className="text-sm font-semibold text-text-1">Insurance claims</h2><p className="text-xs text-text-3 mt-1">Receipt-linked reimbursement status and itemized coverage.</p></div><button onClick={() => setClaims((current) => current.map((claim) => ({ ...claim, status: statuses[Math.min(statuses.indexOf(claim.status) + 1, statuses.length - 1)]! })))} className="btn-secondary rounded-[8px] text-xs py-1.5 px-2.5">Refresh contract events</button></div><div className="space-y-3">{claims.map((claim) => <div key={claim.id} className="rounded-lg p-3" style={{ background: 'var(--bg-inset)' }}><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-text-1">{claim.id} · receipt {claim.receipt}</p><p className="text-2xs text-text-3 mt-1">Submitted {claim.submitted}</p></div><span className="badge-green">{claim.status}</span></div><div className="grid grid-cols-2 gap-3 mt-3 text-xs"><div><span className="text-text-3">Insurance-covered</span><p className="font-semibold text-text-1">${claim.covered.toFixed(2)}</p></div><div><span className="text-text-3">Patient copay</span><p className="font-semibold text-text-1">${claim.copay.toFixed(2)}</p></div></div></div>)}</div></section>;
}
