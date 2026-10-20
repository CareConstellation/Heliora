import {
  buildRRule,
  parseRRule,
  expandRecurringDates,
  calculateBundlePricing,
  evaluateRecurringPlan,
} from '@/lib/rrule';
import type { TimeSlot } from '@/types';

describe('Recurring Consultation Cadence & RFC 5545 Engine (#45)', () => {
  it('builds RFC 5545 recurrence rules properly', () => {
    expect(buildRRule('weekly', 4)).toBe('RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=4');
    expect(buildRRule('bi-weekly', 6)).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=6');
    expect(buildRRule('none', 1)).toBe('');
  });

  it('parses RFC 5545 recurrence rules', () => {
    const parsed = parseRRule('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=6');
    expect(parsed).toEqual({
      freq: 'WEEKLY',
      interval: 2,
      count: 6,
    });
  });

  it('expands recurring dates preserving time-of-day', () => {
    const start = '2026-11-01T10:00:00.000Z';
    const dates = expandRecurringDates(start, 1, 3);
    expect(dates).toHaveLength(3);
    expect(dates[0]).toBe('2026-11-01T10:00:00.000Z');
    expect(dates[1]).toBe('2026-11-08T10:00:00.000Z');
    expect(dates[2]).toBe('2026-11-15T10:00:00.000Z');
  });

  it('calculates bundle pricing with tiered discounts', () => {
    expect(calculateBundlePricing(1, 10)).toEqual({
      totalOriginalFee: 10,
      bundleDiscountPercent: 0,
      discountAmount: 0,
      finalBundleFee: 10,
    });

    expect(calculateBundlePricing(4, 10)).toEqual({
      totalOriginalFee: 40,
      bundleDiscountPercent: 10,
      discountAmount: 4,
      finalBundleFee: 36,
    });

    expect(calculateBundlePricing(6, 10)).toEqual({
      totalOriginalFee: 60,
      bundleDiscountPercent: 15,
      discountAmount: 9,
      finalBundleFee: 51,
    });

    expect(calculateBundlePricing(8, 10)).toEqual({
      totalOriginalFee: 80,
      bundleDiscountPercent: 20,
      discountAmount: 16,
      finalBundleFee: 64,
    });
  });

  it('atomically verifies availability across all target dates', () => {
    const baseSlot: TimeSlot = {
      id: 'slot-1',
      datetime: '2026-11-01T10:00:00.000Z',
      available: true,
      slotType: 'regular',
    };

    const slots: TimeSlot[] = [
      baseSlot,
      {
        id: 'slot-2',
        datetime: '2026-11-08T10:00:00.000Z',
        available: true,
        slotType: 'regular',
      },
      {
        id: 'slot-3',
        datetime: '2026-11-15T10:00:00.000Z',
        available: true,
        slotType: 'regular',
      },
      {
        id: 'slot-4',
        datetime: '2026-11-22T10:00:00.000Z',
        available: true,
        slotType: 'regular',
      },
    ];

    const plan = evaluateRecurringPlan(baseSlot, 'weekly', 4, slots, 10);
    expect(plan.allAvailable).toBe(true);
    expect(plan.finalBundleFee).toBe(36);
    expect(plan.occurrences).toHaveLength(4);
  });

  it('flags scheduling conflict if any target date is unavailable or buffer', () => {
    const baseSlot: TimeSlot = {
      id: 'slot-1',
      datetime: '2026-11-01T10:00:00.000Z',
      available: true,
      slotType: 'regular',
    };

    const slots: TimeSlot[] = [
      baseSlot,
      {
        id: 'slot-2',
        datetime: '2026-11-08T10:00:00.000Z',
        available: false, // booked!
        slotType: 'regular',
      },
    ];

    const plan = evaluateRecurringPlan(baseSlot, 'weekly', 2, slots, 10);
    expect(plan.allAvailable).toBe(false);
    expect(plan.occurrences[1]?.isAvailable).toBe(false);
    expect(plan.occurrences[1]?.conflictReason).toBe(
      'Slot is already booked by another patient',
    );
  });
});
