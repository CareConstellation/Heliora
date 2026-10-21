import type {
  TimeSlot,
  RecurrenceCadence,
  TargetSlotOccurrence,
  RecurringAppointmentPlan,
} from '@/types';

/**
 * Builds an RFC 5545 recurrence rule string for recurring appointments.
 */
export function buildRRule(cadence: RecurrenceCadence, count: number): string {
  if (cadence === 'weekly') {
    return `RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=${count}`;
  }
  if (cadence === 'bi-weekly') {
    return `RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=${count}`;
  }
  return '';
}

/**
 * Parses an RFC 5545 recurrence rule string.
 */
export function parseRRule(rruleStr: string): { freq: string; interval: number; count: number } | null {
  if (!rruleStr || !rruleStr.includes('FREQ=')) return null;

  const clean = rruleStr.replace(/^RRULE:/, '');
  const parts = clean.split(';');
  let freq = 'WEEKLY';
  let interval = 1;
  let count = 1;

  for (const part of parts) {
    const [key, val] = part.split('=');
    if (key === 'FREQ' && val) freq = val;
    if (key === 'INTERVAL' && val) interval = parseInt(val, 10) || 1;
    if (key === 'COUNT' && val) count = parseInt(val, 10) || 1;
  }

  return { freq, interval, count };
}

/**
 * Expands a base ISO datetime into a sequence of recurring dates based on interval and count.
 * Preserves the exact time-of-day across all occurrences.
 */
export function expandRecurringDates(baseDatetime: string, intervalWeeks: number, count: number): string[] {
  const baseDate = new Date(baseDatetime);
  const dates: string[] = [];

  for (let i = 0; i < count; i++) {
    const d = new Date(baseDate.getTime());
    d.setDate(baseDate.getDate() + i * intervalWeeks * 7);
    dates.push(d.toISOString());
  }

  return dates;
}

/**
 * Calculates bundle discount tiers for multi-session recurring bookings.
 */
export function calculateBundlePricing(
  count: number,
  baseFee: number,
): {
  totalOriginalFee: number;
  bundleDiscountPercent: number;
  discountAmount: number;
  finalBundleFee: number;
} {
  const totalOriginalFee = count * baseFee;
  let bundleDiscountPercent = 0;

  if (count >= 8) {
    bundleDiscountPercent = 20;
  } else if (count >= 6) {
    bundleDiscountPercent = 15;
  } else if (count >= 4) {
    bundleDiscountPercent = 10;
  } else if (count >= 2) {
    bundleDiscountPercent = 5;
  }

  const discountAmount = Math.round((totalOriginalFee * bundleDiscountPercent) / 100);
  const finalBundleFee = totalOriginalFee - discountAmount;

  return {
    totalOriginalFee,
    bundleDiscountPercent,
    discountAmount,
    finalBundleFee,
  };
}

/**
 * Atomically verifies slot availability across all target dates for an RFC 5545 recurring plan.
 * Returns a complete recurring appointment plan with atomic verification status and bundle pricing.
 */
export function evaluateRecurringPlan(
  baseSlot: TimeSlot,
  cadence: RecurrenceCadence,
  count: number,
  availableSlots: TimeSlot[],
  baseFee = 10,
): RecurringAppointmentPlan {
  const interval = cadence === 'bi-weekly' ? 2 : 1;
  const rrule = buildRRule(cadence, count);
  const targetDates = expandRecurringDates(baseSlot.datetime, interval, count);

  const occurrences: TargetSlotOccurrence[] = targetDates.map((targetDatetime, index) => {
    if (index === 0) {
      return {
        occurrenceIndex: 0,
        datetime: baseSlot.datetime,
        matchedSlot: baseSlot,
        isAvailable: baseSlot.available && baseSlot.slotType !== 'buffer',
        conflictReason: !baseSlot.available ? 'Base slot is already booked' : undefined,
      };
    }

    const targetDateObj = new Date(targetDatetime);
    const targetHours = targetDateObj.getHours();
    const targetMinutes = targetDateObj.getMinutes();
    const targetDateStr = targetDateObj.toDateString();

    const matched = availableSlots.find((s) => {
      const sDate = new Date(s.datetime);
      return (
        sDate.toDateString() === targetDateStr &&
        sDate.getHours() === targetHours &&
        sDate.getMinutes() === targetMinutes
      );
    });

    if (matched) {
      const isAvailable = matched.available && matched.slotType !== 'buffer';
      return {
        occurrenceIndex: index,
        datetime: targetDatetime,
        matchedSlot: matched,
        isAvailable,
        conflictReason: !isAvailable
          ? matched.slotType === 'buffer'
            ? 'Reserved as physician buffer'
            : 'Slot is already booked by another patient'
          : undefined,
      };
    }

    const hasAnySlotsOnDay = availableSlots.some(
      (s) => new Date(s.datetime).toDateString() === targetDateStr,
    );

    if (hasAnySlotsOnDay) {
      return {
        occurrenceIndex: index,
        datetime: targetDatetime,
        isAvailable: false,
        conflictReason: 'Time slot unavailable on this date',
      };
    }

    return {
      occurrenceIndex: index,
      datetime: targetDatetime,
      isAvailable: true,
    };
  });

  const allAvailable = occurrences.every((o) => o.isAvailable);
  const pricing = calculateBundlePricing(count, baseFee);

  return {
    rrule,
    cadence,
    interval,
    count,
    occurrences,
    allAvailable,
    baseFeePerSlot: baseFee,
    totalOriginalFee: pricing.totalOriginalFee,
    bundleDiscountPercent: pricing.bundleDiscountPercent,
    finalBundleFee: pricing.finalBundleFee,
  };
}
