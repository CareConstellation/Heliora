import MiniSearch from 'minisearch';
import type { MedicalRecord } from '@/types';

export interface RecordFilters {
  /** Inclusive ISO dates (YYYY-MM-DD). */
  from?: string;
  to?: string;
  specialty?: string;
  classification?: string;
}

/**
 * In-memory full-text index over decrypted records. It is never serialized, so no
 * plaintext leaves the heap; drop the reference to discard it.
 */
export function createRecordIndex(records: MedicalRecord[]) {
  const index = new MiniSearch<MedicalRecord>({
    fields: ['diagnosis', 'prescription', 'notes', 'doctorName'],
    searchOptions: { prefix: true, fuzzy: 0.2, boost: { diagnosis: 2 } },
  });
  index.addAll(records);
  const byId = new Map(records.map((r) => [r.id, r]));

  return (query: string, filters: RecordFilters = {}): MedicalRecord[] => {
    const hits = query.trim() ? index.search(query).map((h) => byId.get(h.id)!) : records;
    const to = filters.to ? Date.parse(filters.to) + 86_400_000 : Infinity; // end of day
    const from = filters.from ? Date.parse(filters.from) : -Infinity;
    return hits.filter((r) => {
      const t = Date.parse(r.date);
      return (
        t >= from &&
        t < to &&
        (!filters.specialty || r.providerSpecialty === filters.specialty) &&
        (!filters.classification || r.classification === filters.classification)
      );
    });
  };
}
