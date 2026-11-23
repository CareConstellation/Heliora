import {
  addBlock,
  createDefaultTemplates,
  createPresetTemplate,
  findSlotConflicts,
  generateSlots,
  moveBlock,
  normalizeBlocks,
  parseDateKey,
  removeBlock,
  resizeBlock,
  toDateKey,
  toWeekday,
  upsertOverride,
  validateOverride,
  validateTemplate,
} from '@/lib/scheduleTemplates';
import type { ScheduleTemplate, WeeklyHoursBlock } from '@/types';

const block = (
  id: string,
  day: WeeklyHoursBlock['day'],
  start: number,
  end: number,
): WeeklyHoursBlock => ({
  id,
  day,
  startMinute: start * 60,
  endMinute: end * 60,
});

const mondayClinic: ScheduleTemplate = {
  id: 't',
  name: 'Mon',
  slotMinutes: 30,
  blocks: [block('b1', 0, 9, 11)],
};

// 2026-03-02 is a Monday.
const MONDAY = new Date(2026, 2, 2);
const PAST = new Date(2000, 0, 1);

describe('block editing', () => {
  it('merges overlapping and touching blocks on the same day only', () => {
    const merged = normalizeBlocks([
      block('a', 0, 9, 11),
      block('b', 0, 10, 12),
      block('c', 0, 12, 13),
      block('d', 1, 9, 10),
    ]);
    expect(merged.map((b) => [b.day, b.startMinute / 60, b.endMinute / 60])).toEqual([
      [0, 9, 13],
      [1, 9, 10],
    ]);
  });

  it('adds snapped blocks clamped to the day', () => {
    const blocks = addBlock([], 2, 9 * 60 + 10, 120);
    expect(blocks[0]).toMatchObject({ day: 2, startMinute: 9 * 60, endMinute: 11 * 60 });
    const late = addBlock([], 2, 23 * 60, 240);
    expect(late[0]).toMatchObject({ startMinute: 20 * 60, endMinute: 24 * 60 });
  });

  it('moves a block to another day keeping its duration (drag-and-drop)', () => {
    const moved = moveBlock([block('a', 0, 9, 12)], 'a', 3, 14 * 60);
    expect(moved).toEqual([{ id: 'a', day: 3, startMinute: 14 * 60, endMinute: 17 * 60 }]);
    expect(moveBlock([block('a', 0, 9, 12)], 'missing', 3, 0)).toHaveLength(1);
  });

  it('resizes with a minimum length and removes blocks', () => {
    expect(resizeBlock([block('a', 0, 9, 10)], 'a', 30)[0]!.endMinute).toBe(10 * 60 + 30);
    expect(resizeBlock([block('a', 0, 9, 10)], 'a', -120)[0]!.endMinute).toBe(9 * 60 + 30);
    expect(removeBlock([block('a', 0, 9, 10)], 'a')).toEqual([]);
  });

  it('validates templates', () => {
    expect(validateTemplate(mondayClinic)).toEqual([]);
    expect(validateTemplate({ ...mondayClinic, name: ' ', slotMinutes: 7 })).toHaveLength(2);
    expect(
      validateTemplate({ ...mondayClinic, blocks: [block('a', 0, 9, 11), block('b', 0, 10, 12)] }),
    ).toEqual(['Overlapping hours on Mon.']);
  });

  it('ships Standard Clinic Week, Surgery Week and Vacation presets', () => {
    expect(createDefaultTemplates().map((t) => t.name)).toEqual([
      'Standard Clinic Week',
      'Surgery Week',
      'Vacation',
    ]);
    expect(createPresetTemplate('vacation').blocks).toEqual([]);
    expect(validateTemplate(createPresetTemplate('standard'))).toEqual([]);
  });
});

