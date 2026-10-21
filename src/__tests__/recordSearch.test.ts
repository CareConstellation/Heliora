import { createRecordIndex } from '@/lib/recordSearch';
import type { MedicalRecord } from '@/types';

const rec = (i: number, extra: Partial<MedicalRecord> = {}): MedicalRecord => ({
  id: `r${i}`,
  date: new Date(Date.UTC(2025, i % 12, 1 + (i % 27))).toISOString(),
  doctorName: `Doctor ${i}`,
  diagnosis: `Condition ${i}`,
  patientAddress: 'G…',
  ...extra,
});

describe('createRecordIndex (#69)', () => {
  const records = [
    rec(1, {
      diagnosis: 'Hypertension',
      prescription: 'Lisinopril',
      providerSpecialty: 'Cardiology',
      classification: 'clinical',
    }),
    rec(2, {
      diagnosis: 'Asthma',
      notes: 'Use inhaler daily',
      providerSpecialty: 'Pulmonology',
      classification: 'clinical',
    }),
    rec(3, {
      diagnosis: 'Fracture',
      providerSpecialty: 'Radiology',
      classification: 'imaging',
      date: '2024-01-15T00:00:00.000Z',
    }),
  ];
  const search = createRecordIndex(records);

  it('matches across diagnosis, prescription and notes, with fuzzy and prefix', () => {
    expect(search('hypertens').map((r) => r.id)).toEqual(['r1']);
    expect(search('lisinopirl').map((r) => r.id)).toEqual(['r1']);
    expect(search('inhaler').map((r) => r.id)).toEqual(['r2']);
  });

  it('filters by date range (inclusive), specialty and classification', () => {
    expect(search('', { to: '2024-01-15' }).map((r) => r.id)).toEqual(['r3']);
    expect(search('', { classification: 'clinical' })).toHaveLength(2);
    expect(search('', { specialty: 'Radiology', from: '2024-01-01' }).map((r) => r.id)).toEqual([
      'r3',
    ]);
  });

  it('answers fuzzy queries over 1000+ records in under 50ms', () => {
    const big = createRecordIndex(Array.from({ length: 1500 }, (_, i) => rec(i)));
    big('condiiton 77'); // warm-up
    const t0 = performance.now();
    const hits = big('condiiton 77');
    expect(performance.now() - t0).toBeLessThan(50);
    expect(hits.length).toBeGreaterThan(0);
  });
});
