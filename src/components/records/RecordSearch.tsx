'use client';

import type { RecordFilters } from '@/lib/recordSearch';
import type { RecordSearchState } from '@/hooks/useRecordSearch';

const input =
  'rounded-md border border-border bg-surface-inset px-2.5 py-1.5 text-xs text-text-1 focus:outline-none focus:ring-2 focus:ring-border-focus';

export default function RecordSearch({ search }: { search: RecordSearchState }) {
  const { query, setQuery, setFilters, specialties, classifications } = search;
  const setFilter = (key: keyof RecordFilters) => (e: { target: { value: string } }) =>
    setFilters((f) => ({ ...f, [key]: e.target.value || undefined }));

  return (
    <div className="px-5 py-3 flex flex-wrap items-center gap-2" role="search">
      <input
        type="search"
        aria-label="Search records"
        placeholder="Search diagnoses, prescriptions, notes…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={`${input} flex-1 min-w-[180px]`}
      />
      <input type="date" aria-label="From date" onChange={setFilter('from')} className={input} />
      <input type="date" aria-label="To date" onChange={setFilter('to')} className={input} />
      <select aria-label="Specialty" onChange={setFilter('specialty')} className={input}>
        <option value="">All specialties</option>
        {specialties.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <select aria-label="Classification" onChange={setFilter('classification')} className={input}>
        <option value="">All classifications</option>
        {classifications.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </div>
  );
}
