import { useMemo, useState } from 'react';
import type { MedicalRecord } from '@/types';
import { createRecordIndex, type RecordFilters } from '@/lib/recordSearch';

const facet = (records: MedicalRecord[], key: 'providerSpecialty' | 'classification') =>
  [...new Set(records.map((r) => r[key]).filter(Boolean))] as string[];

/** Search state + results over `records`; the index is rebuilt in memory when they change. */
export function useRecordSearch(records: MedicalRecord[]) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<RecordFilters>({});
  const search = useMemo(() => createRecordIndex(records), [records]);
  const results = useMemo(() => search(query, filters), [search, query, filters]);
  const specialties = useMemo(() => facet(records, 'providerSpecialty'), [records]);
  const classifications = useMemo(() => facet(records, 'classification'), [records]);
  return { query, setQuery, filters, setFilters, results, specialties, classifications };
}

export type RecordSearchState = ReturnType<typeof useRecordSearch>;
