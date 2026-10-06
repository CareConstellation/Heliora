import type { Appointment } from '@/types';

const DAILY_DOMAIN = process.env.NEXT_PUBLIC_DAILY_DOMAIN || 'heliora';
const APPOINTMENT_DURATION_MS = 60 * 60 * 1000; // matches BookingConfirmation's ICS event length
const JOIN_WINDOW_MS = 15 * 60 * 1000; // link becomes visible 15 min before start

export function generateVideoRoomUrl(appointmentId: string): string {
  return `https://${DAILY_DOMAIN}.daily.co/appt-${appointmentId}`;
}

export function getVideoRoomExpiry(datetime: string): string {
  return new Date(new Date(datetime).getTime() + APPOINTMENT_DURATION_MS).toISOString();
}

export function isVideoLinkActive(appointment: Appointment): boolean {
  if (appointment.type !== 'telemedicine' || !appointment.videoRoomUrl) return false;

  const now = Date.now();
  const start = new Date(appointment.datetime).getTime();
  const expiresAt = appointment.videoRoomExpiresAt
    ? new Date(appointment.videoRoomExpiresAt).getTime()
    : start + APPOINTMENT_DURATION_MS;

  return now >= start - JOIN_WINDOW_MS && now < expiresAt;
}

// Backfills a video room on the client when the backend doesn't yet return one.
export function withVideoRoom(appointment: Appointment): Appointment {
  if (appointment.type !== 'telemedicine' || appointment.videoRoomUrl) return appointment;

  return {
    ...appointment,
    videoRoomUrl: generateVideoRoomUrl(appointment.id),
    videoRoomExpiresAt: getVideoRoomExpiry(appointment.datetime),
  };
}
