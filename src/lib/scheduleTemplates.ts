import type {
  DateOverride,
  ScheduleTemplate,
  SlotConflict,
  TimeSlot,
  Weekday,
  WeeklyHoursBlock,
} from '@/types';

/* ─── Grid constants ────────────────────────────────────────────────────── */

export const MINUTES_PER_DAY = 24 * 60;
/** Drag/resize granularity of the builder. */
export const SNAP_MINUTES = 30;
export const MIN_BLOCK_MINUTES = SNAP_MINUTES;
export const ALLOWED_SLOT_MINUTES = [15, 20, 30, 45, 60] as const;
/** Upper bound on slots published in one atomic batch. */
export const MAX_PUBLISH_SLOTS = 500;
export const MAX_PUBLISH_WEEKS = 12;

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  0: 'Mon',
  1: 'Tue',
  2: 'Wed',
  3: 'Thu',
  4: 'Fri',
  5: 'Sat',
  6: 'Sun',
};

export const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

let idCounter = 0;
export function createId(prefix: string): string {
  idCounter += 1;
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}-${idCounter}`;
}

/* ─── Time helpers ──────────────────────────────────────────────────────── */

export function snapMinutes(minutes: number, step = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

export function clampMinutes(minutes: number): number {
  return Math.max(0, Math.min(MINUTES_PER_DAY, minutes));
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** JS `Date#getDay()` (0 = Sunday) → {@link Weekday} (0 = Monday). */
export function toWeekday(date: Date): Weekday {
  return ((date.getDay() + 6) % 7) as Weekday;
}

/** Local calendar date as `YYYY-MM-DD`. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return toDateKey(date) === key ? date : null;
}

/* ─── Block editing ─────────────────────────────────────────────────────── */

function overlaps(
  a: { startMinute: number; endMinute: number },
  b: { startMinute: number; endMinute: number },
) {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

export function sortBlocks(blocks: WeeklyHoursBlock[]): WeeklyHoursBlock[] {
  return [...blocks].sort((a, b) => a.day - b.day || a.startMinute - b.startMinute);
}

/**
 * Merges overlapping or touching blocks on the same day. Dropping a block onto
 * another one therefore extends the shift instead of producing duplicate slots.
 */
export function normalizeBlocks(blocks: WeeklyHoursBlock[]): WeeklyHoursBlock[] {
  const merged: WeeklyHoursBlock[] = [];
  for (const block of sortBlocks(blocks)) {
    if (block.endMinute - block.startMinute <= 0) continue;
    const last = merged[merged.length - 1];
    if (last && last.day === block.day && block.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, block.endMinute);
    } else {
      merged.push({ ...block });
    }
  }
  return merged;
}

/** Adds a block at `day`/`startMinute` (snapped, clamped to the day) and merges. */
export function addBlock(
  blocks: WeeklyHoursBlock[],
  day: Weekday,
  startMinute: number,
  durationMinutes: number,
): WeeklyHoursBlock[] {
  const duration = Math.max(MIN_BLOCK_MINUTES, snapMinutes(durationMinutes));
  const start = clampMinutes(Math.min(snapMinutes(startMinute), MINUTES_PER_DAY - duration));
  return normalizeBlocks([
    ...blocks,
    { id: createId('block'), day, startMinute: start, endMinute: start + duration },
  ]);
}

/** Moves a block to another day/start time keeping its duration (drag-and-drop). */
export function moveBlock(
  blocks: WeeklyHoursBlock[],
  id: string,
  day: Weekday,
  startMinute: number,
): WeeklyHoursBlock[] {
  const block = blocks.find((b) => b.id === id);
  if (!block) return blocks;
  const duration = block.endMinute - block.startMinute;
  const start = clampMinutes(Math.min(snapMinutes(startMinute), MINUTES_PER_DAY - duration));
  return normalizeBlocks(
    blocks.map((b) =>
      b.id === id ? { ...b, day, startMinute: start, endMinute: start + duration } : b,
    ),
  );
}

