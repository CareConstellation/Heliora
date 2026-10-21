import MiniSearch from 'minisearch';
import type { DiagnosisCode } from '@/types';
import { DIAGNOSIS_CODES } from '@/data/diagnosisCodes';

const FREQUENT_KEY = 'heliora:frequent-diagnoses';
const idOf = (d: DiagnosisCode) => `${d.system}:${d.code}`;

const index = new MiniSearch<DiagnosisCode & { id: string }>({
  fields: ['code', 'display'],
  storeFields: ['code', 'system', 'display'],
  searchOptions: { prefix: true, fuzzy: 0.2 },
});
index.addAll(DIAGNOSIS_CODES.map((d) => ({ ...d, id: idOf(d) })));

export function searchDiagnoses(query: string, limit = 8): DiagnosisCode[] {
  return index
    .search(query)
    .slice(0, limit)
    .map(({ code, system, display }) => ({ code, system, display }));
}

type Counts = Record<string, { dx: DiagnosisCode; n: number }>;

function readCounts(): Counts {
  try {
    return JSON.parse(localStorage.getItem(FREQUENT_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** Counts a selection so it surfaces in {@link frequentDiagnoses} (kept on-device, offline). */
export function rememberDiagnosis(dx: DiagnosisCode) {
  const counts = readCounts();
  const id = idOf(dx);
  counts[id] = { dx, n: (counts[id]?.n ?? 0) + 1 };
  try {
    localStorage.setItem(FREQUENT_KEY, JSON.stringify(counts));
  } catch {
    // storage full or unavailable: frequent list is best-effort
  }
}

export function frequentDiagnoses(limit = 5): DiagnosisCode[] {
  return Object.values(readCounts())
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((e) => e.dx);
}
