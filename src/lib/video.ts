import type { Appointment } from '@/types';
import { captureError, captureMessage } from '@/lib/sentry';

const DAILY_DOMAIN = process.env.NEXT_PUBLIC_DAILY_DOMAIN || 'heliora';
const DAILY_API_URL = process.env.NEXT_PUBLIC_DAILY_API_URL || '';
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

/* ═══════════════════════════════════════════════════════════════════
   #44 — Daily.co room token signing & dynamic quality tiering
   ═══════════════════════════════════════════════════════════════════ */

export interface DailyMeetingToken {
  token: string;
  exp: number;
  roomName: string;
  userId: string;
}

export interface FetchMeetingTokenParams {
  appointmentId: string;
  userId: string;
  appointmentDatetime: string;
  durationMs?: number;
}

/**
 * Fetches a short-lived Daily.co meeting token from the backend, scoped to the
 * appointment room and signed with the caller's user ID. The backend holds the
 * Daily API key and calls `POST https://api.daily.co/v1/meeting-tokens` with:
 *
 * ```json
 * { "properties": { "room_name": "appt-<id>", "user_id": "<36 chars>", "exp": <unix> } }
 * ```
 *
 * See: https://docs.daily.co/reference/rest-api/meeting-tokens/create-meeting-token
 *
 * Time: O(1) — single HTTP round-trip.
 */
export async function fetchMeetingToken(params: FetchMeetingTokenParams): Promise<DailyMeetingToken> {
  const { appointmentId, userId, appointmentDatetime, durationMs = APPOINTMENT_DURATION_MS } = params;
  const roomName = `appt-${appointmentId}`;
  const exp = Math.floor((new Date(appointmentDatetime).getTime() + durationMs) / 1000);

  const response = await fetch(`${DAILY_API_URL}/api/video/meeting-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_id: userId.slice(0, 36),
        exp,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to fetch meeting token: ${response.status} ${body}`);
  }

  const data = await response.json();
  return { token: data.token, exp, roomName, userId: userId.slice(0, 36) };
}

/* ── Dynamic video quality tiering ─────────────────────────────── */

export type VideoQualityTier = 'high' | 'medium' | 'low' | 'audio-only';

const BANDWIDTH_THRESHOLDS = {
  high: 1000,
  medium: 500,
  low: 300,
} as const;

export function selectQualityTier(bandwidthKbps: number): VideoQualityTier {
  if (bandwidthKbps >= BANDWIDTH_THRESHOLDS.high) return 'high';
  if (bandwidthKbps >= BANDWIDTH_THRESHOLDS.medium) return 'medium';
  if (bandwidthKbps >= BANDWIDTH_THRESHOLDS.low) return 'low';
  return 'audio-only';
}

export interface QualityConstraints {
  video: MediaTrackConstraints | false;
  audio: MediaTrackConstraints;
}

export function getQualityConstraints(tier: VideoQualityTier): QualityConstraints {
  switch (tier) {
    case 'high':
      return { video: { width: 1280, height: 720, frameRate: 30 }, audio: {} };
    case 'medium':
      return { video: { width: 640, height: 480, frameRate: 24 }, audio: {} };
    case 'low':
      return { video: { width: 320, height: 240, frameRate: 15 }, audio: {} };
    case 'audio-only':
      return { video: false, audio: {} };
  }
}

/**
 * Monitors the connection and dynamically applies quality tier changes.
 * Returns a cleanup function. Re-evaluates every `intervalMs` ms.
 *
 * Time: O(1) per tick. Space: O(1).
 */
