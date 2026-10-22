import type {
  BulkRecordImportRow,
  MedicalRecord,
  HelioraObservation,
  BiometricMetricCategory,
  BiometricImportFilter,
  BiometricImportSummary,
} from '@/types';
import { validateFHIRBundle } from '@/lib/fhirValidator';
import { bulkImportRecords, rollbackBatchRecords } from '@/services/api.service';

/**
 * Robust RFC 4180 CSV parser supporting quoted cells with commas, newlines, and escaped quotes.
 */
export function parseCSV(text: string): BulkRecordImportRow[] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentCell += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // skip LF after CR
      }
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length < 2) {
    throw new Error('CSV file must have a header row and at least one data row.');
  }

  const headerRow = rows[0];
  if (!headerRow) {
    throw new Error('CSV file must have a header row and at least one data row.');
  }

  const headers = headerRow.map((h) => h.toLowerCase().replace(/[\s_-]+/g, ''));
  const dateIdx = headers.findIndex((h) => h === 'date');
  const doctorIdx = headers.findIndex(
    (h) => h === 'doctorname' || h === 'doctor' || h === 'physician' || h === 'provider',
  );
  const diagnosisIdx = headers.findIndex((h) => h === 'diagnosis' || h === 'condition');
  const prescriptionIdx = headers.findIndex((h) => h === 'prescription' || h === 'medication' || h === 'drug');
  const notesIdx = headers.findIndex((h) => h === 'notes' || h === 'note' || h === 'clinicalnotes');

  if (dateIdx === -1 || doctorIdx === -1 || diagnosisIdx === -1) {
    throw new Error(
      'CSV must contain at least "date", "doctorName", and "diagnosis" columns. Found: ' +
        headerRow.join(', '),
    );
  }

  const records: BulkRecordImportRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    if (!cols) continue;
    const row: BulkRecordImportRow = {
      date: cols[dateIdx] || '',
      doctorName: cols[doctorIdx] || '',
      diagnosis: cols[diagnosisIdx] || '',
    };
    if (prescriptionIdx >= 0 && cols[prescriptionIdx]) {
      row.prescription = cols[prescriptionIdx];
    }
    if (notesIdx >= 0 && cols[notesIdx]) {
      row.notes = cols[notesIdx];
    }
    records.push(row);
  }
  return records;
}

export function parseFHIR(json: Record<string, unknown>): BulkRecordImportRow[] {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid JSON format: expected an object.');
  }

  const entries = (json.entry as Array<Record<string, unknown>>) ?? [];
  if (entries.length === 0) {
    throw new Error('FHIR bundle contains no entries.');
  }

  return entries.map((entry) => {
    const resource = (entry.resource ?? {}) as Record<string, unknown>;
    const codeText = (
      (resource.code as Record<string, unknown> | undefined)?.coding as Array<Record<string, unknown>> | undefined
    )?.[0]?.display as string | undefined;

    const row: BulkRecordImportRow = {
      date: (resource.date as string) || (resource.effectiveDateTime as string) || '',
      doctorName:
        ((resource.performer as Array<Record<string, unknown>> | undefined)?.[0]?.display as string) || '',
      diagnosis:
        codeText ||
        ((resource.reasonCode as Array<Record<string, unknown>> | undefined)?.[0]?.text as string) ||
        '',
    };

    const notesList = resource.note as Array<Record<string, unknown>> | undefined;
    if (notesList?.[0]?.text) {
      row.notes = notesList[0].text as string;
    }

    return row;
  });
}

export interface PreviewRow extends BulkRecordImportRow {
  _row: number;
  _valid: boolean;
  _errors: string[];
}

/**
 * OWASP CSV Injection: spreadsheet apps run cells starting with these characters
 * (including full-width variants) as formulas, which can execute commands.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/;

/**
 * Validates date formats: ISO 8601 (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss) or standard parseable dates.
 */
