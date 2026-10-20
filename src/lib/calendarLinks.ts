import type { Appointment } from '@/types';

const APPOINTMENT_DURATION_MS = 60 * 60 * 1000;

interface CalendarEventParams {
  title: string;
  start: Date;
  end: Date;
  description: string;
  location: string | undefined;
  uid: string;
}

function formatUTC(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let i = 75;
  while (i < line.length) {
    parts.push(' ' + line.slice(i, i + 74));
    i += 74;
  }
  return parts.join('\r\n');
}

function buildEventParams(appt: Appointment): CalendarEventParams {
  const start = new Date(appt.datetime);
  const end = new Date(start.getTime() + APPOINTMENT_DURATION_MS);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const lines: string[] = [
    `Type: ${appt.type === 'telemedicine' ? 'Telemedicine' : 'In-Person'}`,
    `Doctor: Dr. ${appt.doctorName}`,
    `Fee: ${appt.fee} XLM`,
    `Reference: ${appt.id}`,
  ];

  if (appt.type === 'telemedicine' && appt.videoRoomUrl) {
    lines.push('', `Join Video Call: ${appt.videoRoomUrl}`);
    lines.push('', 'Telemedicine Preparation:');
    lines.push('- Ensure stable internet connection');
    lines.push('- Test camera and microphone before the call');
    lines.push('- Have your medical documents ready');
  }

  lines.push('', `Cancel or reschedule: ${origin}/dashboard/patient/appointments`);

  return {
    title: `Appointment with Dr. ${appt.doctorName}`,
    start,
    end,
    description: lines.join('\n'),
    location:
      appt.type === 'telemedicine' && appt.videoRoomUrl ? appt.videoRoomUrl : undefined,
    uid: `${appt.id}@heliora`,
  };
}

export function googleCalendarUrl(appt: Appointment): string {
  const p = buildEventParams(appt);
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', p.title);
  url.searchParams.set('dates', `${formatUTC(p.start)}/${formatUTC(p.end)}`);
  url.searchParams.set('details', p.description);
  if (p.location) url.searchParams.set('location', p.location);
  return url.toString();
}

export function outlookCalendarUrl(appt: Appointment): string {
  const p = buildEventParams(appt);
  const url = new URL('https://outlook.live.com/calendar/0/deeplink/compose');
  url.searchParams.set('rru', 'addevent');
  url.searchParams.set('subject', p.title);
  url.searchParams.set('body', p.description);
  url.searchParams.set('startdt', p.start.toISOString());
  url.searchParams.set('enddt', p.end.toISOString());
  if (p.location) url.searchParams.set('location', p.location);
  url.searchParams.set('path', '/calendar/action/compose');
  return url.toString();
}

export function yahooCalendarUrl(appt: Appointment): string {
  const p = buildEventParams(appt);
  const totalMinutes = Math.floor(
    (p.end.getTime() - p.start.getTime()) / 60_000,
  );
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const mins = String(totalMinutes % 60).padStart(2, '0');

  const url = new URL('https://calendar.yahoo.com/');
  url.searchParams.set('v', '60');
  url.searchParams.set('view', 'd');
  url.searchParams.set('type', '20');
  url.searchParams.set('title', p.title);
  url.searchParams.set('st', formatUTC(p.start));
  url.searchParams.set('dur', `${hours}${mins}`);
  url.searchParams.set('desc', p.description);
  if (p.location) url.searchParams.set('in_loc', p.location);
  return url.toString();
}

export function buildICS(appt: Appointment): string {
  const p = buildEventParams(appt);
  const escaped = p.description
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Heliora//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `DTSTART:${formatUTC(p.start)}`,
    `DTEND:${formatUTC(p.end)}`,
    `SUMMARY:${p.title}`,
    `DESCRIPTION:${escaped}`,
    `UID:${p.uid}`,
    ...(p.location ? [`LOCATION:${p.location}`] : []),
    'STATUS:CONFIRMED',
    `DTSTAMP:${formatUTC(new Date())}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(foldLine).join('\r\n');
}
