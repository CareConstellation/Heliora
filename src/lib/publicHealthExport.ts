const SAFE_HARBOR_FIELDS = new Set([
  'name',
  'firstName',
  'lastName',
  'patientName',
  'address',
  'street',
  'city',
  'state',
  'zip',
  'postalCode',
  'country',
  'phone',
  'fax',
  'email',
  'ssn',
  'mrn',
  'medicalRecordNumber',
  'accountNumber',
  'certificateNumber',
  'vehicleId',
  'deviceId',
  'url',
  'ipAddress',
  'biometric',
  'photo',
  'face',
  'patientAddress',
  'walletAddress',
]);

// Safe Harbor also covers unique identifiers and every date except its year.
const isIdentifierKey = (key: string) => key === 'id' || /Id$/.test(key);
const isDateKey = (key: string) => /date|dob|birth/i.test(key);

export function deidentifyRecord(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !SAFE_HARBOR_FIELDS.has(key) && !isIdentifierKey(key))
      .map(([key, value]) =>
        isDateKey(key) && value ? [key, String(value).slice(0, 4)] : [key, value],
      ),
  );
}

export function deidentifyRecords(records: Record<string, unknown>[]) {
  return records.map(deidentifyRecord);
}

export function recordsToCsv(records: Record<string, unknown>[]) {
  const safe = deidentifyRecords(records);
  const columns = [...new Set(safe.flatMap((record) => Object.keys(record)))];
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [
    columns.join(','),
    ...safe.map((record) => columns.map((column) => quote(record[column])).join(',')),
  ].join('\n');
}

export function downloadPublicHealthExport(
  records: Record<string, unknown>[],
  format: 'csv' | 'json',
) {
  const safe = deidentifyRecords(records);
  const body = format === 'csv' ? recordsToCsv(records) : JSON.stringify(safe, null, 2);
  const blob = new Blob([body], { type: format === 'csv' ? 'text/csv' : 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `heliora-public-health-${new Date().toISOString().slice(0, 10)}.${format}`;
  link.click();
  URL.revokeObjectURL(link.href);
}
