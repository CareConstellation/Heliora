'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CheckCircle2,
  GripVertical,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  fetchAppointments,
  fetchAvailabilityConfig,
  fetchScheduleSettings,
  fetchSlots,
  getSlotConflicts,
  publishSlotsBulk,
  saveScheduleSettings,
  type ApiError,
} from '@/services/api.service';
import {
  ALLOWED_SLOT_MINUTES,
  MAX_PUBLISH_SLOTS,
  MAX_PUBLISH_WEEKS,
  SNAP_MINUTES,
  WEEKDAYS,
  WEEKDAY_LABELS,
  addBlock,
  createDefaultTemplates,
  createId,
  createPresetTemplate,
  describeConflictReason,
  findSlotConflicts,
  formatMinutes,
  generateSlots,
  moveBlock,
  removeBlock,
  resizeBlock,
  totalWeeklyMinutes,
  validateTemplate,
  type BusyInterval,
  type PresetTemplateKey,
} from '@/lib/scheduleTemplates';
import { traceUserAction } from '@/lib/sentry';
import { useWalletStore } from '@/store/useWalletStore';
import ScheduleOverridePicker from './ScheduleOverridePicker';
import SlotBatchPublisher from './SlotBatchPublisher';
import type {
  BulkSlotPublishResult,
  DoctorScheduleSettings,
  ScheduleTemplate,
  SlotConflict,
  TimeSlot,
  Weekday,
  WeeklyHoursBlock,
} from '@/types';

/* ─── Grid geometry ───────────────────────────────────────────────── */

const GRID_START = 6 * 60;
const GRID_END = 22 * 60;
const ROW_PX = 14;
const ROWS = (GRID_END - GRID_START) / SNAP_MINUTES;
/** On-chain initialization is limited to 100 slots per run (see slotBatcher). */
const ONCHAIN_BATCH_LIMIT = 100;

const PALETTE: Array<{ label: string; minutes: number }> = [
  { label: '1 h', minutes: 60 },
  { label: '2 h', minutes: 120 },
  { label: '4 h shift', minutes: 240 },
];

type DragPayload = { type: 'move'; id: string } | { type: 'new'; minutes: number };

export const SCHEDULE_SETTINGS_KEY = (address: string | null) =>
  ['schedule-settings', address] as const;

function emptySettings(): DoctorScheduleSettings {
  const templates = createDefaultTemplates();
  return { templates, activeTemplateId: templates[0]?.id ?? null, overrides: [] };
}

