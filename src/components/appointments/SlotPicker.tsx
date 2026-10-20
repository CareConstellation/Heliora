'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSlots } from '@/services/api.service';
import { evaluateRecurringPlan } from '@/lib/rrule';
import type { TimeSlot, RecurrenceCadence, RecurringAppointmentPlan } from '@/types';

interface Props {
  doctorId: string;
  selected: TimeSlot | null;
  onSelect: (slot: TimeSlot) => void;
  recurringPlan?: RecurringAppointmentPlan | null;
  onSelectRecurringPlan?: (plan: RecurringAppointmentPlan | null) => void;
  baseFee?: number;
}

function groupByDate(slots: TimeSlot[]) {
  return slots.reduce<Record<string, TimeSlot[]>>((acc, slot) => {
    const date = new Date(slot.datetime).toLocaleDateString();
    (acc[date] ??= []).push(slot);
    return acc;
  }, {});
}

export default function SlotPicker({
  doctorId,
  selected,
  onSelect,
  recurringPlan,
  onSelectRecurringPlan,
  baseFee = 10,
}: Props) {
  const [cadence, setCadence] = useState<RecurrenceCadence>('none');
  const [sessionCount, setSessionCount] = useState<number>(4);

  const { data: slots, isLoading } = useQuery({
    queryKey: ['slots', doctorId],
    queryFn: () => fetchSlots(doctorId),
  });

  const activePlan = useMemo(() => {
    if (!selected || cadence === 'none' || !slots) return null;
    return evaluateRecurringPlan(selected, cadence, sessionCount, slots, baseFee);
  }, [selected, cadence, sessionCount, slots, baseFee]);

  const handleSelectSlot = (slot: TimeSlot) => {
    onSelect(slot);
    if (cadence !== 'none' && slots) {
      const plan = evaluateRecurringPlan(slot, cadence, sessionCount, slots, baseFee);
      onSelectRecurringPlan?.(plan);
    } else {
      onSelectRecurringPlan?.(null);
    }
  };

  const handleCadenceChange = (newCadence: RecurrenceCadence) => {
    setCadence(newCadence);
    if (newCadence === 'none') {
      onSelectRecurringPlan?.(null);
    } else if (selected && slots) {
      const plan = evaluateRecurringPlan(selected, newCadence, sessionCount, slots, baseFee);
      onSelectRecurringPlan?.(plan);
    }
  };

  const handleSessionCountChange = (count: number) => {
    setSessionCount(count);
    if (cadence !== 'none' && selected && slots) {
      const plan = evaluateRecurringPlan(selected, cadence, count, slots, baseFee);
      onSelectRecurringPlan?.(plan);
    }
  };

  if (isLoading) return <div className="animate-pulse h-32 rounded-xl bg-surface-card" />;

  const grouped = groupByDate(
    slots?.filter((s) => s.available || s.slotType === 'buffer') ?? [],
  );
  const dates = Object.keys(grouped);

  if (dates.length === 0) return <p className="text-sm text-text-3">No available slots.</p>;

  const currentPlan = recurringPlan ?? activePlan;

  return (
    <div className="space-y-5">
      {/* Recurrence Cadence Mode Selector */}
      <div className="rounded-xl border border-border bg-surface-card p-3 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-text-1">Consultation Cadence</label>
          <span className="text-2xs text-text-3">RFC 5545 RRULE Compliant</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: 'none', label: 'Single Visit', desc: '1 session' },
              { id: 'weekly', label: 'Weekly Cadence', desc: 'Physical therapy / Oncology' },
              { id: 'bi-weekly', label: 'Bi-Weekly Cadence', desc: 'Routine follow-up' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleCadenceChange(opt.id)}
              className={`rounded-lg border p-2 text-left transition-colors ${
                cadence === opt.id
                  ? 'border-green bg-green/10 text-text-1 font-medium'
                  : 'border-border bg-surface-inset text-text-2 hover:bg-surface-hover'
              }`}
            >
              <div className="text-xs">{opt.label}</div>
              <div className="text-2xs text-text-3 truncate">{opt.desc}</div>
            </button>
          ))}
        </div>

        {cadence !== 'none' && (
          <div className="pt-2 border-t border-border flex items-center justify-between">
            <span className="text-xs text-text-2">Recurring Sessions:</span>
            <div className="flex gap-2">
              {[
                { count: 4, discount: '10% off' },
                { count: 6, discount: '15% off' },
                { count: 8, discount: '20% off' },
              ].map((opt) => (
                <button
                  key={opt.count}
                  type="button"
                  onClick={() => handleSessionCountChange(opt.count)}
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    sessionCount === opt.count
                      ? 'border-green bg-green text-[#030D09] font-medium'
                      : 'border-border bg-surface-inset text-text-2 hover:bg-surface-hover'
                  }`}
                >
                  {opt.count} sessions ({opt.discount})
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Available Slots Grouped by Date */}
      <div>
        <p className="text-xs font-medium text-text-2 mb-2">
          {cadence === 'none' ? 'Select Date & Time:' : 'Select Starting Slot:'}
        </p>
        <div className="space-y-3">
          {dates.map((date) => (
            <div key={date}>
              <p className="text-2xs font-medium text-text-3 mb-1.5">{date}</p>
              <div className="flex flex-wrap gap-2">
                {grouped[date]?.map((slot) => {
                  const isBuffer = slot.slotType === 'buffer';
                  const isEmergency = slot.slotType === 'emergency';
                  const isSelected = selected?.id === slot.id;
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => !isBuffer && handleSelectSlot(slot)}
                      disabled={isBuffer}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                        isBuffer
                          ? 'border-border bg-surface-inset text-text-3 opacity-50 cursor-not-allowed'
                          : isSelected
                            ? 'bg-green text-[#030D09] border-green'
                            : isEmergency
                              ? 'border-orange-400 text-orange-400 hover:bg-orange-400/10'
                              : 'border-border text-text-1 hover:bg-surface-hover'
                      }`}
                    >
                      {isEmergency && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400 mr-1.5" />
                      )}
                      {new Date(slot.datetime).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {isBuffer && ' (buffer)'}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Unified Recurring Plan Summary & Atomic Slot Lock Matrix */}
      {cadence !== 'none' && currentPlan && (
        <div className="rounded-xl border border-border bg-surface-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-1">Recurring Plan Summary</span>
            <span className="font-mono text-2xs px-2 py-0.5 rounded bg-surface-inset text-text-2 border border-border">
              {currentPlan.rrule}
            </span>
          </div>

          {/* Bundle Pricing Card */}
          <div className="rounded-lg bg-surface-inset p-3 flex items-center justify-between text-xs">
            <div>
              <div className="text-text-2">
                {currentPlan.count} Sessions × {baseFee} XLM
              </div>
              {currentPlan.bundleDiscountPercent > 0 && (
                <div className="text-2xs text-green">
                  Bundle savings: {currentPlan.bundleDiscountPercent}% off (Save{' '}
                  {currentPlan.totalOriginalFee - currentPlan.finalBundleFee} XLM)
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-2xs text-text-3 line-through">
                {currentPlan.totalOriginalFee} XLM
              </div>
              <div className="text-sm font-bold text-text-1">
                {currentPlan.finalBundleFee} XLM
              </div>
            </div>
          </div>

          {/* Atomic Availability Check */}
          <div>
            <div className="flex items-center justify-between text-2xs mb-2">
              <span className="text-text-2">Automated Calendar Slot Locking:</span>
              <span
                className={`font-semibold ${currentPlan.allAvailable ? 'text-green' : 'text-red-500'}`}
              >
                {currentPlan.allAvailable ? 'All Slots Verified & Locked' : 'Scheduling Conflict Detected'}
              </span>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {currentPlan.occurrences.map((occ, idx) => (
                <div
                  key={idx}
                  className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs border ${
                    occ.isAvailable
                      ? 'border-border bg-surface-inset text-text-1'
                      : 'border-red-500/40 bg-red-500/10 text-red-400'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-2xs font-mono text-text-3">#{idx + 1}</span>
                    <span>{new Date(occ.datetime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </div>
                  <div>
                    {occ.isAvailable ? (
                      <span className="inline-flex items-center gap-1 text-2xs text-green font-medium">
                        <span>✓</span> Available
                      </span>
                    ) : (
                      <span className="text-2xs text-red-500 font-medium">
                        {occ.conflictReason ?? 'Unavailable'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {!currentPlan.allAvailable && (
            <p role="alert" className="text-xs text-red-500">
              One or more target recurring slots are unavailable or reserved as buffer. Please choose another starting slot.
            </p>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 pt-1 text-2xs text-text-3">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-orange-400" /> Emergency
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-gray-400 opacity-50" /> Buffer
        </span>
      </div>
    </div>
  );
}
