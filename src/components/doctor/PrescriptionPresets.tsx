'use client';

import { useEffect, useState } from 'react';

export interface PrescriptionPreset {
  id: string;
  name: string;
  drug: string;
  dosage: string;
  frequency: string;
  instructions: string;
  macroKeyword: string;
  scope: 'personal' | 'department';
  department?: string;
  clinicalNotes?: string;
}

const STORAGE_KEY = 'heliora-prescription-presets-v2';

export const DEFAULT_PRESETS: PrescriptionPreset[] = [
  {
    id: 'p1',
    name: 'Hypertension Starter (Cardiology)',
    drug: 'Amlodipine',
    dosage: '5mg',
    frequency: 'Once daily (PO)',
    instructions: 'Take in the morning with water. Monitor for peripheral edema.',
    macroKeyword: 'htn',
    scope: 'department',
    department: 'Cardiology',
    clinicalNotes:
      'Standard Hypertension Protocol: BP monitored seated after 5m rest. Target < 130/80 mmHg. Lifestyle modifications discussed (DASH diet, sodium < 2g/day). Follow-up in 4 weeks.',
  },
  {
    id: 'p2',
    name: 'Type 2 Diabetes 1st Line (Endocrinology)',
    drug: 'Metformin',
    dosage: '500mg',
    frequency: 'Twice daily with meals (PO)',
    instructions: 'Take with morning and evening meals to minimize GI upset. Check eGFR annually.',
    macroKeyword: 'dm2',
    scope: 'department',
    department: 'Endocrinology',
    clinicalNotes:
      'Type 2 Diabetes Mellitus Management: Monitored HbA1c and fasting blood glucose. Patient counseled on hypoglycemic awareness and diet adherence.',
  },
  {
    id: 'p3',
    name: 'Acute Bacterial Infection (General Medicine)',
    drug: 'Amoxicillin / Clavulanate',
    dosage: '875/125mg',
    frequency: 'Twice daily for 7 days (PO)',
    instructions: 'Complete full 7-day course. Take at the start of a meal.',
    macroKeyword: 'amox',
    scope: 'department',
    department: 'General Medicine',
    clinicalNotes:
      'Acute Bacterial Infection: Completed clinical evaluation, no penicillin allergy reported. Advised probiotic co-therapy.',
  },
  {
    id: 'p4',
    name: 'Asthma / Bronchospasm Rescue (Pulmonology)',
    drug: 'Albuterol HFA',
    dosage: '90mcg/actuation',
    frequency: '1-2 puffs every 4-6 hours PRN',
    instructions: 'Inhale using spacer. Rinse mouth after use.',
    macroKeyword: 'asthma',
    scope: 'department',
    department: 'Pulmonology',
    clinicalNotes:
      'Asthma Exacerbation Protocol: Peak flow measured. Asthmatic action plan reviewed with patient.',
  },
];

