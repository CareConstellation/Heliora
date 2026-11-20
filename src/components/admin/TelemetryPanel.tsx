'use client';

import { useMemo, useState } from 'react';
import { Activity, Download, Wallet } from 'lucide-react';

type WindowSize = 24 | 7 | 30;
const points = [42, 55, 48, 66, 61, 74, 69, 82, 77, 88, 83, 91];

export default function TelemetryPanel() {
  const [windowSize, setWindowSize] = useState<WindowSize>(24);
  const data = useMemo(() => points.map((value, i) => ({ hour: i + 1, transactions: value, fees: Math.round(value * 0.018), errors: i % 5 === 0 ? 2 : 0 })), [windowSize]);
  const exportData = (format: 'csv' | 'json') => {
    const body = format === 'json' ? JSON.stringify(data, null, 2) : ['hour,transactions,fees,errors', ...data.map((p) => `${p.hour},${p.transactions},${p.fees},${p.errors}`)].join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([body], { type: format === 'json' ? 'application/json' : 'text/csv' })); link.download = `heliora-telemetry-${windowSize}d.${format}`; link.click(); URL.revokeObjectURL(link.href);
  };
  return <section className="mt-6 rounded-[14px] p-5" style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,.07)' }}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-text-1 flex items-center gap-2"><Activity className="w-4 h-4 text-brand" />Stellar transaction telemetry</h2><p className="text-xs text-text-3 mt-1">Soroban settlement activity, fees, wallets and errors</p></div><div className="flex gap-2"><select className="input text-xs py-1.5" value={windowSize} onChange={(e) => setWindowSize(Number(e.target.value) as WindowSize)}><option value={24}>24h</option><option value={7}>7d</option><option value={30}>30d</option></select><button className="btn-secondary text-xs" onClick={() => exportData('csv')}><Download className="w-3 h-3 inline mr-1" />CSV</button><button className="btn-secondary text-xs" onClick={() => exportData('json')}>JSON</button></div></div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">{[['Transactions', '1,024'], ['Fees (XLM)', '18.4'], ['Active wallets', '86'], ['Error rate', '0.7%']].map(([label, value], i) => <div key={label} className="rounded-[10px] p-3" style={{ background: 'var(--bg-inset)' }}><p className="text-lg font-bold text-text-1">{value}</p><p className="text-2xs text-text-3">{label}</p>{i === 2 && <Wallet className="w-3.5 h-3.5 text-brand mt-2" />}</div>)}</div>
    <svg viewBox="0 0 240 70" className="w-full h-28 mt-5" role="img" aria-label="Transaction volume trend"><polyline points={data.map((p, i) => `${i * 21.5},${68 - p.transactions * .55}`).join(' ')} fill="none" stroke="#00C896" strokeWidth="2" /></svg>
  </section>;
}