/** Grows/shrinks a block's end by `deltaMinutes` (snapped), keeping the minimum length. */
export function resizeBlock(
  blocks: WeeklyHoursBlock[],
  id: string,
  deltaMinutes: number,
): WeeklyHoursBlock[] {
  return normalizeBlocks(
    blocks.map((b) => {
      if (b.id !== id) return b;
      const end = clampMinutes(snapMinutes(b.endMinute + deltaMinutes));
      return { ...b, endMinute: Math.max(b.startMinute + MIN_BLOCK_MINUTES, end) };
    }),
  );
}

export function removeBlock(blocks: WeeklyHoursBlock[], id: string): WeeklyHoursBlock[] {
  return blocks.filter((b) => b.id !== id);
}

/** Returns human-readable problems with a template, or an empty array when valid. */
export function validateTemplate(template: ScheduleTemplate): string[] {
  const errors: string[] = [];
  if (!template.name.trim()) errors.push('Template name is required.');
  if (!(ALLOWED_SLOT_MINUTES as readonly number[]).includes(template.slotMinutes)) {
    errors.push(`Slot length must be one of ${ALLOWED_SLOT_MINUTES.join(', ')} minutes.`);
  }
  for (const block of template.blocks) {
    if (
      block.startMinute < 0 ||
      block.endMinute > MINUTES_PER_DAY ||
      block.endMinute <= block.startMinute
    ) {
      errors.push(`Invalid hours on ${WEEKDAY_LABELS[block.day]}.`);
    }
  }
  const sorted = sortBlocks(template.blocks);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (prev.day === cur.day && overlaps(prev, cur)) {
      errors.push(`Overlapping hours on ${WEEKDAY_LABELS[cur.day]}.`);
    }
  }
  return errors;
}

export function totalWeeklyMinutes(blocks: WeeklyHoursBlock[]): number {
  return blocks.reduce((sum, b) => sum + (b.endMinute - b.startMinute), 0);
}

/* ─── Preset templates ──────────────────────────────────────────────────── */

function weekdayBlocks(ranges: Array<[number, number]>, days: Weekday[]): WeeklyHoursBlock[] {
  return days.flatMap((day) =>
    ranges.map(([startH, endH]) => ({
      id: createId('block'),
      day,
      startMinute: startH * 60,
      endMinute: endH * 60,
    })),
  );
}

export type PresetTemplateKey = 'standard' | 'surgery' | 'vacation';

export function createPresetTemplate(key: PresetTemplateKey): ScheduleTemplate {
  switch (key) {
    case 'standard':
      return {
        id: createId('tpl'),
        name: 'Standard Clinic Week',
        slotMinutes: 30,
        blocks: weekdayBlocks(
          [
            [9, 12],
            [13, 17],
          ],
          [0, 1, 2, 3, 4],
        ),
      };
    case 'surgery':
      // Theatre days Tue/Thu, short clinics Mon/Wed/Fri mornings.
      return {
        id: createId('tpl'),
        name: 'Surgery Week',
        slotMinutes: 20,
        blocks: weekdayBlocks([[8, 11]], [0, 2, 4]),
      };
    case 'vacation':
      return { id: createId('tpl'), name: 'Vacation', slotMinutes: 30, blocks: [] };
  }
}

export function createDefaultTemplates(): ScheduleTemplate[] {
  return [
    createPresetTemplate('standard'),
    createPresetTemplate('surgery'),
    createPresetTemplate('vacation'),
  ];
}

/* ─── Overrides ─────────────────────────────────────────────────────────── */

