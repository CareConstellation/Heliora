'use client';

import { useState } from 'react';

export default function ProtocolConsole() {
  const [fee, setFee] = useState('2.5');
  const [asset, setAsset] = useState('native');
  const [oracle, setOracle] = useState('');
  const [proposal, setProposal] = useState('');
  function stage(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(fee);
    if (!Number.isFinite(value) || value < 0 || value > 100 || !oracle.trim()) { setProposal('Enter an oracle address and a fee between 0 and 100%.'); return; }
    setProposal(JSON.stringify({ action: 'protocol-parameter-update', feePercent: value, asset, oracle: oracle.trim(), requiresMultisig: true }, null, 2));
  }
  return <section className="rounded-[14px] p-5 mb-5" style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}><div className="mb-4"><h2 className="text-sm font-semibold text-text-1">Protocol parameters</h2><p className="text-xs text-text-3 mt-1">Prepare a multisig proposal; nothing is submitted from this form.</p></div><form onSubmit={stage} className="grid grid-cols-1 md:grid-cols-3 gap-3"><label className="text-xs text-text-2">Platform fee (%)<input value={fee} onChange={(event) => setFee(event.target.value)} type="number" min="0" max="100" step="0.01" className="input mt-1 w-full" /></label><label className="text-xs text-text-2">Settlement asset<select value={asset} onChange={(event) => setAsset(event.target.value)} className="input mt-1 w-full"><option value="native">Native asset</option><option value="usdc">USDC</option><option value="custom">Custom trustline</option></select></label><label className="text-xs text-text-2">Oracle address<input value={oracle} onChange={(event) => setOracle(event.target.value)} placeholder="G..." className="input mt-1 w-full" /></label><button className="btn-primary rounded-[8px] text-xs py-2 px-3 md:col-span-3 w-fit">Prepare multisig proposal</button></form>{proposal && <pre className="mt-3 rounded-lg p-3 text-2xs overflow-auto" style={{ background: 'var(--bg-inset)' }}>{proposal}</pre>}</section>;
}
