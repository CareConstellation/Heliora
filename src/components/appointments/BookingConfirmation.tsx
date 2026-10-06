'use client';

import type { Appointment } from '@/types';

interface Props {
  appointment: Appointment;
  onDone: () => void;
}

function buildICS(appt: Appointment): string {
  const start = new Date(appt.datetime);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:Appointment with Dr. ${appt.doctorName}`,
    `DESCRIPTION:Type: ${appt.type}`,
    `UID:${appt.id}@heliora`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export default function BookingConfirmation({ appointment, onDone }: Props) {
  function downloadICS() {
    const blob = new Blob([buildICS(appointment)], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `appointment-${appointment.id}.ics`;
    a.click();
    URL.revokeObjectURL(url);
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

      <div className="flex gap-3">
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
