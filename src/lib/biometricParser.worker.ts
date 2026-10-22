/**
 * Dedicated Web Worker for biometric data ingestion (Issue #79).
 *
 * Stream-parses large Apple Health XML exports (export.xml) and Google Fit Takeout
 * exports (fit.json) without allocating large DOM trees or crashing browser tabs.
 */

import type {
  BiometricMetricCategory,
  BiometricImportFilter,
  BiometricImportSummary,
  HelioraObservation,
} from '@/types';

export interface WorkerParseRequest {
  id: string;
  op: 'parseAppleHealth' | 'parseGoogleFit';
  file?: File;
  content?: string;
  filter?: BiometricImportFilter;
  chunkSize?: number;
}

export type WorkerParseResponse =
  | {
      id: string;
      op: 'progress';
      processedBytes: number;
      totalBytes: number;
      recordsExtracted: number;
    }
  | {
      id: string;
      op: 'success';
      observations: HelioraObservation[];
      summary: BiometricImportSummary;
    }
  | {
      id: string;
      op: 'error';
      message: string;
    };

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

/**
 * Stream-parse Apple Health XML in bounded memory chunks (O(1) space).
 */
async function streamParseAppleHealth(
  file: File,
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

      // Resting Heart Rate (or general heart rate fallback)
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
    }
  }

  const observations = compileDailyObservations(dailyMap, 'Apple Health');
  const summary = buildSummary(totalRawRecordsProcessed, observations);

  return { observations, summary };
}

/**
 * Parses Google Fit Takeout JSON exports.
 */
function parseGoogleFit(
  jsonText: string,
  filter?: BiometricImportFilter,
): { observations: HelioraObservation[]; summary: BiometricImportSummary } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Invalid Google Fit JSON: Unable to parse file content.');
  }

  const dailyMap = new Map<string, DailyAccumulator>();
  let totalRawRecordsProcessed = 0;

  const root = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;

  // Handle takeouts with points array, bucket array, or daily records
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

  // Iterate over extracted data points
  for (const pt of points) {
    if (!pt) continue;
    totalRawRecordsProcessed++;
    const type = typeof pt.dataTypeName === 'string' ? pt.dataTypeName : typeof pt.type === 'string' ? pt.type : '';

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

    // Step count
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
  const summary = buildSummary(totalRawRecordsProcessed, observations);

  return { observations, summary };
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
    const hrRecord = (acc.restingHeartRate && acc.restingHeartRate.count > 0)
      ? acc.restingHeartRate
      : (acc.generalHeartRate && acc.generalHeartRate.count > 0)
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

function buildSummary(
  totalRaw: number,
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
    totalRecordsProcessed: totalRaw,
    totalDailyObservations: observations.length,
    byCategory,
    dateRange: { start: earliest, end: latest },
  };
}

// Worker message handler
if (typeof self !== 'undefined' && 'addEventListener' in self) {
  self.addEventListener('message', async (e: MessageEvent<WorkerParseRequest>) => {
    const { id, op, file, content, filter, chunkSize } = e.data;

    try {
      if (op === 'parseAppleHealth') {
        if (!file) throw new Error('File payload missing for Apple Health parsing.');

        const result = await streamParseAppleHealth(
          file,
          filter,
          (processedBytes, totalBytes, recordsExtracted) => {
            const progressMsg: WorkerParseResponse = {
              id,
              op: 'progress',
              processedBytes,
              totalBytes,
              recordsExtracted,
            };
            self.postMessage(progressMsg);
          },
          chunkSize,
        );

        const successMsg: WorkerParseResponse = {
          id,
          op: 'success',
          observations: result.observations,
          summary: result.summary,
        };
        self.postMessage(successMsg);
      } else if (op === 'parseGoogleFit') {
        let jsonText = content;
        if (!jsonText && file) {
          jsonText = await file.text();
        }
        if (!jsonText) throw new Error('No JSON content provided for Google Fit parsing.');

        const result = parseGoogleFit(jsonText, filter);
        const successMsg: WorkerParseResponse = {
          id,
          op: 'success',
          observations: result.observations,
          summary: result.summary,
        };
        self.postMessage(successMsg);
      } else {
        throw new Error(`Unsupported worker operation: ${op}`);
      }
    } catch (err) {
      const errorMsg: WorkerParseResponse = {
        id,
        op: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(errorMsg);
    }
  });
}