export function isValidDate(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const trimmed = dateStr.trim();
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return false;
  const d = new Date(parsed);
  if (Number.isNaN(d.getTime())) return false;
  const year = d.getFullYear();
  return year >= 1900 && year <= 2100;
}

export function validateRow(row: BulkRecordImportRow, idx: number): PreviewRow {
  const errors: string[] = [];

  // Required clinical fields & formats
  if (!row.date || !row.date.trim()) {
    errors.push('Missing date');
  } else if (!isValidDate(row.date)) {
    errors.push('Invalid date format (must be valid YYYY-MM-DD or ISO 8601)');
  }

  if (!row.doctorName || !row.doctorName.trim()) {
    errors.push('Missing doctorName');
  } else if (row.doctorName.trim().length < 2) {
    errors.push('doctorName must be at least 2 characters');
  }

  if (!row.diagnosis || !row.diagnosis.trim()) {
    errors.push('Missing diagnosis');
  }

  // OWASP CSV Injection check
  for (const [field, value] of Object.entries(row)) {
    if (typeof value === 'string' && FORMULA_PREFIX.test(value)) {
      errors.push(`Possible spreadsheet formula (macro) in ${field}`);
    }
  }

  return { ...row, _row: idx + 1, _valid: errors.length === 0, _errors: errors };
}

/**
 * Worker-based chunked validation for up to 5,000 records without blocking the main UI thread.
 */
export async function validateRowsChunked(
  rows: BulkRecordImportRow[],
  chunkSize = 250,
  onProgress?: (processed: number, total: number) => void,
): Promise<PreviewRow[]> {
  const total = rows.length;
  const results: PreviewRow[] = [];

  for (let i = 0; i < total; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j];
      if (row) {
        results.push(validateRow(row, i + j));
      }
    }
    onProgress?.(results.length, total);
    // Yield to the event loop so UI does not freeze during large 5,000-row imports
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return results;
}

export interface PreFlightAnalysis {
  total: number;
  validCount: number;
  errorCount: number;
  errorsByField: Record<string, number>;
  errors: Array<{ row: number; field: string; message: string }>;
}

export function analyzeErrors(previewRows: PreviewRow[]): PreFlightAnalysis {
  const errorsByField: Record<string, number> = {};
  const errorDetails: Array<{ row: number; field: string; message: string }> = [];

  for (const row of previewRows) {
    if (!row._valid && row._errors) {
      for (const err of row._errors) {
        let field = 'general';
        if (err.toLowerCase().includes('date')) field = 'date';
        else if (err.toLowerCase().includes('doctor')) field = 'doctorName';
        else if (err.toLowerCase().includes('diagnosis')) field = 'diagnosis';
        else if (err.toLowerCase().includes('notes')) field = 'notes';
        else if (err.toLowerCase().includes('prescription')) field = 'prescription';

        errorsByField[field] = (errorsByField[field] || 0) + 1;
        errorDetails.push({ row: row._row, field, message: err });
      }
    }
  }

  const validCount = previewRows.filter((r) => r._valid).length;
  return {
    total: previewRows.length,
    validCount,
    errorCount: previewRows.length - validCount,
    errorsByField,
    errors: errorDetails,
  };
}

export interface TransactionalBatchImportOptions {
  chunkSize?: number;
  onChunkProgress?: (completedChunks: number, totalChunks: number, importedRecords: number) => void;
  onRollbackProgress?: (rolledBack: number, totalToRollback: number) => void;
  signal?: AbortSignal;
}

/**
 * Execute batch imports in atomic chunks with full rollback on aborted sessions or chunk failures.
 */
