'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchSlots } from '@/services/api.service';
import type { TimeSlot } from '@/types';

interface Props {
  doctorId: string;
  selected: TimeSlot | null;
  onSelect: (slot: TimeSlot) => void;
}

function groupByDate(slots: TimeSlot[]) {
  return slots.reduce<Record<string, TimeSlot[]>>((acc, slot) => {
    const date = new Date(slot.datetime).toLocaleDateString();
    (acc[date] ??= []).push(slot);
    return acc;
  }, {});
}

export default function SlotPicker({ doctorId, selected, onSelect }: Props) {
  const { data: slots, isLoading } = useQuery({
    queryKey: ['slots', doctorId],
    queryFn: () => fetchSlots(doctorId),
  });

  if (isLoading) return <div className="animate-pulse h-32 rounded-xl bg-surface-card" />;

  const grouped = groupByDate(
    slots?.filter((s) => s.available || s.slotType === 'buffer') ?? [],
  );
  const dates = Object.keys(grouped);

  if (dates.length === 0) return <p className="text-sm text-text-3">No available slots.</p>;

  return (
    <div className="space-y-4">
      {dates.map((date) => (
        <div key={date}>
          <p className="text-xs font-medium text-text-2 mb-2">{date}</p>
          <div className="flex flex-wrap gap-2">
            {grouped[date]?.map((slot) => {
              const isBuffer = slot.slotType === 'buffer';
              const isEmergency = slot.slotType === 'emergency';
              return (
                <button
                  key={slot.id}
                  onClick={() => !isBuffer && onSelect(slot)}
                  disabled={isBuffer}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    isBuffer
                      ? 'border-border bg-surface-inset text-text-3 opacity-50 cursor-not-allowed'
                      : selected?.id === slot.id
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
      <div className="flex items-center gap-4 pt-2 text-2xs text-text-3">
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
