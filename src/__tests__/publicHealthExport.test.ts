import { deidentifyRecord, recordsToCsv } from '@/lib/publicHealthExport';

describe('publicHealthExport', () => {
  const admission = {
    id: 'adm-123',
    patientName: 'Jane Doe',
    patientAddress: 'GABC',
    admissionDate: '2025-05-15T10:00:00Z',
    dischargeDate: '2025-05-20',
    department: 'Cardiology',
    status: 'discharged',
  };

  it('drops direct identifiers and reduces dates to the year', () => {
    expect(deidentifyRecord(admission)).toEqual({
      admissionDate: '2025',
      dischargeDate: '2025',
      department: 'Cardiology',
      status: 'discharged',
    });
  });

  it('never writes identifiers into the CSV', () => {
    const csv = recordsToCsv([admission]);
    expect(csv).not.toMatch(/Jane|adm-123|GABC|05-15/);
  });
});