export async function executeBatchImportWithRollback(
  patientAddress: string,
  records: BulkRecordImportRow[],
  options: TransactionalBatchImportOptions = {},
): Promise<{ success: boolean; totalImported: number; recordIds: string[] }> {
  const chunkSize = options.chunkSize || 50;
  const chunks: BulkRecordImportRow[][] = [];
  for (let i = 0; i < records.length; i += chunkSize) {
    chunks.push(records.slice(i, i + chunkSize));
  }

  const importedRecordIds: string[] = [];
  const totalChunks = chunks.length;

  try {
    for (let i = 0; i < totalChunks; i++) {
      if (options.signal?.aborted) {
        throw new Error('Import aborted by user.');
      }

      const chunk = chunks[i];
      if (!chunk) continue;
      const res = await bulkImportRecords(patientAddress, chunk);
      if (res.errors && res.errors.length > 0 && res.imported === 0) {
        throw new Error(`Chunk ${i + 1} failed: ${res.errors[0]?.message || 'Server rejected batch chunk'}`);
      }

      const newIds = res.records?.map((r: MedicalRecord) => r.id) || chunk.map((_, idx) => `record-chunk-${i}-${idx}`);
      importedRecordIds.push(...newIds);

      options.onChunkProgress?.(i + 1, totalChunks, importedRecordIds.length);
    }

    return {
      success: true,
      totalImported: importedRecordIds.length,
      recordIds: importedRecordIds,
    };
  } catch (error) {
    // Transactional rollback on aborted session or chunk failure
    if (importedRecordIds.length > 0) {
      try {
        await rollbackBatchRecords(patientAddress, importedRecordIds);
        options.onRollbackProgress?.(importedRecordIds.length, importedRecordIds.length);
      } catch (rollbackErr) {
        console.error('Failed to rollback records after partial import failure:', rollbackErr);
      }
    }
    throw error;
  }
}