export function startQualityTiering(
  peerConnection: RTCPeerConnection,
  onTierChange: (tier: VideoQualityTier) => void,
  intervalMs = 5000,
): () => void {
  let currentTier: VideoQualityTier = 'high';
  let prevBytes = 0;
  let prevTimestamp = 0;

  const tick = async () => {
    const stats = await peerConnection.getStats();
    let latestBytesSent = 0;
    let latestTimestamp = 0;

    stats.forEach((report) => {
      if (report.type === 'outbound-rtp' && report.kind === 'video') {
        latestBytesSent = report.bytesSent ?? 0;
        latestTimestamp = report.timestamp;
      }
    });

    if (prevTimestamp > 0 && latestTimestamp > prevTimestamp) {
      const elapsedSeconds = (latestTimestamp - prevTimestamp) / 1000;
      const bandwidthKbps = ((latestBytesSent - prevBytes) * 8) / (elapsedSeconds * 1000);
      const newTier = selectQualityTier(bandwidthKbps);
      if (newTier !== currentTier) {
        currentTier = newTier;
        onTierChange(currentTier);
      }
    }
    prevBytes = latestBytesSent;
    prevTimestamp = latestTimestamp;
  };

  const handle = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(handle);
}

/* ── Token expiration auto-disconnect ─────────────────────────── */

/**
 * Schedules automatic disconnection when the meeting token expires.
 * Returns a cleanup function.
 *
 * Time: O(1). Space: O(1).
 */
export function scheduleTokenExpiry(
  tokenExp: number,
  onExpired: () => void,
): () => void {
  const msUntilExpiry = tokenExp * 1000 - Date.now();
  if (msUntilExpiry <= 0) {
    onExpired();
    return () => {};
  }
  const handle = setTimeout(onExpired, msUntilExpiry);
  return () => clearTimeout(handle);
}

/* ═══════════════════════════════════════════════════════════════════
   #52 — WebRTC telemetry & call quality metrics logger
   ═══════════════════════════════════════════════════════════════════ */

export interface WebRTCMetricsSample {
  timestamp: number;
  jitterSeconds: number | null;
  roundTripTimeSeconds: number | null;
  packetLossPercent: number;
  frameDropPercent: number;
  availableBandwidthKbps: number | null;
}

export interface SessionHealthReport {
  sessionId: string;
  appointmentId: string;
  userId: string;
  samples: WebRTCMetricsSample[];
  healthScore: number;
  startedAt: number;
  endedAt: number;
  abnormalDrop: boolean;
}

const TELEMETRY_INTERVAL_MS = 15_000;
const PACKET_LOSS_WARN_THRESHOLD = 0.08;
const RTT_WARN_THRESHOLD_SECONDS = 0.4;

/**
 * Extracts a single metrics sample from the current RTCPeerConnection stats.
 * Looks at inbound-rtp for jitter/packet-loss and remote-inbound-rtp for RTT.
 *
 * Time: O(s) where s = number of stats reports (typically <20). Space: O(1).
 */
export async function sampleWebRTCMetrics(
  peerConnection: RTCPeerConnection,
): Promise<WebRTCMetricsSample> {
  const stats = await peerConnection.getStats();
  let jitterSeconds: number | null = null;
  let roundTripTimeSeconds: number | null = null;
  let packetsReceived = 0;
  let packetsLost = 0;
  let framesReceived = 0;
  let framesDropped = 0;
  let availableBandwidthKbps: number | null = null;

  stats.forEach((report) => {
    if (report.type === 'inbound-rtp') {
      if (report.kind === 'audio' && typeof report.jitter === 'number') {
        jitterSeconds = report.jitter;
      }
      if (typeof report.packetsReceived === 'number') {
        packetsReceived += report.packetsReceived;
      }
      if (typeof report.packetsLost === 'number') {
        packetsLost += report.packetsLost;
      }
      if (report.kind === 'video') {
        framesReceived += report.framesReceived ?? 0;
        framesDropped += report.framesDropped ?? 0;
      }
    }
    if (report.type === 'remote-inbound-rtp' && typeof report.roundTripTime === 'number') {
      roundTripTimeSeconds = report.roundTripTime;
    }
    if (report.type === 'candidate-pair' && report.nominated) {
      if (typeof report.availableOutgoingBitrate === 'number') {
        availableBandwidthKbps = report.availableOutgoingBitrate / 1000;
      }
    }
  });

  const totalPackets = packetsReceived + packetsLost;
  const packetLossPercent = totalPackets > 0 ? packetsLost / totalPackets : 0;
  const totalFrames = framesReceived + framesDropped;
  const frameDropPercent = totalFrames > 0 ? framesDropped / totalFrames : 0;

  return {
    timestamp: Date.now(),
    jitterSeconds,
    roundTripTimeSeconds,
    packetLossPercent,
    frameDropPercent,
    availableBandwidthKbps,
  };
}