export default function ScheduleTemplateBuilder() {
  const { publicKey: address } = useWalletStore();
  const queryClient = useQueryClient();

  const {
    data: saved,
    isLoading,
    isError,
  } = useQuery({
    queryKey: SCHEDULE_SETTINGS_KEY(address),
    queryFn: () => fetchScheduleSettings(address!),
    enabled: !!address,
    retry: false,
  });

  const { data: availability } = useQuery({
    queryKey: ['availability-config', address],
    queryFn: () => fetchAvailabilityConfig(address!),
    enabled: !!address,
    retry: false,
  });

  const [settings, setSettings] = useState<DoctorScheduleSettings>(emptySettings);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Adopt freshly fetched settings during render (not in an effect) so the default
  // presets never flash on screen before the saved templates replace them.
  const [syncedFrom, setSyncedFrom] = useState<DoctorScheduleSettings | undefined>(undefined);
  if (saved && saved !== syncedFrom && saved.templates.length > 0) {
    setSyncedFrom(saved);
    setSettings(saved);
    setEditingId(saved.activeTemplateId ?? saved.templates[0]?.id ?? null);
    setDirty(false);
  }

  useEffect(() => {
    if (!editingId && settings.templates[0]) setEditingId(settings.templates[0].id);
  }, [editingId, settings.templates]);

  const editing = settings.templates.find((t) => t.id === editingId) ?? null;
  const active = settings.templates.find((t) => t.id === settings.activeTemplateId) ?? null;

  function update(next: Partial<DoctorScheduleSettings>) {
    setSettings((prev) => ({ ...prev, ...next }));
    setDirty(true);
  }

  function updateTemplate(id: string, patch: Partial<ScheduleTemplate>) {
    setSettings((prev) => ({
      ...prev,
      templates: prev.templates.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
    setDirty(true);
  }

  function addTemplate(preset: PresetTemplateKey | 'blank') {
    const template =
      preset === 'blank'
        ? { id: createId('tpl'), name: 'New template', slotMinutes: 30, blocks: [] }
        : createPresetTemplate(preset);
    update({ templates: [...settings.templates, template] });
    setEditingId(template.id);
  }

  function deleteTemplate(id: string) {
    const templates = settings.templates.filter((t) => t.id !== id);
    update({
      templates,
      activeTemplateId:
        settings.activeTemplateId === id ? (templates[0]?.id ?? null) : settings.activeTemplateId,
    });
    if (editingId === id) setEditingId(templates[0]?.id ?? null);
  }

  const templateErrors = editing ? validateTemplate(editing) : [];

  const save = useMutation<DoctorScheduleSettings, ApiError>({
    mutationFn: () => saveScheduleSettings(address!, settings),
    onSuccess: (data) => {
      queryClient.setQueryData(SCHEDULE_SETTINGS_KEY(address), data);
      setDirty(false);
    },
  });

  if (isLoading) {
    return <div className="animate-pulse h-64 rounded-[14px] bg-surface-card" />;
  }

  return (
    <div
      className="rounded-[14px] p-5 space-y-5"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text-1 flex items-center gap-2">
          <CalendarClock className="w-4 h-4" /> Schedule templates
        </h2>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={!address || !dirty || save.isPending || templateErrors.length > 0}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
          style={{
            background: 'rgba(0,200,150,0.1)',
            color: '#00C896',
            border: '1px solid rgba(0,200,150,0.2)',
          }}
        >
          {save.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          Save templates
        </button>
      </div>

      {isError && (
        <p className="text-2xs text-text-3">
          No saved templates found; starting from the default presets.
        </p>
      )}
      {save.isError && (
        <p role="alert" className="text-2xs" style={{ color: '#F87171' }}>
          {save.error.status === 409
            ? 'Templates were changed in another session. Reload to see the latest version.'
            : `Could not save templates: ${save.error.message}`}
        </p>
      )}

      {/* Template list & activation toggle */}
      <div className="space-y-2">
        <div
          role="radiogroup"
          aria-label="Active schedule template"
          className="flex flex-wrap gap-2"
        >
          {settings.templates.map((t) => (
            <div
              key={t.id}
              className={`flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-xs ${
                t.id === editingId ? 'bg-surface-hover' : ''
              }`}
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <input
                type="radio"
                name="active-template"
                aria-label={`Use ${t.name} as active template`}
                checked={settings.activeTemplateId === t.id}
                onChange={() => update({ activeTemplateId: t.id })}
              />
              <button type="button" onClick={() => setEditingId(t.id)} className="text-text-1">
                {t.name}
              </button>
              {settings.activeTemplateId === t.id && (
                <span className="badge-green text-2xs">active</span>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 text-2xs">
          <span className="text-text-3">New from preset:</span>
          {(['standard', 'surgery', 'vacation'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => addTemplate(key)}
              className="inline-flex items-center gap-1 text-text-2 hover:text-text-1"
            >
              <Plus className="w-3 h-3" />
              {key === 'standard'
                ? 'Standard Clinic Week'
                : key === 'surgery'
                  ? 'Surgery Week'
                  : 'Vacation'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => addTemplate('blank')}
            className="inline-flex items-center gap-1 text-text-2 hover:text-text-1"
          >
            <Plus className="w-3 h-3" /> Blank
          </button>
        </div>
      </div>

      {editing && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-2xs text-text-2">
              Template name
              <input
                type="text"
                value={editing.name}
                onChange={(e) => updateTemplate(editing.id, { name: e.target.value })}
                className="mt-1 block rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-xs text-text-1"
              />
            </label>
            <label className="text-2xs text-text-2">
              Slot length
              <select
                value={editing.slotMinutes}
                onChange={(e) =>
                  updateTemplate(editing.id, { slotMinutes: Number(e.target.value) })
                }
                className="mt-1 block rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-xs text-text-1"
              >
                {ALLOWED_SLOT_MINUTES.map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </label>
            <span className="text-2xs text-text-3">
              {(totalWeeklyMinutes(editing.blocks) / 60).toFixed(1)} h / week
            </span>
            {settings.templates.length > 1 && (
              <button
                type="button"
                onClick={() => deleteTemplate(editing.id)}
                className="ml-auto inline-flex items-center gap-1 text-2xs text-text-3 hover:text-red-400"
              >
                <Trash2 className="w-3 h-3" /> Delete template
              </button>
            )}
          </div>

          {templateErrors.length > 0 && (
            <ul role="alert" className="text-2xs" style={{ color: '#F87171' }}>
              {templateErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <WeeklyScheduleGrid
            blocks={editing.blocks}
            onChange={(blocks) => updateTemplate(editing.id, { blocks })}
          />
        </div>
      )}

      <ScheduleOverridePicker
        overrides={settings.overrides}
        onChange={(overrides) => update({ overrides })}
      />

      <SchedulePublisher
        address={address}
        template={active}
        settings={settings}
        bufferMinutes={availability?.bufferMinutes ?? 0}
      />
    </div>
  );
}

/* ─── Drag-and-drop weekly grid ───────────────────────────────────── */

export function WeeklyScheduleGrid({
  blocks,
  onChange,
}: {
  blocks: WeeklyHoursBlock[];
  onChange: (blocks: WeeklyHoursBlock[]) => void;
}) {
  // dataTransfer payloads are unreadable during dragover in some browsers, so the
  // payload is also kept in a ref for the duration of the drag.
  const dragRef = useRef<DragPayload | null>(null);
  const [hoverCell, setHoverCell] = useState<string | null>(null);

  function startDrag(e: React.DragEvent, payload: DragPayload) {
    dragRef.current = payload;
    try {
      e.dataTransfer?.setData('application/json', JSON.stringify(payload));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = payload.type === 'move' ? 'move' : 'copy';
    } catch {
      // Older browsers reject custom MIME types; the ref still carries the payload.
    }
  }

  function readPayload(e: React.DragEvent): DragPayload | null {
    if (dragRef.current) return dragRef.current;
    try {
      const raw = e.dataTransfer?.getData('application/json');
      return raw ? (JSON.parse(raw) as DragPayload) : null;
    } catch {
      return null;
    }
  }

  function drop(e: React.DragEvent, day: Weekday, minute: number) {
    e.preventDefault();
    const payload = readPayload(e);
    dragRef.current = null;
    setHoverCell(null);
    if (!payload) return;
    onChange(
      payload.type === 'move'
        ? moveBlock(blocks, payload.id, day, minute)
        : addBlock(blocks, day, minute, payload.minutes),
    );
  }

  function onBlockKeyDown(e: KeyboardEvent<HTMLDivElement>, block: WeeklyHoursBlock) {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -SNAP_MINUTES],
      ArrowDown: [0, SNAP_MINUTES],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onChange(removeBlock(blocks, block.id));
      return;
    }
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    const day = Math.max(0, Math.min(6, block.day + move[0])) as Weekday;
    onChange(moveBlock(blocks, block.id, day, block.startMinute + move[1]));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-2xs text-text-3">
        <span>Drag onto the grid:</span>
        {PALETTE.map((p) => (
          <div
            key={p.minutes}
            draggable
            role="button"
            tabIndex={0}
            aria-label={`Drag a ${p.label} block onto the schedule`}
            onDragStart={(e) => startDrag(e, { type: 'new', minutes: p.minutes })}
            onDragEnd={() => (dragRef.current = null)}
            className="inline-flex cursor-grab items-center gap-1 rounded px-2 py-1 text-text-1"
            style={{ background: 'rgba(0,200,150,0.15)' }}
          >
            <GripVertical className="w-3 h-3" /> {p.label}
          </div>
        ))}
        <span>Drag blocks to move · arrow keys move a focused block · Delete removes it.</span>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[560px]" style={{ gridTemplateColumns: '40px repeat(7, 1fr)' }}>
          <div />
          {WEEKDAYS.map((day) => (
            <div key={day} className="text-center text-2xs font-medium text-text-2 pb-1">
              {WEEKDAY_LABELS[day]}
            </div>
          ))}

          <div className="relative" style={{ height: ROWS * ROW_PX }}>
            {Array.from({ length: ROWS / 2 }, (_, i) => (
              <span
                key={i}
                className="absolute right-1 text-[9px] text-text-3"
                style={{ top: i * 2 * ROW_PX - 5 }}
              >
                {formatMinutes(GRID_START + i * 60)}
              </span>
            ))}
          </div>

          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="relative border-l"
              style={{ height: ROWS * ROW_PX, borderColor: 'rgba(255,255,255,0.06)' }}
              data-testid={`schedule-day-${day}`}
            >
              {Array.from({ length: ROWS }, (_, row) => {
                const minute = GRID_START + row * SNAP_MINUTES;
                const cellId = `${day}-${minute}`;
                return (
                  <div
                    key={row}
                    data-testid={`schedule-cell-${day}-${minute}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setHoverCell(cellId);
                    }}
                    onDragLeave={() => setHoverCell((c) => (c === cellId ? null : c))}
                    onDrop={(e) => drop(e, day, minute)}
                    className="absolute inset-x-0"
                    style={{
                      top: row * ROW_PX,
                      height: ROW_PX,
                      borderTop: row % 2 === 0 ? '1px solid rgba(255,255,255,0.04)' : undefined,
                      background: hoverCell === cellId ? 'rgba(0,200,150,0.2)' : undefined,
                    }}
                  />
                );
              })}

              {blocks
                .filter((b) => b.day === day)
                .map((b) => {
                  const top =
                    ((Math.max(b.startMinute, GRID_START) - GRID_START) / SNAP_MINUTES) * ROW_PX;
                  const bottom =
                    ((Math.min(b.endMinute, GRID_END) - GRID_START) / SNAP_MINUTES) * ROW_PX;
                  const label = `${WEEKDAY_LABELS[b.day]} ${formatMinutes(b.startMinute)}–${formatMinutes(b.endMinute)}`;
                  return (
                    <div
                      key={b.id}
                      draggable
                      tabIndex={0}
                      role="group"
                      aria-label={`Working hours ${label}`}
                      onDragStart={(e) => startDrag(e, { type: 'move', id: b.id })}
                      onDragEnd={() => (dragRef.current = null)}
                      onKeyDown={(e) => onBlockKeyDown(e, b)}
                      className="absolute inset-x-0.5 cursor-move rounded-[4px] px-1 text-[10px] leading-tight text-text-1 focus:outline-none focus:ring-2 focus:ring-border-focus"
                      style={{
                        top,
                        height: Math.max(bottom - top, ROW_PX),
                        background: 'rgba(0,200,150,0.25)',
                        border: '1px solid rgba(0,200,150,0.5)',
                      }}
                    >
                      <span className="block truncate">
                        {formatMinutes(b.startMinute)}–{formatMinutes(b.endMinute)}
                      </span>
                      <span className="flex gap-1">
                        <button
                          type="button"
                          aria-label={`Shorten ${label}`}
                          onClick={() => onChange(resizeBlock(blocks, b.id, -SNAP_MINUTES))}
                        >
                          −
                        </button>
                        <button
                          type="button"
                          aria-label={`Extend ${label}`}
                          onClick={() => onChange(resizeBlock(blocks, b.id, SNAP_MINUTES))}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${label}`}
                          onClick={() => onChange(removeBlock(blocks, b.id))}
                        >
                          ×
                        </button>
                      </span>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Bulk publish with atomic conflict verification ──────────────── */

function SchedulePublisher({
  address,
  template,
  settings,
  bufferMinutes,
}: {
  address: string | null;
  template: ScheduleTemplate | null;
  settings: DoctorScheduleSettings;
  bufferMinutes: number;
}) {
  const [weeks, setWeeks] = useState(4);
  const [conflicts, setConflicts] = useState<SlotConflict[] | null>(null);
  const [published, setPublished] = useState<BulkSlotPublishResult | null>(null);
  // One key per distinct slot set: retries of the same publish reuse it.
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null);

  const slots = useMemo<TimeSlot[]>(() => {
    if (!template || !address) return [];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return generateSlots({
      template,
      overrides: settings.overrides,
      from: tomorrow,
      days: weeks * 7,
      doctorId: address,
      bufferMinutes,
    });
  }, [template, settings.overrides, weeks, address, bufferMinutes]);

  useEffect(() => {
    setConflicts(null);
  }, [slots]);

  const tooMany = slots.length > MAX_PUBLISH_SLOTS;

  const publish = useMutation<BulkSlotPublishResult, ApiError>({
    mutationFn: () =>
      traceUserAction('doctor.schedule.publish', async () => {
        if (!address || !template) throw new Error('Select an active template first.');

        // Fast local pre-check; the backend repeats it atomically.
        const [existingSlots, appointments] = await Promise.all([
          fetchSlots(address),
          fetchAppointments(address, 'doctor'),
        ]);
        const generatedIds = new Set(slots.map((s) => s.id));
        const busy: BusyInterval[] = [
          ...existingSlots
            .filter((s) => !generatedIds.has(s.id))
            .map((s) => ({
              datetime: s.datetime,
              durationMinutes: template.slotMinutes,
              kind: 'slot' as const,
            })),
          ...appointments
            .filter((a) => a.status !== 'cancelled')
            .map((a) => ({
              datetime: a.datetime,
              durationMinutes: template.slotMinutes,
              kind: 'appointment' as const,
            })),
        ];
        const local = findSlotConflicts(slots, template.slotMinutes, busy);
        if (local.length > 0) {
          throw {
            message: 'conflicts',
            status: 409,
            code: 'LOCAL_CONFLICT',
            data: { conflicts: local },
          } as ApiError;
        }

        const signature = `${slots.length}:${slots[0]?.id}:${slots[slots.length - 1]?.id}`;
        if (idempotencyRef.current?.signature !== signature) {
          idempotencyRef.current = { signature, key: createId('publish') };
        }
        return publishSlotsBulk(address, slots, idempotencyRef.current.key);
      }),
    onMutate: () => {
      setConflicts(null);
      setPublished(null);
    },
    onSuccess: (result) => {
      idempotencyRef.current = null;
      setPublished(result);
    },
    onError: (error) => {
      const found = getSlotConflicts(error);
      if (found) setConflicts(found);
    },
  });

  const genericError = publish.isError && !conflicts ? publish.error.message : null;

  return (
    <div className="space-y-3 border-t pt-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
      <h3 className="text-xs font-semibold text-text-1 flex items-center gap-1.5">
        <Upload className="w-3.5 h-3.5" /> Publish slots
      </h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-2xs text-text-2">
          Weeks ahead
          <select
            value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
            className="mt-1 block rounded-lg border border-border bg-surface-inset px-2 py-1.5 text-xs text-text-1"
          >
            {Array.from({ length: MAX_PUBLISH_WEEKS }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <p className="text-2xs text-text-3" aria-live="polite">
          {template ? (
            <>
              <strong className="text-text-1">{slots.length}</strong> slots from “{template.name}”
              {bufferMinutes > 0 && ` with ${bufferMinutes} min buffer`}
              {settings.overrides.length > 0 &&
                `, ${settings.overrides.length} override(s) applied`}
            </>
          ) : (
            'Choose an active template.'
          )}
        </p>
        <button
          type="button"
          onClick={() => publish.mutate()}
          disabled={!address || !template || slots.length === 0 || tooMany || publish.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
          style={{ background: '#00C896', color: '#0B0E0D' }}
        >
          {publish.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Publish {slots.length} slots
        </button>
      </div>

      {tooMany && (
        <p className="text-2xs" style={{ color: '#FCD34D' }}>
          At most {MAX_PUBLISH_SLOTS} slots can be published at once. Choose fewer weeks.
        </p>
      )}

      {conflicts && (
        <div
          role="alert"
          className="rounded-[8px] p-3 text-2xs"
          style={{ background: 'rgba(248,113,113,0.08)', color: '#F87171' }}
        >
          <p className="font-medium">
            Nothing was published: {conflicts.length || 'some'} slot
            {conflicts.length === 1 ? '' : 's'} conflict
            {conflicts.length === 1 ? 's' : ''}. Add an override or adjust the template, then
            publish again.
          </p>
          <ul className="mt-1 max-h-32 overflow-y-auto">
            {conflicts.slice(0, 20).map((c) => (
              <li key={c.slotId}>
                {new Date(c.datetime).toLocaleString()} — {describeConflictReason(c.reason)}
              </li>
            ))}
            {conflicts.length > 20 && <li>…and {conflicts.length - 20} more</li>}
          </ul>
        </div>
      )}

      {genericError && (
        <p role="alert" className="text-2xs" style={{ color: '#F87171' }}>
          Publish failed: {genericError}. No slots were published; it is safe to retry.
        </p>
      )}

      {published && (
        <div className="space-y-3">
          <p role="status" className="text-2xs text-green-500 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Published {published.published} slots (batch{' '}
            {published.batchId}).
          </p>
          {published.slots.length <= ONCHAIN_BATCH_LIMIT ? (
            <SlotBatchPublisher slots={published.slots} />
          ) : (
            <p className="text-2xs text-text-3">
              On-chain slot initialization runs in batches of {ONCHAIN_BATCH_LIMIT}; publish fewer
              weeks to initialize these slots on-chain from here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
