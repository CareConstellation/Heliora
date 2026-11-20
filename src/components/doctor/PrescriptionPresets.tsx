'use client';

import { useEffect, useState } from 'react';

export type PrescriptionPreset = { name: string; prescription: string; instructions: string };
const KEY = 'heliora-prescription-presets';
const defaults: PrescriptionPreset[] = [{ name: 'Hypertension starter', prescription: 'Amlodipine 5mg', instructions: 'Once daily' }];

export default function PrescriptionPresets({ onApply }: { onApply: (preset: PrescriptionPreset) => void }) {
  const [presets, setPresets] = useState<PrescriptionPreset[]>(defaults);
  const [macro, setMacro] = useState('');
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (Array.isArray(saved)) setPresets(saved); } catch { /* use defaults */ } }, []);
  function save() {
    const [name, prescription, instructions] = macro.split('|').map((part) => part.trim());
    if (!name || !prescription || !instructions) return;
    const next = [...presets, { name, prescription, instructions }]; setPresets(next); localStorage.setItem(KEY, JSON.stringify(next)); setMacro('');
  }
  return <div className="rounded-lg p-3 mb-3" style={{ background: 'var(--bg-inset)' }}><div className="flex flex-wrap items-center gap-2"><select aria-label="Prescription formulary presets" className="input text-xs py-1.5" defaultValue="" onChange={(event) => { const preset = presets[Number(event.target.value)]; if (preset) onApply(preset); }}><option value="">Use a saved preset…</option>{presets.map((preset, index) => <option key={preset.name} value={index}>{preset.name}</option>)}</select><input aria-label="New prescription macro" value={macro} onChange={(event) => setMacro(event.target.value)} placeholder=".macro | drug | instructions" className="input text-xs py-1.5 flex-1 min-w-48" /><button type="button" onClick={save} className="btn-secondary rounded-[7px] text-xs py-1.5 px-2.5">Save preset</button></div></div>;
}
