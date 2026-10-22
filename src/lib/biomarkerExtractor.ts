import type { MedicalRecord } from '@/types';

export interface BiomarkerObservation {
  date: string;
  value: number;
  unit: string;
  referenceMin?: number;
  referenceMax?: number;
  status: 'normal' | 'abnormal' | 'critical';
}

export interface BiomarkerTrendData {
  biomarkerName: string;
  code: string;
  unit: string;
  observations: BiomarkerObservation[];
}

export const BIOMARKER_DEFINITIONS = {
  HbA1c: {
    code: '4548-4',
    unit: '%',
    referenceMin: 4.0,
    referenceMax: 5.7,
    abnormalThreshold: 6.5,
  },
  Cholesterol: {
    code: '2093-3',
    unit: 'mg/dL',
    referenceMin: 0,
    referenceMax: 200,
    abnormalThreshold: 240,
  },
  'Blood Pressure Systolic': {
    code: '8480-6',
    unit: 'mmHg',
    referenceMin: 0,
    referenceMax: 120,
    abnormalThreshold: 140,
  },
  'Blood Pressure Diastolic': {
    code: '8462-4',
    unit: 'mmHg',
    referenceMin: 0,
    referenceMax: 80,
    abnormalThreshold: 90,
  },
  Glucose: {
    code: '2345-7',
    unit: 'mg/dL',
    referenceMin: 70,
    referenceMax: 100,
    abnormalThreshold: 126,
  },
  'LDL Cholesterol': {
    code: '2089-1',
    unit: 'mg/dL',
    referenceMin: 0,
    referenceMax: 100,
    abnormalThreshold: 160,
  },
  'HDL Cholesterol': {
    code: '2085-9',
    unit: 'mg/dL',
    referenceMin: 40,
    referenceMax: 500,
    abnormalThreshold: 40,
  },
  Triglycerides: {
    code: '2571-8',
    unit: 'mg/dL',
    referenceMin: 0,
    referenceMax: 150,
    abnormalThreshold: 200,
  },
} as const;

export type BiomarkerName = keyof typeof BIOMARKER_DEFINITIONS;

function extractNumericValue(diagnosis: string): number | null {
  const match = diagnosis.match(/(\d+(?:\.\d+)?)/);
  return match?.[1] ? parseFloat(match[1]) : null;
}

function determineBiomarkerStatus(
  value: number,
  referenceMin: number,
  referenceMax: number,
  abnormalThreshold?: number,
): 'normal' | 'abnormal' | 'critical' {
  if (abnormalThreshold && Math.abs(value - referenceMax) > abnormalThreshold - referenceMax) {
    return 'critical';
  }
  if (value < referenceMin || value > referenceMax) {
    return 'abnormal';
  }
  return 'normal';
}

export function extractBiomarkerFromRecords(
  records: MedicalRecord[],
  biomarkerName: BiomarkerName,
): BiomarkerTrendData | null {
  const definition = BIOMARKER_DEFINITIONS[biomarkerName];
  if (!definition) return null;

  const relevantRecords = records.filter((r) => r.diagnosis.toLowerCase().includes(biomarkerName.toLowerCase()));

  if (relevantRecords.length === 0) return null;

  const observations: BiomarkerObservation[] = relevantRecords
    .map((record): BiomarkerObservation | null => {
      const value = extractNumericValue(record.diagnosis);
      if (value === null) return null;

      return {
        date: record.date,
        value,
        unit: definition.unit,
        referenceMin: definition.referenceMin,
        referenceMax: definition.referenceMax,
        status: determineBiomarkerStatus(value, definition.referenceMin, definition.referenceMax, definition.abnormalThreshold),
      };
    })
    .filter((obs): obs is BiomarkerObservation => obs !== null)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return {
    biomarkerName,
    code: definition.code,
    unit: definition.unit,
    observations,
  };
}

export function extractMultipleBiomarkers(
  records: MedicalRecord[],
  biomarkerNames: Array<keyof typeof BIOMARKER_DEFINITIONS>,
): BiomarkerTrendData[] {
  return biomarkerNames
    .map((name) => extractBiomarkerFromRecords(records, name))
    .filter((trend): trend is BiomarkerTrendData => trend !== null);
}

export function getAvailableBiomarkers(): Array<keyof typeof BIOMARKER_DEFINITIONS> {
  return Object.keys(BIOMARKER_DEFINITIONS) as Array<keyof typeof BIOMARKER_DEFINITIONS>;
}

export function compareBiomarkers(
  trend1: BiomarkerTrendData,
  trend2: BiomarkerTrendData,
): {
  biomarker1: BiomarkerTrendData;
  biomarker2: BiomarkerTrendData;
  commonDates: string[];
} {
  const dates1 = new Set(trend1.observations.map((o) => o.date));
  const dates2 = new Set(trend2.observations.map((o) => o.date));
  const commonDates = Array.from(dates1).filter((d) => dates2.has(d));

  return {
    biomarker1: trend1,
    biomarker2: trend2,
    commonDates,
  };
}
