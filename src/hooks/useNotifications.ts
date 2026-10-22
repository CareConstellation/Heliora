'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { QueueStatusStage, StepAwayContact } from '@/types';

export type NotificationEventType =
  | 'access_request'
  | 'appointment_confirmed'
  | 'record_shared'
  | 'queue_position_update'
  | 'doctor_ready';

export interface NotificationEvent {
  id: string;
  type: NotificationEventType;
  message: string;
  timestamp: number;
}

const EVENT_LABELS: Record<NotificationEventType, string> = {
  access_request: 'New access request received',
  appointment_confirmed: 'Appointment confirmed',
  record_shared: 'A medical record was shared with you',
  queue_position_update: 'Waiting room queue updated',
  doctor_ready: 'Your doctor is ready to begin consultation',
};

interface UseNotificationsOptions {
  address: string | null;
  onNotification?: (event: NotificationEvent) => void;
}

export function useNotifications({ address, onNotification }: UseNotificationsOptions) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const clearUnread = useCallback(() => setUnreadCount(0), []);

  useEffect(() => {
    if (!address || !process.env.NEXT_PUBLIC_API_URL) return;

    const url = `${process.env.NEXT_PUBLIC_API_URL}/notifications/stream?address=${encodeURIComponent(address)}`;
    const es = new EventSource(url);
    esRef.current = es;

    const handleEvent = (raw: MessageEvent) => {
      try {
        const data = JSON.parse(raw.data) as { type: NotificationEventType; id?: string };
        const event: NotificationEvent = {
          id: data.id ?? crypto.randomUUID(),
          type: data.type,
          message: EVENT_LABELS[data.type] ?? 'New notification',
          timestamp: Date.now(),
        };
        setNotifications((prev) => [event, ...prev]);
        setUnreadCount((n) => n + 1);
        onNotification?.(event);
      } catch {
        // malformed event - ignore
      }
    };

    (['access_request', 'appointment_confirmed', 'record_shared'] as const).forEach((type) => {
      es.addEventListener(type, handleEvent);
    });

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  return { notifications, unreadCount, clearUnread };
}

/* Dynamic waiting room queue management hook (#49) */

export interface UseQueueTrackingOptions {
  appointmentId: string;
  initialPosition?: number;
  initialWaitMinutes?: number;
}

export interface QueueTrackingState {
  appointmentId: string;
  position: number;
  estimatedWaitSeconds: number;
  statusStage: QueueStatusStage;
  statusMessage: string;
  isDoctorReady: boolean;
  stepAwayContact: StepAwayContact | null;
  isStepAwayRegistered: boolean;
  registerStepAway: (contact: StepAwayContact) => Promise<boolean>;
}

export function useQueueTracking({
  appointmentId,
  initialPosition = 2,
  initialWaitMinutes = 8,
}: UseQueueTrackingOptions): QueueTrackingState {
  const [position, setPosition] = useState(initialPosition);
  const [estimatedWaitSeconds, setEstimatedWaitSeconds] = useState(initialWaitMinutes * 60);
  const [statusStage, setStatusStage] = useState<QueueStatusStage>(
    initialPosition === 1 ? 'doctor_reviewing_charts' : 'waiting',
  );
  const [statusMessage, setStatusMessage] = useState(
    initialPosition === 1
      ? 'Doctor is reviewing your charts'
      : `Position in queue: #${initialPosition}. Concluding previous consultation.`,
  );
  const [isDoctorReady, setIsDoctorReady] = useState(false);
  const [stepAwayContact, setStepAwayContact] = useState<StepAwayContact | null>(null);
  const [isStepAwayRegistered, setIsStepAwayRegistered] = useState(false);

  // Smooth live countdown timer
  useEffect(() => {
    if (isDoctorReady || estimatedWaitSeconds <= 0) return;

    const timer = setInterval(() => {
      setEstimatedWaitSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [isDoctorReady, estimatedWaitSeconds]);

  // Connect to SSE or WebSocket stream from backend
  useEffect(() => {
    if (!appointmentId) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    let es: EventSource | null = null;

    if (apiUrl) {
      try {
        const streamUrl = `${apiUrl}/appointments/${encodeURIComponent(appointmentId)}/queue/stream`;
        es = new EventSource(streamUrl);

        es.addEventListener('queue_update', (raw: MessageEvent) => {
          try {
            const data = JSON.parse(raw.data);
            if (typeof data.position === 'number') setPosition(data.position);
            if (typeof data.estimatedWaitSeconds === 'number') {
              setEstimatedWaitSeconds(data.estimatedWaitSeconds);
            }
            if (data.statusStage) setStatusStage(data.statusStage);
            if (data.statusMessage) setStatusMessage(data.statusMessage);
            if (data.statusStage === 'ready') setIsDoctorReady(true);
          } catch {
            // ignore malformed frame
          }
        });

        es.addEventListener('doctor_ready', () => {
          setStatusStage('ready');
          setStatusMessage('Doctor has entered the consultation room!');
          setIsDoctorReady(true);
          setPosition(0);
          setEstimatedWaitSeconds(0);
        });

        es.onerror = () => {
          es?.close();
        };
      } catch {
        // fallback
      }
    }

    return () => {
      es?.close();
    };
  }, [appointmentId]);

  // Dynamically update status message if queue position advances
  useEffect(() => {
    if (position === 1 && statusStage === 'waiting') {
      setStatusStage('doctor_reviewing_charts');
      setStatusMessage('Next in line - Doctor is reviewing your charts');
    }
  }, [position, statusStage]);

  const registerStepAway = useCallback(
    async (contact: StepAwayContact): Promise<boolean> => {
      setStepAwayContact(contact);
      setIsStepAwayRegistered(true);

      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      if (apiUrl) {
        try {
          await fetch(`${apiUrl}/appointments/${encodeURIComponent(appointmentId)}/step-away`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contact }),
          });
        } catch {
          // local registration succeeded
        }
      }
      return true;
    },
    [appointmentId],
  );

  return {
    appointmentId,
    position,
    estimatedWaitSeconds,
    statusStage,
    statusMessage,
    isDoctorReady,
    stepAwayContact,
    isStepAwayRegistered,
    registerStepAway,
  };
}