/**
 * Computes a 0–100 health score from aggregated session samples.
 * Penalizes packet loss, high RTT, frame drops, and jitter proportionally.
 *
 * Time: O(n) over sample count. Space: O(1).
 */
export function computeHealthScore(samples: WebRTCMetricsSample[]): number {
  if (samples.length === 0) return 100;

  let totalPenalty = 0;
  for (const s of samples) {
    let samplePenalty = 0;
    samplePenalty += Math.min(s.packetLossPercent * 200, 40);
    if (s.roundTripTimeSeconds !== null) {
      samplePenalty += Math.min((s.roundTripTimeSeconds / 0.5) * 20, 30);
    }
    samplePenalty += Math.min(s.frameDropPercent * 100, 20);
    if (s.jitterSeconds !== null) {
      samplePenalty += Math.min((s.jitterSeconds / 0.05) * 5, 10);
    }
    totalPenalty += samplePenalty;
  }

  return Math.max(0, Math.round(100 - totalPenalty / samples.length));
}

export interface TelemetryCallbacks {
  onWarnPacketLoss?: (percent: number) => void;
  onWarnRTT?: (seconds: number) => void;
}

/**
 * Starts WebRTC telemetry sampling every 15 seconds. Returns a stop function
 * that finalizes the session report and sends it to Sentry + the backend.
 *
 * Time: O(1) per tick, O(n) on stop for report aggregation.
 * Space: O(n) where n = number of samples (~4 per minute).
 */
export function startTelemetry(
  peerConnection: RTCPeerConnection,
  sessionId: string,
  appointmentId: string,
  userId: string,
  callbacks?: TelemetryCallbacks,
): () => Promise<SessionHealthReport> {
  const samples: WebRTCMetricsSample[] = [];
  const startedAt = Date.now();
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const sample = await sampleWebRTCMetrics(peerConnection);
      samples.push(sample);

      if (sample.packetLossPercent > PACKET_LOSS_WARN_THRESHOLD) {
        callbacks?.onWarnPacketLoss?.(sample.packetLossPercent);
      }
      if (sample.roundTripTimeSeconds !== null && sample.roundTripTimeSeconds > RTT_WARN_THRESHOLD_SECONDS) {
        callbacks?.onWarnRTT?.(sample.roundTripTimeSeconds);
      }
    } catch (err) {
      captureError(err instanceof Error ? err : new Error(String(err)), {
        context: 'webrtc-telemetry-sample',
        appointmentId,
      });
    }
  };

  const handle = setInterval(tick, TELEMETRY_INTERVAL_MS);
  tick();

  return async () => {
    stopped = true;
    clearInterval(handle);

    const abnormalDrop =
      peerConnection.connectionState === 'failed' ||
      peerConnection.connectionState === 'disconnected';

    const report: SessionHealthReport = {
      sessionId,
      appointmentId,
      userId,
      samples,
      healthScore: computeHealthScore(samples),
      startedAt,
      endedAt: Date.now(),
      abnormalDrop,
    };

    if (abnormalDrop) {
      captureMessage(
        `WebRTC abnormal drop: appointment=${appointmentId} score=${report.healthScore}`,
        'warning',
      );
    }

    try {
      await fetch(`${DAILY_API_URL}/api/video/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
    } catch (err) {
      captureError(err instanceof Error ? err : new Error(String(err)), {
        context: 'webrtc-telemetry-report',
        appointmentId,
      });
    }

    return report;
  };
}