export function validateFHIRJSON(json: Record<string, unknown>): { valid: boolean; errors: Array<{ field: string; message: string; lineNumber?: number }> } {
  try {
    const errors = validateFHIRBundle(json);
    return { valid: errors.length === 0, errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid FHIR JSON';
    return { valid: false, errors: [{ field: 'root', message }] };
  }
}

export function rowsToMedicalRecords(rows: BulkRecordImportRow[], patientAddress: string): MedicalRecord[] {
  return rows.map((row, idx) => {
    const record: MedicalRecord = {
      id: `record-${Date.now()}-${idx}`,
      date: row.date,
      doctorName: row.doctorName,
      diagnosis: row.diagnosis,
      patientAddress,
    };
    if (row.prescription) record.prescription = row.prescription;
    if (row.notes) record.notes = row.notes;
    return record;
  });
}

/* ── Biometric Ingestion Adapter (Issue #79) ──────────────────────────────── */

interface DailyAccumulator {
  date: string;
  restingHeartRate?: { sum: number; count: number };
  generalHeartRate?: { sum: number; count: number };
  stepCount?: { sum: number; count: number };
  sleepMinutes?: { sum: number; count: number; inBedMinutes?: number };
}

function parseTimestampMs(raw: unknown): number | null {
  if (typeof raw === 'number') {
    if (raw > 1e16) return Math.floor(raw / 1e6); // nanoseconds
    if (raw > 1e11) return Math.floor(raw); // milliseconds
    if (raw > 1e8) return Math.floor(raw * 1000); // seconds
    return null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      if (trimmed.length >= 16) {
        return parseInt(trimmed.slice(0, 13), 10);
      }
      if (trimmed.length >= 12) {
        return parseInt(trimmed, 10);
      }
      if (trimmed.length >= 9) {
        return parseInt(trimmed, 10) * 1000;
      }
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function extractDateOnly(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match && match[1]) return match[1];

  const parsed = Date.parse(dateStr);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return null;
}

function matchesFilter(
  date: string,
  category: BiometricMetricCategory,
  filter?: BiometricImportFilter,
): boolean {
  if (filter?.categories && filter.categories.length > 0 && !filter.categories.includes(category)) {
    return false;
  }
  if (filter?.startDate && date < filter.startDate) {
    return false;
  }
  if (filter?.endDate && date > filter.endDate) {
    return false;
  }
  return true;
}

/**
 * Searches for the next `<Record` tag, ensuring word/element boundary.
 */
function findNextRecordStart(text: string, fromPos: number): number {
  let pos = fromPos;
  while (pos < text.length) {
    const idx = text.indexOf('<Record', pos);
    if (idx === -1) return -1;
    const nextChar = text[idx + 7];
    if (
      nextChar === ' ' ||
      nextChar === '\n' ||
      nextChar === '\r' ||
      nextChar === '\t' ||
      nextChar === '/' ||
      nextChar === '>'
    ) {
      return idx;
    }
    pos = idx + 7;
  }
  return -1;
}

/**
 * Finds the closing `>` of an XML tag, ignoring `>` characters inside quoted attributes.
 */
function findTagClosingIndex(text: string, startIdx: number): number {
  let insideQuote = false;
  let quoteChar = '';
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if ((ch === '"' || ch === "'") && (i === 0 || text[i - 1] !== '\\')) {
      if (!insideQuote) {
        insideQuote = true;
        quoteChar = ch;
      } else if (ch === quoteChar) {
        insideQuote = false;
      }
    } else if (ch === '>' && !insideQuote) {
      return i;
    }
  }
  return -1;
}

function compileDailyObservations(
  dailyMap: Map<string, DailyAccumulator>,
  source: 'Apple Health' | 'Google Fit',
): HelioraObservation[] {
  const sortedDates = Array.from(dailyMap.keys()).sort();
  const results: HelioraObservation[] = [];

  for (const date of sortedDates) {
    const acc = dailyMap.get(date);
    if (!acc) continue;

    // Resting Heart Rate: LOINC 40443-4 (use resting HR or fallback to general HR)
    const hrRecord =
      acc.restingHeartRate && acc.restingHeartRate.count > 0
        ? acc.restingHeartRate
        : acc.generalHeartRate && acc.generalHeartRate.count > 0
          ? acc.generalHeartRate
          : null;

    if (hrRecord) {
      const avg = Math.round(hrRecord.sum / hrRecord.count);
      results.push({
        id: `obs-rhr-${date}`,
        category: 'resting_heart_rate',
        code: '40443-4',
        display: 'Resting Heart Rate',
        date,
        value: avg,
        unit: 'bpm',
        source,
        rawRecordCount: hrRecord.count,
      });
    }

    // Step Count: LOINC 55423-8
    if (acc.stepCount && acc.stepCount.count > 0) {
      const totalSteps = Math.round(acc.stepCount.sum);
      results.push({
        id: `obs-steps-${date}`,
        category: 'step_count',
        code: '55423-8',
        display: 'Daily Step Count',
        date,
        value: totalSteps,
        unit: 'steps',
        source,
        rawRecordCount: acc.stepCount.count,
      });
    }

    // Sleep: LOINC 93832-4
    if (acc.sleepMinutes) {
      const activeMinutes =
        acc.sleepMinutes.sum > 0
          ? acc.sleepMinutes.sum
          : acc.sleepMinutes.inBedMinutes || 0;
      if (activeMinutes > 0) {
        const hours = parseFloat((activeMinutes / 60).toFixed(2));
        results.push({
          id: `obs-sleep-${date}`,
          category: 'sleep',
          code: '93832-4',
          display: 'Sleep Duration',
          date,
          value: hours,
          unit: 'hours',
          source,
          rawRecordCount: acc.sleepMinutes.count || 1,
        });
      }
    }
  }

  return results;
}

export function summarizeBiometricObservations(
  observations: HelioraObservation[],
): BiometricImportSummary {
  const byCategory: Record<BiometricMetricCategory, number> = {
    resting_heart_rate: 0,
    step_count: 0,
    sleep: 0,
  };

  let earliest: string | null = null;
  let latest: string | null = null;

  for (const obs of observations) {
    byCategory[obs.category] = (byCategory[obs.category] || 0) + 1;
    if (!earliest || obs.date < earliest) earliest = obs.date;
    if (!latest || obs.date > latest) latest = obs.date;
  }

  return {
    totalRecordsProcessed: observations.reduce((acc, o) => acc + (o.rawRecordCount || 1), 0),
    totalDailyObservations: observations.length,
    byCategory,
    dateRange: { start: earliest, end: latest },
  };
}

export function filterBiometricObservations(
  observations: HelioraObservation[],
  filter?: BiometricImportFilter,
): HelioraObservation[] {
  if (!filter) return observations;
  return observations.filter((obs) => matchesFilter(obs.date, obs.category, filter));
}

export function biometricObservationsToImportRows(
  observations: HelioraObservation[],
): BulkRecordImportRow[] {
  return observations.map((obs) => ({
    date: obs.date,
    doctorName: obs.source,
    diagnosis: `${obs.display}: ${obs.value} ${obs.unit}`,
    notes: JSON.stringify({
      category: obs.category,
      code: obs.code,
      value: obs.value,
      unit: obs.unit,
      source: obs.source,
      loinc: obs.code,
      rawRecordCount: obs.rawRecordCount,
    }),
  }));
}

/**
 * Stream-parse Apple Health XML in bounded memory chunks (O(1) space).
 */
export async function streamParseAppleHealthDirect(
  file: File | Blob,
  filter?: BiometricImportFilter,
  onProgress?: (processed: number, total: number, extracted: number) => void,
  chunkSize = 256 * 1024,
): Promise<{ observations: HelioraObservation[]; summary: BiometricImportSummary }> {
  const totalBytes = file.size;
  let offset = 0;
  let remainder = '';
  const dailyMap = new Map<string, DailyAccumulator>();
  let totalRawRecordsProcessed = 0;
  let lastProgressReport = 0;

  while (offset < totalBytes) {
    const sliceEnd = Math.min(offset + chunkSize, totalBytes);
    const blobSlice = file.slice(offset, sliceEnd);
    const chunkText = await blobSlice.text();
    const text = remainder + chunkText;
    offset = sliceEnd;

    let pos = 0;
    while (true) {
      const startIdx = findNextRecordStart(text, pos);
      if (startIdx === -1) {
        const lastLt = text.lastIndexOf('<');
        if (lastLt >= pos && lastLt > text.length - 15) {
          remainder = text.slice(lastLt);
        } else {
          remainder = '';
        }
        break;
      }

      const endIdx = findTagClosingIndex(text, startIdx);
      if (endIdx === -1) {
        remainder = text.slice(startIdx);
        break;
      }

      const tag = text.slice(startIdx, endIdx + 1);
      pos = endIdx + 1;

      // Extract type quickly
      const typeMatch = tag.match(/type="([^"]*)"/);
      if (!typeMatch || !typeMatch[1]) continue;
      const type = typeMatch[1];

      if (
        type !== 'HKQuantityTypeIdentifierRestingHeartRate' &&
        type !== 'HKQuantityTypeIdentifierHeartRate' &&
        type !== 'HKQuantityTypeIdentifierStepCount' &&
        type !== 'HKCategoryTypeIdentifierSleepAnalysis'
      ) {
        continue;
      }

      totalRawRecordsProcessed++;

      const startDateMatch = tag.match(/startDate="([^"]*)"/);
      const endDateMatch = tag.match(/endDate="([^"]*)"/);
      const valueMatch = tag.match(/value="([^"]*)"/);

      const startDateStr = startDateMatch && startDateMatch[1] ? startDateMatch[1] : '';
      const endDateStr = endDateMatch && endDateMatch[1] ? endDateMatch[1] : startDateStr;
      const rawValue = valueMatch && valueMatch[1] ? valueMatch[1] : '';

      if (type === 'HKQuantityTypeIdentifierRestingHeartRate') {
        const date = extractDateOnly(startDateStr);
        if (date && matchesFilter(date, 'resting_heart_rate', filter)) {
          const val = parseFloat(rawValue);
          if (!Number.isNaN(val) && val >= 30 && val <= 220) {
            let acc = dailyMap.get(date);
            if (!acc) {
              acc = { date };
              dailyMap.set(date, acc);
            }
            if (!acc.restingHeartRate) {
              acc.restingHeartRate = { sum: val, count: 1 };
            } else {
              acc.restingHeartRate.sum += val;
              acc.restingHeartRate.count += 1;
            }
          }
        }
      } else if (type === 'HKQuantityTypeIdentifierHeartRate') {
        const date = extractDateOnly(startDateStr);
        if (date && matchesFilter(date, 'resting_heart_rate', filter)) {
          const val = parseFloat(rawValue);
          if (!Number.isNaN(val) && val >= 30 && val <= 220) {
            let acc = dailyMap.get(date);
            if (!acc) {
              acc = { date };
              dailyMap.set(date, acc);
            }
            if (!acc.generalHeartRate) {
              acc.generalHeartRate = { sum: val, count: 1 };
            } else {
              acc.generalHeartRate.sum += val;
              acc.generalHeartRate.count += 1;
            }
          }
        }
      } else if (type === 'HKQuantityTypeIdentifierStepCount') {
        const date = extractDateOnly(startDateStr);
        if (date && matchesFilter(date, 'step_count', filter)) {
          const val = parseFloat(rawValue);
          if (!Number.isNaN(val) && val >= 0) {
            let acc = dailyMap.get(date);
            if (!acc) {
              acc = { date };
              dailyMap.set(date, acc);
            }
            if (!acc.stepCount) {
              acc.stepCount = { sum: val, count: 1 };
            } else {
              acc.stepCount.sum += val;
              acc.stepCount.count += 1;
            }
          }
        }
      } else if (type === 'HKCategoryTypeIdentifierSleepAnalysis') {
        const date = extractDateOnly(endDateStr);
        if (date && matchesFilter(date, 'sleep', filter)) {
          const startMs = Date.parse(startDateStr);
          const endMs = Date.parse(endDateStr);
          if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs) {
            const durationMin = (endMs - startMs) / 60000;
            if (durationMin > 0 && durationMin <= 24 * 60) {
              let acc = dailyMap.get(date);
              if (!acc) {
                acc = { date };
                dailyMap.set(date, acc);
              }
              if (!acc.sleepMinutes) {
                acc.sleepMinutes = { sum: 0, count: 0, inBedMinutes: 0 };
              }

              const isAsleep =
                rawValue.includes('Asleep') ||
                rawValue === '1' ||
                rawValue === '3' ||
                rawValue === '4' ||
                rawValue === '5';
              const isInBed =
                rawValue.includes('InBed') ||
                rawValue === '0';

              if (isAsleep) {
                acc.sleepMinutes.sum += durationMin;
                acc.sleepMinutes.count += 1;
              } else if (isInBed) {
                acc.sleepMinutes.inBedMinutes =
                  (acc.sleepMinutes.inBedMinutes || 0) + durationMin;
              }
            }
          }
        }
      }
    }

    if (offset - lastProgressReport >= 1024 * 1024 || offset >= totalBytes) {
      lastProgressReport = offset;
      onProgress?.(offset, totalBytes, totalRawRecordsProcessed);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const observations = compileDailyObservations(dailyMap, 'Apple Health');
  const summary = summarizeBiometricObservations(observations);
  summary.totalRecordsProcessed = totalRawRecordsProcessed;

  return { observations, summary };
}

