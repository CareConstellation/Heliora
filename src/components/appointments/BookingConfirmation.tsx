'use client';

import { useState, useEffect, useRef } from 'react';
import type { Appointment } from '@/types';
import { CancellationPolicyMatrix } from './CancellationPolicy';
import { buildICS } from '@/lib/calendarLinks';

interface Props {
  appointment: Appointment;
  onDone: () => void;
}

export default function BookingConfirmation({ appointment, onDone }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  function downloadICS() {
    const blob = new Blob([buildICS(appointment)], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `appointment-${appointment.id}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
  }

  return (
    <div className="flex flex-col items-center text-center py-12 px-4">
      <div className="text-5xl mb-4">✅</div>
      <h2 className="text-xl font-bold text-text-1 mb-2">Booking Confirmed!</h2>
      <p className="text-sm text-text-2 mb-1">
        Appointment with <span className="font-medium">Dr. {appointment.doctorName}</span>
      </p>
      <p className="text-sm text-text-2 mb-1">
        {new Date(appointment.datetime).toLocaleString()} · {appointment.type}
      </p>
      <p className="text-xs text-text-3 mb-6">Ref: {appointment.id}</p>

      <CancellationPolicyMatrix doctorId={appointment.doctorId} />

      <div className="flex gap-3 mt-4">
        <button
          onClick={downloadICS}
          className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-1 hover:bg-surface-hover"
        >
          📅 Add to Calendar
        </button>
        <button
          onClick={onDone}
          className="rounded-md bg-green px-4 py-2 text-sm font-semibold text-[#030D09] hover:bg-green-600"
        >
          Done
        </button>
      </div>
    </div>
  );
}
