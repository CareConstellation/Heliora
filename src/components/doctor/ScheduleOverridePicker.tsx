'use client';

import { useState } from 'react';
import { CalendarOff, Plus, Trash2 } from 'lucide-react';
import {
  formatMinutes,
  parseDateKey,
  toDateKey,
  upsertOverride,
  validateOverride,
} from '@/lib/scheduleTemplates';
import type { DateOverride, DateOverrideKind } from '@/types';

const KIND_LABELS: Record<DateOverrideKind, string> = {
  holiday: 'Holiday (day off)',
  conference: 'Clinical conference leave (day off)',
  custom: 'Custom hours',
};

function timeToMinutes(value: string): number {
  const [h = '0', m = '0'] = value.split(':');
  return Number(h) * 60 + Number(m);
}

export interface ScheduleOverridePickerProps {
  overrides: DateOverride[];
  onChange: (overrides: DateOverride[]) => void;
}

/** Date-specific exceptions to the weekly template (holidays, conference leave, custom hours). */
export default function ScheduleOverridePicker({
  overrides,
  onChange,
}: ScheduleOverridePickerProps) {
  const [date, setDate] = useState('');
  const [kind, setKind] = useState<DateOverrideKind>('holiday');
  const [label, setLabel] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('13:00');
  const [error, setError] = useState<string | null>(null);

  const today = toDateKey(new Date());

  function add() {
    const override: DateOverride = {
      date,
      kind,
      label: label.trim(),
      ...(kind === 'custom'
        ? { blocks: [{ startMinute: timeToMinutes(start), endMinute: timeToMinutes(end) }] }
        : {}),
    };
    const problem = validateOverride(override);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    onChange(upsertOverride(overrides, override));
    setDate('');
    setLabel('');
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-text-1 flex items-center gap-1.5">
        <CalendarOff className="w-3.5 h-3.5" /> Date overrides
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-2xs text-text-2">
          Date
          <input
            type="date"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-xs text-text-1"
          />
        </label>
        <label className="text-2xs text-text-2">
          Type
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as DateOverrideKind)}
            className="mt-1 w-full rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-xs text-text-1"
          >
            {(Object.keys(KIND_LABELS) as DateOverrideKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-2xs text-text-2 sm:col-span-2">
          Label
          <input
            type="text"
            value={label}
            placeholder="e.g. Christmas Day, ESC Congress"
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-xs text-text-1"
          />
        </label>
        {kind === 'custom' && (
          <>
            <label className="text-2xs text-text-2">
              From
              <input
                type="time"
                step={1800}
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-xs text-text-1"
              />
            </label>
            <label className="text-2xs text-text-2">
              To
              <input
                type="time"
                step={1800}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-xs text-text-1"
              />
            </label>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="text-2xs" style={{ color: '#F87171' }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
        style={{ background: 'var(--bg-inset)', color: 'var(--text-1)' }}
      >
        <Plus className="w-3.5 h-3.5" /> Add override
      </button>

      {overrides.length > 0 && (
        <ul className="space-y-1" aria-label="Scheduled overrides">
          {overrides.map((o) => (
            <li
              key={o.date}
              className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs"
              style={{ background: 'var(--bg-inset)' }}
            >
              <span className="text-text-1">
                {parseDateKey(o.date)?.toLocaleDateString() ?? o.date} · {o.label}
              </span>
              <span className="text-text-3">
                {o.kind === 'custom'
                  ? (o.blocks ?? [])
                      .map((b) => `${formatMinutes(b.startMinute)}–${formatMinutes(b.endMinute)}`)
                      .join(', ')
                  : o.kind === 'holiday'
                    ? 'Holiday'
                    : 'Conference'}
              </span>
              <button
                type="button"
                aria-label={`Remove override ${o.label}`}
                onClick={() => onChange(overrides.filter((x) => x.date !== o.date))}
                className="text-text-3 hover:text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
