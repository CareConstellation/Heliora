'use client';

import { useEffect, useId, useState } from 'react';
import type { DiagnosisCode } from '@/types';
import { frequentDiagnoses, rememberDiagnosis, searchDiagnoses } from '@/lib/diagnosisSearch';

interface Props {
  value: DiagnosisCode | null;
  onChange: (value: DiagnosisCode | null) => void;
  debounceMs?: number;
}

export default function DiagnosisCodeInput({ value, onChange, debounceMs = 150 }: Props) {
  const listId = useId();
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), debounceMs);
    return () => clearTimeout(t);
  }, [text, debounceMs]);

  const options = open ? (debounced ? searchDiagnoses(debounced) : frequentDiagnoses()) : [];

  function select(dx: DiagnosisCode) {
    rememberDiagnosis(dx);
    onChange(dx);
    setText('');
    setDebounced('');
    setOpen(false);
  }

  return (
    <div className="relative">
      {value && (
        <p className="mb-1 text-xs text-text-1" data-testid="selected-diagnosis">
          {value.display}{' '}
          <span className="font-mono text-text-3">
            ({value.system} {value.code})
          </span>{' '}
          <button type="button" onClick={() => onChange(null)} className="text-text-3 underline">
            Clear
          </button>
        </p>
      )}
      <input
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Diagnosis code search"
        placeholder="Search ICD-10 / SNOMED CT…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="w-full rounded-md border border-border px-3 py-2 text-sm bg-surface-inset text-text-1 focus:outline-none focus:ring-2 focus:ring-border-focus"
      />
      {options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface-card shadow-card max-h-56 overflow-auto"
        >
          {options.map((dx) => (
            <li
              key={`${dx.system}:${dx.code}`}
              role="option"
              aria-selected={value?.code === dx.code && value.system === dx.system}
              // mousedown fires before the input's blur closes the list
              onMouseDown={(e) => {
                e.preventDefault();
                select(dx);
              }}
              className="cursor-pointer px-3 py-1.5 text-xs text-text-1 hover:bg-surface-hover"
            >
              {dx.display}{' '}
              <span className="font-mono text-text-3">
                {dx.system} {dx.code}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