export default function PrescriptionPresets({
  onApply,
  onApplyMacro,
}: {
  onApply: (preset: PrescriptionPreset) => void;
  onApplyMacro?: (macroKeyword: string, notes: string) => void;
}) {
  const [presets, setPresets] = useState<PrescriptionPreset[]>(DEFAULT_PRESETS);
  const [activeTab, setActiveTab] = useState<'all' | 'personal' | 'department'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [department, setDepartment] = useState('General Medicine');

  // New preset form
  const [name, setName] = useState('');
  const [drug, setDrug] = useState('');
  const [dosage, setDosage] = useState('');
  const [frequency, setFrequency] = useState('');
  const [instructions, setInstructions] = useState('');
  const [macroKeyword, setMacroKeyword] = useState('');
  const [scope, setScope] = useState<'personal' | 'department'>('department');
  const [clinicalNotes, setClinicalNotes] = useState('');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPresets(parsed);
        }
      }
    } catch {
      // Use defaults
    }
  }, []);

  function savePresets(newPresets: PrescriptionPreset[]) {
    setPresets(newPresets);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newPresets));
  }

  function handleAddPreset(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !drug.trim()) return;

    const newPreset: PrescriptionPreset = {
      id: `preset_${Date.now()}`,
      name: name.trim(),
      drug: drug.trim(),
      dosage: dosage.trim() || 'Standard',
      frequency: frequency.trim() || 'Once daily',
      instructions: instructions.trim() || 'As directed',
      macroKeyword: macroKeyword.trim().toLowerCase().replace(/^\./, '') || name.toLowerCase().slice(0, 4),
      scope,
      department: scope === 'department' ? department : undefined,
      clinicalNotes: clinicalNotes.trim(),
    };

    savePresets([...presets, newPreset]);
    setShowAddModal(false);
    resetForm();
  }

  function resetForm() {
    setName('');
    setDrug('');
    setDosage('');
    setFrequency('');
    setInstructions('');
    setMacroKeyword('');
    setClinicalNotes('');
  }

  const filteredPresets = presets.filter((p) => {
    if (activeTab === 'personal') return p.scope === 'personal';
    if (activeTab === 'department') return p.scope === 'department';
    return true;
  });

  return (
    <div className="rounded-lg p-3 mb-3 bg-surface-inset border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-1">Formulary Presets & Phrase Macros</span>
          <div className="flex rounded bg-surface-card p-0.5 text-2xs border border-border">
            {(['all', 'personal', 'department'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-2 py-0.5 rounded capitalize transition-colors ${
                  activeTab === tab ? 'bg-primary-500 text-white font-medium' : 'text-text-3 hover:text-text-1'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="text-2xs text-primary-400 hover:text-primary-300 font-medium"
        >
          + Create Preset / Macro
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Prescription formulary presets"
          className="input text-xs py-1.5 flex-1 min-w-56 bg-surface-card"
          defaultValue=""
          onChange={(e) => {
            const selected = presets.find((p) => p.id === e.target.value);
            if (selected) onApply(selected);
          }}
        >
          <option value="" disabled>
            ⚡ Select formulary preset to autofill dosage & instructions…
          </option>
          {filteredPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              [{preset.scope === 'department' ? preset.department || 'Dept' : 'Personal'}] {preset.name} — {preset.drug} ({preset.dosage}) (.{preset.macroKeyword})
            </option>
          ))}
        </select>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-2xs text-text-3">
        <span className="font-semibold text-text-2">Shorthand macros:</span>
        {presets.slice(0, 6).map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              onApply(preset);
              if (preset.clinicalNotes && onApplyMacro) {
                onApplyMacro(preset.macroKeyword, preset.clinicalNotes);
              }
            }}
            className="px-1.5 py-0.5 rounded bg-surface-card border border-border font-mono text-primary-400 hover:bg-primary-500/10 transition-colors"
            title={`${preset.name}: Click to autofill (${preset.drug})`}
          >
            .{preset.macroKeyword}
          </button>
        ))}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-surface-card border border-border p-5 shadow-xl space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-text-1">New Formulary Preset & Clinical Macro</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-text-3 hover:text-text-1 text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddPreset} className="space-y-3 text-xs">
              <div>
                <label className="block text-text-2 mb-1">Preset Name *</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Hypertension Step 1"
                  className="w-full input py-1.5 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-text-2 mb-1">Drug Name *</label>
                  <input
                    required
                    value={drug}
                    onChange={(e) => setDrug(e.target.value)}
                    placeholder="e.g. Lisinopril"
                    className="w-full input py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-text-2 mb-1">Dosage</label>
                  <input
                    value={dosage}
                    onChange={(e) => setDosage(e.target.value)}
                    placeholder="e.g. 10mg"
                    className="w-full input py-1.5 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-text-2 mb-1">Frequency</label>
                  <input
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value)}
                    placeholder="e.g. Once daily PO"
                    className="w-full input py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-text-2 mb-1">Macro Trigger (.key)</label>
                  <input
                    value={macroKeyword}
                    onChange={(e) => setMacroKeyword(e.target.value)}
                    placeholder="e.g. lisi"
                    className="w-full input py-1.5 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-text-2 mb-1">Patient Instructions</label>
                <input
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="e.g. Take with water in morning"
                  className="w-full input py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="block text-text-2 mb-1">Sharing Scope</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="scope"
                      checked={scope === 'department'}
                      onChange={() => setScope('department')}
                    />
                    <span>Department Shared</span>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="scope"
                      checked={scope === 'personal'}
                      onChange={() => setScope('personal')}
                    />
                    <span>Personal Only</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-text-2 mb-1">Expanded Clinical Notes Macro (Optional)</label>
                <textarea
                  rows={2}
                  value={clinicalNotes}
                  onChange={(e) => setClinicalNotes(e.target.value)}
                  placeholder="Standard treatment note template expanded when .macro is typed…"
                  className="w-full input py-1.5 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn-secondary rounded py-1.5 px-3 text-xs"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary rounded py-1.5 px-3 text-xs font-semibold">
                  Save & Share Preset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
