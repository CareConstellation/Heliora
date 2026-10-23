import type { BulkRecordImportRow, MedicalRecord } from '@/types';
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

  const headers = rows[0]!.map((h) => h.toLowerCase().replace(/[\s_-]+/g, ''));
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
        rows[0]!.join(', '),
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
      if (row) results.push(validateRow(row, i + j));
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

      const newIds = res.records?.map((r) => r.id) || chunk.map((_, idx) => `record-chunk-${i}-${idx}`);
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
  return rows.map((row, idx) => ({
    id: `record-${Date.now()}-${idx}`,
    date: row.date,
    doctorName: row.doctorName,
    diagnosis: row.diagnosis,
    ...(row.prescription !== undefined ? { prescription: row.prescription } : {}),
    ...(row.notes !== undefined ? { notes: row.notes } : {}),
    patientAddress,
  }));
}


export type UnitSystem = 'SI' | 'conventional';

export interface UnitConversion {
  from: string;
  to: string;
  factor: number;
  offset?: number;
}

export const UNIT_CONVERSION_TABLE: Record<string, UnitConversion[]> = {
  'blood glucose': [
    { from: 'mg/dL', to: 'mmol/L', factor: 0.0555, offset: 0 },
    { from: 'mmol/L', to: 'mg/dL', factor: 18.018, offset: 0 },
  ],
  'creatinine': [
    { from: 'mg/dL', to: 'umol/L', factor: 88.4, offset: 0 },
    { from: 'umol/L', to: 'mg/dL', factor: 0.0113, offset: 0 },
  ],
  'cholesterol': [
    { from: 'mg/dL', to: 'mmol/L', factor: 0.02586, offset: 0 },
    { from: 'mmol/L', to: 'mg/dL', factor: 38.67, offset: 0 },
  ],
  'bilirubin': [
    { from: 'mg/dL', to: 'umol/L', factor: 17.1, offset: 0 },
    { from: 'umol/L', to: 'mg/dL', factor: 0.0585, offset: 0 },
  ],
  'hemoglobin': [
    { from: 'g/dL', to: 'g/L', factor: 10, offset: 0 },
    { from: 'g/L', to: 'g/dL', factor: 0.1, offset: 0 },
  ],
};

export function normalizeLabValueToSI(test: string, value: number, unit: string): { value: number; unit: string } {
  const key = test.toLowerCase().trim();
  const conversions = UNIT_CONVERSION_TABLE[key];
  if (!conversions) return { value, unit };
  const siConv = conversions.find((c) => c.from.toLowerCase() === unit.toLowerCase());
  if (!siConv) return { value, unit };
  return { value: value * siConv.factor + (siConv.offset ?? 0), unit: siConv.to };
}

export function convertValue(value: number, from: string, to: string, test: string): number {
  const key = test.toLowerCase().trim();
  const conversions = UNIT_CONVERSION_TABLE[key] ?? [];
  const conv = conversions.find((c) => c.from.toLowerCase() === from.toLowerCase() && c.to.toLowerCase() === to.toLowerCase());
  if (!conv) return value;
  return value * conv.factor + (conv.offset ?? 0);
}

export function convertReferenceRange(range: { low: number; high: number }, from: string, to: string, test: string): { low: number; high: number } {
  return { low: convertValue(range.low, from, to, test), high: convertValue(range.high, from, to, test) };
}