describe('dates and overrides', () => {
  it('maps JS days to Monday-first weekdays and round-trips date keys', () => {
    expect(toWeekday(MONDAY)).toBe(0);
    expect(toWeekday(new Date(2026, 2, 8))).toBe(6);
    expect(toDateKey(MONDAY)).toBe('2026-03-02');
    expect(parseDateKey('2026-02-30')).toBeNull();
    expect(parseDateKey('2026-03-02')?.getDate()).toBe(2);
  });

  it('keeps one override per date, sorted', () => {
    const list = upsertOverride(
      upsertOverride([], { date: '2026-12-25', kind: 'holiday', label: 'Xmas' }),
      { date: '2026-12-01', kind: 'conference', label: 'ESC' },
    );
    const replaced = upsertOverride(list, {
      date: '2026-12-25',
      kind: 'conference',
      label: 'Moved',
    });
    expect(replaced.map((o) => `${o.date}:${o.label}`)).toEqual([
      '2026-12-01:ESC',
      '2026-12-25:Moved',
    ]);
  });

  it('validates overrides', () => {
    expect(validateOverride({ date: '', kind: 'holiday', label: 'x' })).toMatch(/valid date/);
    expect(validateOverride({ date: '2026-12-25', kind: 'holiday', label: ' ' })).toMatch(/label/);
    expect(
      validateOverride({ date: '2026-12-25', kind: 'custom', label: 'x', blocks: [] }),
    ).toMatch(/at least one/);
    expect(
      validateOverride({
        date: '2026-12-25',
        kind: 'custom',
        label: 'x',
        blocks: [{ startMinute: 600, endMinute: 540 }],
      }),
    ).toMatch(/after start/);
    expect(validateOverride({ date: '2026-12-25', kind: 'holiday', label: 'Xmas' })).toBeNull();
  });
});

describe('generateSlots', () => {
  const opts = { overrides: [], from: MONDAY, doctorId: 'GDOC', notBefore: PAST };

  it('expands the weekly template into slots with deterministic ids', () => {
    const slots = generateSlots({ ...opts, template: mondayClinic, days: 7 });
    expect(slots).toHaveLength(4);
    expect(new Date(slots[0]!.datetime).getHours()).toBe(9);
    expect(
      new Date(slots[3]!.datetime).getHours() * 60 + new Date(slots[3]!.datetime).getMinutes(),
    ).toBe(10 * 60 + 30);
    expect(slots[0]!.id).toBe(`GDOC:${slots[0]!.datetime}`);
    // Re-generating is identical (idempotent publish).
    expect(generateSlots({ ...opts, template: mondayClinic, days: 7 })).toEqual(slots);
  });

  it('applies the buffer between slots', () => {
    expect(
      generateSlots({ ...opts, template: mondayClinic, days: 1, bufferMinutes: 15 }),
    ).toHaveLength(3);
  });

  it('removes holiday/conference days and replaces hours for custom overrides', () => {
    const twoWeeks = { ...opts, template: mondayClinic, days: 14 };
    expect(generateSlots(twoWeeks)).toHaveLength(8);
    expect(
      generateSlots({
        ...twoWeeks,
        overrides: [{ date: '2026-03-02', kind: 'holiday', label: 'Holiday' }],
      }),
    ).toHaveLength(4);
    const custom = generateSlots({
      ...twoWeeks,
      overrides: [
        { date: '2026-03-09', kind: 'conference', label: 'ESC' },
        // A Saturday with custom hours, though the template has none.
        {
          date: '2026-03-07',
          kind: 'custom',
          label: 'Clinic',
          blocks: [{ startMinute: 600, endMinute: 660 }],
        },
      ],
    });
    expect(custom).toHaveLength(6);
    expect(custom.filter((s) => new Date(s.datetime).getDay() === 6)).toHaveLength(2);
  });

  it('skips slots in the past', () => {
    const notBefore = new Date(2026, 2, 2, 10, 0);
    expect(generateSlots({ ...opts, template: mondayClinic, days: 1, notBefore })).toHaveLength(2);
  });

  it('produces no slots for the Vacation template', () => {
    expect(
      generateSlots({ ...opts, template: createPresetTemplate('vacation'), days: 28 }),
    ).toEqual([]);
  });
});

describe('findSlotConflicts', () => {
  const slots = generateSlots({
    template: mondayClinic,
    overrides: [],
    from: MONDAY,
    days: 1,
    doctorId: 'D',
    notBefore: PAST,
  });

  it('flags slots overlapping booked appointments and existing slots', () => {
    const conflicts = findSlotConflicts(slots, 30, [
      {
        datetime: new Date(2026, 2, 2, 9, 15).toISOString(),
        durationMinutes: 30,
        kind: 'appointment',
      },
      { datetime: new Date(2026, 2, 2, 10, 30).toISOString(), durationMinutes: 30, kind: 'slot' },
    ]);
    expect(conflicts.map((c) => c.reason)).toEqual([
      'overlaps_booked_appointment',
      'overlaps_booked_appointment',
      'overlaps_existing_slot',
    ]);
  });

  it('treats back-to-back intervals as non-overlapping', () => {
    expect(
      findSlotConflicts(slots, 30, [
        { datetime: new Date(2026, 2, 2, 8, 30).toISOString(), durationMinutes: 30, kind: 'slot' },
        { datetime: new Date(2026, 2, 2, 11, 0).toISOString(), durationMinutes: 30, kind: 'slot' },
      ]),
    ).toEqual([]);
  });
});
