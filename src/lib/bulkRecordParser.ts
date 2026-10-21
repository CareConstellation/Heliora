import type { BulkRecordImportRow, MedicalRecord } from '@/types';
import { validateFHIRBundle } from '@/lib/fhirValidator';

export function parseCSV(text: string): BulkRecordImportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2)
    throw new Error('CSV file must have a header row and at least one data row.');

  const headers = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  const dateIdx = headers.findIndex((h) => h === 'date');
  const doctorIdx = headers.findIndex(
    (h) => h === 'doctorname' || h === 'doctor' || h === 'doctor_name',
  );
  const diagnosisIdx = headers.findIndex((h) => h === 'diagnosis');
  const prescriptionIdx = headers.findIndex((h) => h === 'prescription');
  const notesIdx = headers.findIndex((h) => h === 'notes');

  if (dateIdx === -1 || doctorIdx === -1 || diagnosisIdx === -1) {
    throw new Error(
      'CSV must contain at least "date", "doctorName", and "diagnosis" columns. Found: ' +
        headers.join(', '),
    );
  }

  const records: BulkRecordImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(',').map((c) => c.trim());
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
      date: (resource.date as string) || '',
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

export function validateRow(row: BulkRecordImportRow, idx: number): PreviewRow {
  const errors: string[] = [];
  if (!row.date) errors.push('Missing date');
  if (!row.doctorName) errors.push('Missing doctorName');
  if (!row.diagnosis) errors.push('Missing diagnosis');
  for (const [field, value] of Object.entries(row)) {
    if (typeof value === 'string' && FORMULA_PREFIX.test(value)) {
      errors.push(`Possible spreadsheet formula (macro) in ${field}`);
    }
  }
  return { ...row, _row: idx + 1, _valid: errors.length === 0, _errors: errors };
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
    prescription: row.prescription,
    notes: row.notes,
    patientAddress,
  }));
}