/**
 * Stream-parses Apple Health XML using a dedicated Web Worker when in a browser,
 * falling back to direct chunked stream parsing if workers are not supported.
 */
export async function streamParseAppleHealthXML(
  file: File,
  filter?: BiometricImportFilter,
  onProgress?: (processed: number, total: number, extracted: number) => void,
): Promise<{ observations: HelioraObservation[]; summary: BiometricImportSummary }> {
  if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
    try {
      return await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./biometricParser.worker.ts', import.meta.url), {
          type: 'module',
        });
        const requestId = `ah_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        worker.addEventListener('message', (e) => {
          const data = e.data;
          if (!data || data.id !== requestId) return;

          if (data.op === 'progress') {
            onProgress?.(data.processedBytes, data.totalBytes, data.recordsExtracted);
          } else if (data.op === 'success') {
            worker.terminate();
            resolve({ observations: data.observations, summary: data.summary });
          } else if (data.op === 'error') {
            worker.terminate();
            reject(new Error(data.message));
          }
        });

        worker.addEventListener('error', (err) => {
          worker.terminate();
          reject(new Error(err.message || 'Biometric parser worker error'));
        });

        worker.postMessage({
          id: requestId,
          op: 'parseAppleHealth',
          file,
          filter,
        });
      });
    } catch {
      // Fallback to direct stream parsing
    }
  }

  return streamParseAppleHealthDirect(file, filter, onProgress);
}

/**
 * Parses Google Takeout Google Fit exports (fit.json) into daily Heliora observations.
 */
export function parseGoogleFitJSON(
  content: string | Record<string, unknown> | Array<Record<string, unknown>>,
  filter?: BiometricImportFilter,
): { observations: HelioraObservation[]; summary: BiometricImportSummary } {
  let parsed: unknown;
  if (typeof content === 'string') {
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('Invalid Google Fit JSON: Unable to parse file content.');
    }
  } else {
    parsed = content;
  }

  const dailyMap = new Map<string, DailyAccumulator>();
  let totalRawRecordsProcessed = 0;
  const root = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;

  let points: Array<Record<string, unknown>> = [];

  if (Array.isArray(parsed)) {
    points = parsed as Array<Record<string, unknown>>;
  } else if (Array.isArray(root.point)) {
    points = root.point as Array<Record<string, unknown>>;
  } else if (Array.isArray(root.dataPoints)) {
    points = root.dataPoints as Array<Record<string, unknown>>;
  } else if (Array.isArray(root['Data Points'])) {
    points = root['Data Points'] as Array<Record<string, unknown>>;
  } else if (Array.isArray(root.bucket)) {
    for (const b of root.bucket as Array<Record<string, unknown>>) {
      if (b && Array.isArray(b.dataset)) {
        for (const ds of b.dataset as Array<Record<string, unknown>>) {
          if (ds && Array.isArray(ds.point)) {
            points.push(...(ds.point as Array<Record<string, unknown>>));
          }
        }
      }
    }
  }

  for (const pt of points) {
    if (!pt) continue;
    totalRawRecordsProcessed++;
    const type =
      typeof pt.dataTypeName === 'string'
        ? pt.dataTypeName
        : typeof pt.type === 'string'
          ? pt.type
          : '';

    let dateStr: string | null = null;
    let startMs: number | null = null;
    let endMs: number | null = null;

    if (pt.startTimeNanos || pt.endTimeNanos) {
      endMs = parseTimestampMs(pt.endTimeNanos || pt.startTimeNanos);
      if (endMs !== null) {
        dateStr = new Date(endMs).toISOString().slice(0, 10);
      }
      if (pt.startTimeNanos) {
        startMs = parseTimestampMs(pt.startTimeNanos);
      }
    } else if (pt.date || pt.timestamp || pt.startTime) {
      const rawDate = (pt.date || pt.timestamp || pt.startTime) as string;
      dateStr = extractDateOnly(rawDate);
      startMs = parseTimestampMs(rawDate);
      endMs = startMs;
    }

    if (!dateStr) continue;

    // Heart rate
    if (
      type.includes('heart_rate') ||
      pt.resting_heart_rate !== undefined ||
      pt.heart_rate !== undefined
    ) {
      if (matchesFilter(dateStr, 'resting_heart_rate', filter)) {
        let val = 0;
        const isResting = type.includes('resting') || pt.resting_heart_rate !== undefined;

        if (Array.isArray(pt.value) && pt.value[0]) {
          const v = pt.value[0] as Record<string, unknown>;
          val = typeof v.fpVal === 'number' ? v.fpVal : typeof v.intVal === 'number' ? v.intVal : 0;
        } else if (typeof pt.resting_heart_rate === 'number') {
          val = pt.resting_heart_rate;
        } else if (typeof pt.heart_rate === 'number') {
          val = pt.heart_rate;
        }

        if (val >= 30 && val <= 220) {
          let acc = dailyMap.get(dateStr);
          if (!acc) {
            acc = { date: dateStr };
            dailyMap.set(dateStr, acc);
          }

          if (isResting) {
            if (!acc.restingHeartRate) {
              acc.restingHeartRate = { sum: val, count: 1 };
            } else {
              acc.restingHeartRate.sum += val;
              acc.restingHeartRate.count += 1;
            }
          } else {
            if (!acc.generalHeartRate) {
              acc.generalHeartRate = { sum: val, count: 1 };
            } else {
              acc.generalHeartRate.sum += val;
              acc.generalHeartRate.count += 1;
            }
          }
        }
      }
    }

    // Step Count
    if (type.includes('step_count') || pt.steps !== undefined || pt.step_count !== undefined) {
      if (matchesFilter(dateStr, 'step_count', filter)) {
        let val = 0;
        if (Array.isArray(pt.value) && pt.value[0]) {
          const v = pt.value[0] as Record<string, unknown>;
          val = typeof v.intVal === 'number' ? v.intVal : typeof v.fpVal === 'number' ? v.fpVal : 0;
        } else if (typeof pt.steps === 'number') {
          val = pt.steps;
        } else if (typeof pt.step_count === 'number') {
          val = pt.step_count;
        }

        if (val >= 0) {
          let acc = dailyMap.get(dateStr);
          if (!acc) {
            acc = { date: dateStr };
            dailyMap.set(dateStr, acc);
          }
          if (!acc.stepCount) {
            acc.stepCount = { sum: val, count: 1 };
          } else {
            acc.stepCount.sum += val;
            acc.stepCount.count += 1;
          }
        }
      }
    }

    // Sleep
    if (
      type.includes('sleep') ||
      pt.activityType === 72 ||
      pt.sleep_duration_minutes !== undefined ||
      pt.sleep_duration_hours !== undefined
    ) {
      if (matchesFilter(dateStr, 'sleep', filter)) {
        let isAsleep = true;
        if (Array.isArray(pt.value) && pt.value[0]) {
          const v = pt.value[0] as Record<string, unknown>;
          const stage = typeof v.intVal === 'number' ? v.intVal : typeof v.fpVal === 'number' ? v.fpVal : null;
          // In Google Fit: 1 = AWAKE, 3 = OUT_OF_BED
          if (stage === 1 || stage === 3) {
            isAsleep = false;
          }
        }

        if (isAsleep) {
          let durationMinutes = 0;
          if (startMs !== null && endMs !== null && endMs > startMs) {
            durationMinutes = (endMs - startMs) / 60000;
          } else if (typeof pt.sleep_duration_minutes === 'number') {
            durationMinutes = pt.sleep_duration_minutes;
          } else if (typeof pt.sleep_duration_hours === 'number') {
            durationMinutes = pt.sleep_duration_hours * 60;
          }

          if (durationMinutes > 0 && durationMinutes <= 24 * 60) {
            let acc = dailyMap.get(dateStr);
            if (!acc) {
              acc = { date: dateStr };
              dailyMap.set(dateStr, acc);
            }
            if (!acc.sleepMinutes) {
              acc.sleepMinutes = { sum: durationMinutes, count: 1 };
            } else {
              acc.sleepMinutes.sum += durationMinutes;
              acc.sleepMinutes.count += 1;
            }
          }
        }
      }
    }
  }

  const observations = compileDailyObservations(dailyMap, 'Google Fit');
  const summary = summarizeBiometricObservations(observations);
  summary.totalRecordsProcessed = totalRawRecordsProcessed;

  return { observations, summary };
}