/** Adds or replaces the override for `override.date` (one override per date). */
export function upsertOverride(overrides: DateOverride[], override: DateOverride): DateOverride[] {
  return [...overrides.filter((o) => o.date !== override.date), override].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

export function validateOverride(override: DateOverride): string | null {
  if (!parseDateKey(override.date)) return 'Pick a valid date.';
  if (!override.label.trim()) return 'Add a label (e.g. "Christmas Day").';
  if (override.kind === 'custom') {
    const blocks = override.blocks ?? [];
    if (blocks.length === 0) return 'Custom hours need at least one time range.';
    if (
      blocks.some(
        (b) => b.endMinute <= b.startMinute || b.startMinute < 0 || b.endMinute > MINUTES_PER_DAY,
      )
    ) {
      return 'End time must be after start time.';
    }
  }
  return null;
}

/* ─── Slot generation ───────────────────────────────────────────────────── */

export interface GenerateSlotsOptions {
  template: ScheduleTemplate;
  overrides: DateOverride[];
  /** First day (inclusive), local time. */
  from: Date;
  /** Number of days to generate, starting at `from`. */
  days: number;
  /** Doctor identifier used to derive deterministic slot ids. */
  doctorId: string;
  /** Gap kept free after each slot (from the availability buffer config). */
  bufferMinutes?: number;
  /** Slots starting before this instant are skipped (default: now). */
  notBefore?: Date;
}

/**
 * Expands a weekly template into concrete slots for a date range.
 *
 * - Date overrides win over the template: `holiday`/`conference` remove the day,
 *   `custom` replaces that day's hours.
 * - Slot ids are deterministic (`doctorId` + start instant), so republishing the
 *   same range is idempotent and the backend can detect duplicates.
 * - Times are interpreted in the doctor's local time zone; DST shifts are handled
 *   by building each slot from calendar fields rather than adding milliseconds.
 */
export function generateSlots({
  template,
  overrides,
  from,
  days,
  doctorId,
  bufferMinutes = 0,
  notBefore = new Date(),
}: GenerateSlotsOptions): TimeSlot[] {
  const overrideByDate = new Map(overrides.map((o) => [o.date, o]));
  const step = template.slotMinutes + Math.max(0, bufferMinutes);
  const slots: TimeSlot[] = [];

  for (let offset = 0; offset < days; offset++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    const override = overrideByDate.get(toDateKey(day));

    let ranges: Array<{ startMinute: number; endMinute: number }>;
    if (override) {
      ranges = override.kind === 'custom' ? (override.blocks ?? []) : [];
    } else {
      const weekday = toWeekday(day);
      ranges = template.blocks.filter((b) => b.day === weekday);
    }

    for (const range of ranges) {
      for (
        let start = range.startMinute;
        start + template.slotMinutes <= range.endMinute;
        start += step
      ) {
        const slotStart = new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          Math.floor(start / 60),
          start % 60,
        );
        if (slotStart < notBefore) continue;
        const datetime = slotStart.toISOString();
        slots.push({
          id: `${doctorId}:${datetime}`,
          datetime,
          available: true,
          slotType: 'regular',
        });
      }
    }
  }

  return slots.sort((a, b) => a.datetime.localeCompare(b.datetime));
}

/* ─── Conflict pre-check ────────────────────────────────────────────────── */

export interface BusyInterval {
  datetime: string;
  durationMinutes: number;
  kind: 'slot' | 'appointment';
}

/**
 * Client-side conflict pre-check against already-published slots and booked
 * appointments. This is only a fast-fail for the UI: the backend repeats the check
 * inside the atomic publish transaction, which is the source of truth.
 */
export function findSlotConflicts(
  candidates: TimeSlot[],
  slotMinutes: number,
  busy: BusyInterval[],
): SlotConflict[] {
  const intervals = busy
    .map((b) => {
      const start = new Date(b.datetime).getTime();
      return { start, end: start + b.durationMinutes * 60_000, kind: b.kind };
    })
    .filter((b) => !Number.isNaN(b.start))
    .sort((a, b) => a.start - b.start);

  const conflicts: SlotConflict[] = [];
  for (const slot of candidates) {
    const start = new Date(slot.datetime).getTime();
    const end = start + slotMinutes * 60_000;
    const hit = intervals.find((i) => i.start < end && start < i.end);
    if (hit) {
      conflicts.push({
        slotId: slot.id,
        datetime: slot.datetime,
        reason:
          hit.kind === 'appointment' ? 'overlaps_booked_appointment' : 'overlaps_existing_slot',
      });
    }
  }
  return conflicts;
}

export function describeConflictReason(reason: SlotConflict['reason']): string {
  switch (reason) {
    case 'overlaps_booked_appointment':
      return 'overlaps a booked appointment';
    case 'overlaps_existing_slot':
      return 'overlaps an existing slot';
    case 'in_past':
      return 'is in the past';
    default:
      return reason;
  }
}
