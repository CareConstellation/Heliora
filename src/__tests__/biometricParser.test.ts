import {
  streamParseAppleHealthDirect,
  parseGoogleFitJSON,
  biometricObservationsToImportRows,
  filterBiometricObservations,
  summarizeBiometricObservations,
} from '@/lib/bulkRecordParser';

describe('Biometric Data Ingestion Adapter (#79)', () => {
  const sampleAppleHealthXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
]>
<HealthData locale="en_US">
 <ExportDate value="2024-05-15 10:00:00 -0400"/>
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Apple Watch" device="&lt;HKDevice: 0x... model:Watch&gt;" unit="count/min" creationDate="2024-05-10 08:00:00 -0400" startDate="2024-05-10 07:30:00 -0400" endDate="2024-05-10 07:30:00 -0400" value="58"/>
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Apple Watch" unit="count/min" creationDate="2024-05-10 18:00:00 -0400" startDate="2024-05-10 17:30:00 -0400" endDate="2024-05-10 17:30:00 -0400" value="62"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" creationDate="2024-05-10 12:00:00 -0400" startDate="2024-05-10 11:00:00 -0400" endDate="2024-05-10 12:00:00 -0400" value="3500"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" unit="count" creationDate="2024-05-10 18:00:00 -0400" startDate="2024-05-10 17:00:00 -0400" endDate="2024-05-10 18:00:00 -0400" value="4500"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" creationDate="2024-05-10 07:00:00 -0400" startDate="2024-05-09 23:00:00 -0400" endDate="2024-05-10 07:00:00 -0400" value="HKCategoryValueSleepAnalysisAsleepCore"/>
 <Record type="HKQuantityTypeIdentifierDistanceWalkingRunning" sourceName="iPhone" unit="km" creationDate="2024-05-10 12:00:00 -0400" startDate="2024-05-10 11:00:00 -0400" endDate="2024-05-10 12:00:00 -0400" value="2.5"/>
</HealthData>`;

  const sampleGoogleFitJSON = {
    point: [
      {
        dataTypeName: 'com.google.heart_rate.bpm',
        startTimeNanos: '1715328000000000000', // 2024-05-10
        endTimeNanos: '1715328000000000000',
        value: [{ fpVal: 64.0 }],
      },
      {
        dataTypeName: 'com.google.step_count.delta',
        startTimeNanos: '1715331600000000000',
        endTimeNanos: '1715335200000000000',
        value: [{ intVal: 5200 }],
      },
      {
        dataTypeName: 'com.google.sleep.segment',
        startTimeNanos: '1715295600000000000', // 2024-05-09 23:00 UTC
        endTimeNanos: '1715324400000000000', // 2024-05-10 07:00 UTC (8 hours)
        value: [{ intVal: 4 }], // Light sleep stage
      },
    ],
  };

  describe('Apple Health Stream SAX Parser', () => {
    it('stream-parses XML chunks and normalizes daily resting HR, steps, and sleep', async () => {
      const blob = new Blob([sampleAppleHealthXML], { type: 'text/xml' });
      const { observations, summary } = await streamParseAppleHealthDirect(blob, undefined, undefined, 128);

      expect(observations).toHaveLength(3);
      expect(summary.totalDailyObservations).toBe(3);

      // Resting Heart Rate: avg of 58 and 62 -> 60 bpm
      const rhr = observations.find((o) => o.category === 'resting_heart_rate');
      expect(rhr).toBeDefined();
      expect(rhr?.value).toBe(60);
      expect(rhr?.unit).toBe('bpm');
      expect(rhr?.code).toBe('40443-4');
      expect(rhr?.date).toBe('2024-05-10');

      // Step count: sum of 3500 and 4500 -> 8000 steps
      const steps = observations.find((o) => o.category === 'step_count');
      expect(steps).toBeDefined();
      expect(steps?.value).toBe(8000);
      expect(steps?.unit).toBe('steps');
      expect(steps?.code).toBe('55423-8');

      // Sleep duration: 8 hours (23:00 to 07:00)
      const sleep = observations.find((o) => o.category === 'sleep');
      expect(sleep).toBeDefined();
      expect(sleep?.value).toBe(8);
      expect(sleep?.unit).toBe('hours');
      expect(sleep?.code).toBe('93832-4');
    });

    it('respects selective category filters during streaming', async () => {
      const blob = new Blob([sampleAppleHealthXML], { type: 'text/xml' });
      const { observations } = await streamParseAppleHealthDirect(blob, {
        categories: ['resting_heart_rate'],
      });

      expect(observations).toHaveLength(1);
      expect(observations[0]?.category).toBe('resting_heart_rate');
    });

    it('filters out records outside the requested date interval', async () => {
      const blob = new Blob([sampleAppleHealthXML], { type: 'text/xml' });
      const { observations } = await streamParseAppleHealthDirect(blob, {
        startDate: '2024-06-01',
      });

      expect(observations).toHaveLength(0);
    });
  });

  describe('Google Fit Takeout Parser', () => {
    it('parses Google Fit point arrays with nanoseconds and maps to Heliora observations', () => {
      const { observations, summary } = parseGoogleFitJSON(sampleGoogleFitJSON);

      expect(observations).toHaveLength(3);
      expect(summary.totalDailyObservations).toBe(3);

      const rhr = observations.find((o) => o.category === 'resting_heart_rate');
      expect(rhr?.value).toBe(64);
      expect(rhr?.source).toBe('Google Fit');

      const steps = observations.find((o) => o.category === 'step_count');
      expect(steps?.value).toBe(5200);

      const sleep = observations.find((o) => o.category === 'sleep');
      expect(sleep?.value).toBe(8);
    });

    it('filters out awake stages (stage 1) from sleep duration calculation', () => {
      const jsonWithAwake = {
        point: [
          {
            dataTypeName: 'com.google.sleep.segment',
            startTimeNanos: '1715295600000000000',
            endTimeNanos: '1715302800000000000', // 2 hours
            value: [{ intVal: 1 }], // AWAKE
          },
        ],
      };

      const { observations } = parseGoogleFitJSON(jsonWithAwake);
      const sleep = observations.find((o) => o.category === 'sleep');
      expect(sleep).toBeUndefined();
    });
  });

  describe('Conversion & Normalization Utilities', () => {
    it('converts Heliora observations into valid BulkRecordImportRow items', () => {
      const { observations } = parseGoogleFitJSON(sampleGoogleFitJSON);
      const rows = biometricObservationsToImportRows(observations);

      expect(rows).toHaveLength(3);
      expect(rows[0]?.date).toBe('2024-05-10');
      expect(rows[0]?.doctorName).toBe('Google Fit');
      expect(rows[0]?.diagnosis).toContain('Resting Heart Rate: 64 bpm');

      const notes = JSON.parse(rows[0]?.notes || '{}');
      expect(notes.loinc).toBe('40443-4');
      expect(notes.category).toBe('resting_heart_rate');
    });

    it('summarizes metrics and accurately counts categories', () => {
      const { observations } = parseGoogleFitJSON(sampleGoogleFitJSON);
      const summary = summarizeBiometricObservations(observations);

      expect(summary.totalDailyObservations).toBe(3);
      expect(summary.byCategory.resting_heart_rate).toBe(1);
      expect(summary.byCategory.step_count).toBe(1);
      expect(summary.byCategory.sleep).toBe(1);
      expect(summary.dateRange.start).toBe('2024-05-10');
      expect(summary.dateRange.end).toBe('2024-05-10');
    });
  });
});
