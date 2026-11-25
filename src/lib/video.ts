import type { Appointment, ReconnectionState, ReconnectionStatus } from '@/types';
import {
  captureError,
  captureMessage,
  reportCallQualityTelemetry,
  type CallQualityMetrics,
} from '@/lib/sentry';

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
  // Echo cancellation and noise suppression are enforced on every tier (#256).
  const audio = getEnhancedAudioConstraints();
  switch (tier) {
    case 'high':
      return { video: { width: 1280, height: 720, frameRate: 30 }, audio };
    case 'medium':
      return { video: { width: 640, height: 480, frameRate: 24 }, audio };
    case 'low':
      return { video: { width: 320, height: 240, frameRate: 15 }, audio };
    case 'audio-only':
      return { video: false, audio };
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

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);
  void tick();
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

  const handle = setInterval(() => {
    void tick();
  }, TELEMETRY_INTERVAL_MS);
  void tick();

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

/* ═══════════════════════════════════════════════════════════════════
   #66 — Automated reconnection handler with state recovery
   ═══════════════════════════════════════════════════════════════════ */

/* ── #264 — TURN relay failover configuration ──────────────────── */

/** TURN over TLS on port 443 passes through firewalls and proxies that block other ports. */
export const TURN_TLS_PORT = 443;

export interface TurnServerCredentials {
  /** TURN hostname only, without scheme or port (e.g. `turn.example.org`). */
  host: string;
  username?: string | undefined;
  credential?: string | undefined;
}

/**
 * Builds a relay-only RTCConfiguration that reaches each TURN host over TLS on
 * port 443 (`turns:<host>:443?transport=tcp`). Returns null when no usable host
 * is supplied, because a relay-only policy without TURN servers cannot connect.
 *
 * Time: O(T) over TURN entries. Space: O(T).
 */
export function buildTurnFailoverConfiguration(
  turnServers: TurnServerCredentials[],
): RTCConfiguration | null {
  const iceServers: RTCIceServer[] = [];

  for (const server of turnServers) {
    const host = server.host.trim();
    if (!host) continue;

    iceServers.push({
      urls: `turns:${host}:${TURN_TLS_PORT}?transport=tcp`,
      ...(server.username ? { username: server.username } : {}),
      ...(server.credential ? { credential: server.credential } : {}),
    });
  }

  if (iceServers.length === 0) return null;
  return { iceServers, iceTransportPolicy: 'relay' };
}

export interface ReconnectionManagerConfig {
  peerConnection?: RTCPeerConnection | null | undefined;
  timeoutMs?: number | undefined; // default: 30000 (30 seconds)
  iceRestartIntervalMs?: number | undefined; // default: 5000 (5 seconds, #270)
  onStatusChange: (status: ReconnectionStatus) => void;
  onReconnected?: (() => void) | undefined;
  onTimeout?: (() => void) | undefined;
  getLocalMediaStream?: (() => MediaStream | null) | undefined;
  /** TURN servers for the relay-only fallback used after an ICE failure (#264). */
  turnServers?: TurnServerCredentials[] | undefined;
  /** Creates the replacement peer connection from the relay-only configuration (#264). */
  createRelayPeerConnection?: ((config: RTCConfiguration) => RTCPeerConnection) | undefined;
  /** Receives the replacement peer connection so the caller can renegotiate (#264). */
  onPeerConnectionReplaced?: ((pc: RTCPeerConnection) => void) | undefined;
}

export interface ReconnectionManager {
  retry: () => void;
  cleanup: () => void;
  triggerIceRestart: () => void;
  restoreMediaTracks: () => void;
  getPeerConnection: () => RTCPeerConnection | null;
}

/**
 * Manages automated WebRTC reconnection for dropped mobile/network transitions (e.g., Wi-Fi to 5G).
 *
 * Algorithm & Complexity:
 * - Time Complexity: O(1) state transitions and event registration.
 *   Track restoration scans sender list (bounded O(T) where T <= 4, O(1)).
 * - Space Complexity: O(1) fixed-size timer and callback handles.
 *
 * Acceptance Criteria met:
 * 1. Detects offline/disconnected events and initiates ICE restart (peerConnection.restartIce()).
 * 2. Manages unobtrusive reconnection state with a 30-second timeout.
 * 3. Restores media tracks and peer state without requiring a full page refresh.
 */
export function setupAutomatedReconnection(
  config: ReconnectionManagerConfig,
): ReconnectionManager {
  const {
    timeoutMs = 30_000,
    iceRestartIntervalMs = 5_000,
    onStatusChange,
    onReconnected,
    onTimeout,
    getLocalMediaStream,
    turnServers,
    createRelayPeerConnection,
    onPeerConnectionReplaced,
  } = config;

  // Mutable: a relay-only failover replaces the peer connection (#264).
  let pc: RTCPeerConnection | null = config.peerConnection ?? null;
  let currentState: ReconnectionState = 'connected';
  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  let restartTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let remainingSeconds = Math.ceil(timeoutMs / 1000);
  let attemptCount = 0;
  let isCleanedUp = false;
  let relayFailoverAttempted = false;

  const updateStatus = (
    state: ReconnectionState,
    seconds: number,
    message?: string,
  ) => {
    currentState = state;
    remainingSeconds = seconds;
    onStatusChange({
      state,
      remainingSeconds: seconds,
      attemptCount,
      ...(message !== undefined ? { message } : {}),
    });
  };

  const clearTimers = () => {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (restartTimer) {
      clearInterval(restartTimer);
      restartTimer = null;
    }
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
  };

  const restoreMediaTracks = () => {
    if (!pc) return;
    try {
      const senders = pc.getSenders();
      const localStream = getLocalMediaStream?.();

      senders.forEach((sender) => {
        if (!sender.track) return;

        // Ensure track is active and enabled
        if (!sender.track.enabled) {
          sender.track.enabled = true;
        }

        // If local stream has a fresh or live track of same kind, reconnect it
        if (localStream) {
          const matchingTrack = localStream
            .getTracks()
            .find((t) => t.kind === sender.track?.kind && t.readyState === 'live');

          if (matchingTrack && sender.track !== matchingTrack && typeof sender.replaceTrack === 'function') {
            sender.replaceTrack(matchingTrack).catch((err) => {
              console.warn('Sender replaceTrack error during reconnection recovery:', err);
            });
          }
        }
      });
    } catch (err) {
      console.warn('Failed to restore media tracks during reconnection:', err);
    }
  };

  const triggerIceRestart = () => {
    attemptCount += 1;
    restoreMediaTracks();

    if (pc && typeof pc.restartIce === 'function') {
      try {
        pc.restartIce();
      } catch (err) {
        console.warn('ICE restart trigger failed on RTCPeerConnection:', err);
      }
    }
  };

  const handleConnectionRecovery = () => {
    if (currentState === 'reconnecting') {
      clearTimers();
      restoreMediaTracks();
      updateStatus('connected', 0, 'Reconnected to consultation.');
      onReconnected?.();
    }
  };

  const startReconnecting = (reason: string) => {
    if (isCleanedUp || currentState === 'reconnecting') return;

    clearTimers();
    remainingSeconds = Math.ceil(timeoutMs / 1000);
    updateStatus('reconnecting', remainingSeconds, reason);

    // Initiate immediate ICE restart on transition
    triggerIceRestart();

    // 1-second interval countdown for user UI overlay
    countdownTimer = setInterval(() => {
      remainingSeconds = Math.max(0, remainingSeconds - 1);
      if (remainingSeconds > 0) {
        updateStatus('reconnecting', remainingSeconds, 'Reconnecting to consultation...');
      }
    }, 1000);

    // Re-run ICE restart every iceRestartIntervalMs until recovery or timeout (#270)
    restartTimer = setInterval(() => {
      if (currentState === 'reconnecting') {
        triggerIceRestart();
      }
    }, iceRestartIntervalMs);

    // 30-second hard timeout
    timeoutTimer = setTimeout(() => {
      clearTimers();
      if (currentState === 'reconnecting') {
        updateStatus(
          'failed',
          0,
          'Reconnection timed out. Please check your network connection and retry.',
        );
        onTimeout?.();
      }
    }, timeoutMs);
  };

  // Browser offline/online network transition detection
  const handleOffline = () => {
    startReconnecting('Network disconnected. Attempting to restore consultation...');
  };

  const handleOnline = () => {
    if (currentState === 'reconnecting') {
      // Network route re-established (e.g. 5G connected after Wi-Fi drop)
      triggerIceRestart();
    }
  };

  // PeerConnection connection state changes
  const handleConnectionStateChange = () => {
    if (!pc) return;
    const connState = pc.connectionState;

    if (connState === 'connected') {
      handleConnectionRecovery();
    } else if (connState === 'disconnected' || connState === 'failed') {
      startReconnecting(`WebRTC connection ${connState}. Initiating ICE restart...`);
    }
  };

  const attachPeerListeners = (target: RTCPeerConnection) => {
    target.addEventListener('connectionstatechange', handleConnectionStateChange);
    target.addEventListener('iceconnectionstatechange', handleIceConnectionStateChange);
  };

  const detachPeerListeners = (target: RTCPeerConnection) => {
    target.removeEventListener('connectionstatechange', handleConnectionStateChange);
    target.removeEventListener('iceconnectionstatechange', handleIceConnectionStateChange);
  };

  /**
   * Rebuilds the peer connection with a relay-only (TURN over TLS, port 443)
   * configuration. Runs at most once per manager. Returns true when the
   * replacement was installed.
   */
  const attemptRelayFailover = (): boolean => {
    if (relayFailoverAttempted || isCleanedUp) return false;
    if (!createRelayPeerConnection || !turnServers) return false;

    const relayConfig = buildTurnFailoverConfiguration(turnServers);
    if (!relayConfig) return false;

    relayFailoverAttempted = true;

    let replacement: RTCPeerConnection;
    try {
      replacement = createRelayPeerConnection(relayConfig);
    } catch (err) {
      console.warn('Relay-only peer connection could not be created:', err);
      return false;
    }

    if (pc) {
      detachPeerListeners(pc);
      try {
        pc.close();
      } catch {
        // The failed connection may already be closed.
      }
    }

    pc = replacement;
    attachPeerListeners(pc);
    onPeerConnectionReplaced?.(pc);
    return true;
  };

  const handleIceConnectionStateChange = () => {
    if (!pc) return;
    const iceState = pc.iceConnectionState;

    if (iceState === 'connected' || iceState === 'completed') {
      handleConnectionRecovery();
    } else if (iceState === 'failed') {
      // ICE exhausted every candidate pair: fall back to TURN relay once (#264).
      const failedOver = attemptRelayFailover();
      if (failedOver && currentState === 'reconnecting') {
        // startReconnecting is a no-op while already reconnecting, so restart the replacement here.
        triggerIceRestart();
      } else {
        startReconnecting(
          failedOver
            ? 'ICE failed. Re-establishing the call over TURN relay...'
            : 'ICE transport failed. Initiating ICE restart...',
        );
      }
    } else if (iceState === 'disconnected') {
      startReconnecting(`ICE transport ${iceState}. Initiating ICE restart...`);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
  }

  if (pc) {
    attachPeerListeners(pc);
  }

  const retry = () => {
    if (isCleanedUp) return;
    startReconnecting('Retrying consultation reconnection...');
  };

  const cleanup = () => {
    isCleanedUp = true;
    clearTimers();

    if (typeof window !== 'undefined') {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    }

    if (pc) {
      detachPeerListeners(pc);
    }
  };

  return {
    retry,
    cleanup,
    triggerIceRestart,
    restoreMediaTracks,
    getPeerConnection: () => pc,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   #272 — WebRTC packet statistics & call quality analytics reporter
   ═══════════════════════════════════════════════════════════════════ */

export interface WebRtcStatsSample {
  timestamp: number;
  jitterMs: number;
  rttMs: number;
  packetsReceived: number;
  packetsLost: number;
  framesDecoded: number;
  framesDropped: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Computes the p-th percentile (0–100) using nearest-rank over a numeric array. */
export function computePercentile(values: number[], percentile: number): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return 0;
  const sorted = [...finite].sort((a, b) => a - b);
  const clampedP = Math.max(0, Math.min(100, percentile));
  if (clampedP === 0) return sorted[0]!;
  const rank = Math.ceil((clampedP / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))]!;
}

/** Extracts a single WebRTC stats snapshot from an RTCStatsReport or iterable of stat records. */
export function extractWebRtcStatsSample(
  stats: RTCStatsReport | Iterable<Record<string, unknown>>,
): WebRtcStatsSample {
  let maxJitterMs = 0;
  let rttMs = 0;
  let packetsReceived = 0;
  let packetsLost = 0;
  let framesDecoded = 0;
  let framesDropped = 0;
  let timestamp = Date.now();

  const visit = (report: Record<string, unknown>) => {
    if (typeof report.timestamp === 'number' && Number.isFinite(report.timestamp)) {
      timestamp = report.timestamp;
    }

    if (report.type === 'inbound-rtp') {
      if (typeof report.jitter === 'number' && Number.isFinite(report.jitter)) {
        maxJitterMs = Math.max(maxJitterMs, report.jitter * 1000);
      }
      if (typeof report.packetsReceived === 'number') packetsReceived += report.packetsReceived;
      if (typeof report.packetsLost === 'number') packetsLost += Math.max(0, report.packetsLost);
      if (typeof report.framesDecoded === 'number') framesDecoded += report.framesDecoded;
      if (typeof report.framesDropped === 'number') framesDropped += report.framesDropped;
    } else if (
      report.type === 'candidate-pair' &&
      (report.state === 'succeeded' || report.nominated === true) &&
      typeof report.currentRoundTripTime === 'number'
    ) {
      rttMs = Math.max(rttMs, report.currentRoundTripTime * 1000);
    } else if (
      report.type === 'remote-inbound-rtp' &&
      typeof report.roundTripTime === 'number' &&
      rttMs === 0
    ) {
      rttMs = report.roundTripTime * 1000;
    }
  };

  if (typeof (stats as RTCStatsReport).forEach === 'function') {
    (stats as RTCStatsReport).forEach((r) => visit(r as unknown as Record<string, unknown>));
  } else {
    for (const r of stats as Iterable<Record<string, unknown>>) {
      visit(r);
    }
  }

  return {
    timestamp,
    jitterMs: round2(maxJitterMs),
    rttMs: round2(rttMs),
    packetsReceived,
    packetsLost,
    framesDecoded,
    framesDropped,
  };
}

/**
 * Aggregates WebRTC stats samples into p95 jitter, p95/avg RTT, packet loss %,
 * and dropped frames %. Cumulative counters use the latest sample snapshot.
 */
export function aggregateCallQualityMetrics(
  samples: WebRtcStatsSample[],
  qualityTier?: VideoQualityTier,
): CallQualityMetrics {
  if (samples.length === 0) {
    return {
      p95JitterMs: 0,
      p95RttMs: 0,
      avgRttMs: 0,
      packetLossPercent: 0,
      droppedFramesPercent: 0,
      sampleCount: 0,
      framesDecoded: 0,
      framesDropped: 0,
      ...(qualityTier ? { qualityTier } : {}),
    };
  }

  const jitters = samples.map((s) => s.jitterMs);
  const rtts = samples.map((s) => s.rttMs);
  const avgRtt = rtts.reduce((sum, v) => sum + v, 0) / rtts.length;

  const latest = samples[samples.length - 1]!;
  const totalPackets = latest.packetsReceived + latest.packetsLost;
  const packetLossPercent = totalPackets > 0 ? (latest.packetsLost / totalPackets) * 100 : 0;

  const totalFrames = latest.framesDecoded + latest.framesDropped;
  const droppedFramesPercent = totalFrames > 0 ? (latest.framesDropped / totalFrames) * 100 : 0;

  return {
    p95JitterMs: round2(computePercentile(jitters, 95)),
    p95RttMs: round2(computePercentile(rtts, 95)),
    avgRttMs: round2(avgRtt),
    packetLossPercent: round2(Math.min(100, Math.max(0, packetLossPercent))),
    droppedFramesPercent: round2(Math.min(100, Math.max(0, droppedFramesPercent))),
    sampleCount: samples.length,
    framesDecoded: latest.framesDecoded,
    framesDropped: latest.framesDropped,
    ...(qualityTier ? { qualityTier } : {}),
  };
}

export interface CallQualityReporterOptions {
  intervalMs?: number;
  getQualityTier?: () => VideoQualityTier;
  onReport?: (metrics: CallQualityMetrics) => void;
}

/**
 * Periodically collects WebRTC `getStats()` samples and reports anonymous call
 * quality metrics to Sentry when stopped (or via `flush()`).
 */
export function startCallQualityReporter(
  peerConnection: RTCPeerConnection,
  options: CallQualityReporterOptions = {},
): { flush: () => CallQualityMetrics; cleanup: () => void } {
  const { intervalMs = 5000, getQualityTier, onReport } = options;
  const samples: WebRtcStatsSample[] = [];
  let flushed = false;

  const sampleNow = async () => {
    try {
      const stats = await peerConnection.getStats();
      samples.push(extractWebRtcStatsSample(stats));
    } catch {
      // Ignore transient getStats errors while peerConnection is closing.
    }
  };

  const handle = setInterval(() => {
    void sampleNow();
  }, intervalMs);
  void sampleNow();

  const flush = (): CallQualityMetrics => {
    const metrics = aggregateCallQualityMetrics(samples, getQualityTier?.());
    if (samples.length > 0) {
      reportCallQualityTelemetry(metrics);
      onReport?.(metrics);
    }
    flushed = true;
    return metrics;
  };

  const cleanup = () => {
    clearInterval(handle);
    if (!flushed) {
      flush();
    }
  };

  return { flush, cleanup };
}

/* ═══════════════════════════════════════════════════════════════════
   #254 — Adaptive bitrate streaming & bandwidth estimation
   ═══════════════════════════════════════════════════════════════════ */

/** Resolution ladder, highest first. `audio-only` disables outbound video. */
export type AdaptiveResolution = '1080p' | '720p' | '480p' | 'audio-only';

export const ADAPTIVE_RESOLUTION_LADDER: readonly AdaptiveResolution[] = [
  '1080p',
  '720p',
  '480p',
  'audio-only',
] as const;

export interface ResolutionProfile {
  /** Target frame height in pixels (0 = video disabled). */
  height: number;
  /** Encoder bitrate ceiling in bits per second (0 = video disabled). */
  maxBitrate: number;
  maxFramerate: number;
}

export const RESOLUTION_PROFILES: Record<AdaptiveResolution, ResolutionProfile> = {
  '1080p': { height: 1080, maxBitrate: 2_500_000, maxFramerate: 30 },
  '720p': { height: 720, maxBitrate: 1_200_000, maxFramerate: 30 },
  '480p': { height: 480, maxBitrate: 600_000, maxFramerate: 24 },
  'audio-only': { height: 0, maxBitrate: 0, maxFramerate: 0 },
};

/** Packet loss (%) above which the controller steps down one rung. */
export const ABR_STEP_DOWN_LOSS_PERCENT = 5;
/** Packet loss (%) below which a poll counts towards stepping back up. */
export const ABR_STEP_UP_LOSS_PERCENT = 2;
/** Consecutive healthy polls required before stepping up (2s × 5 = 10s). */
export const ABR_STABLE_POLLS_TO_STEP_UP = 5;
export const ABR_POLL_INTERVAL_MS = 2000;

/** Raw cumulative RTP counters read from one `getStats()` snapshot. */
export interface RtpCounters {
  timestamp: number;
  /** Packets we sent (outbound-rtp) and the remote reported lost (remote-inbound-rtp). */
  packetsSent: number;
  remotePacketsLost: number;
  /** Packets we received (inbound-rtp) and lost on the way in. */
  packetsReceived: number;
  packetsLost: number;
  /** Sender-side bandwidth estimate from the nominated candidate pair, in kbps. */
  availableOutgoingKbps: number | null;
  /** Current round-trip time in milliseconds, if reported. */
  rttMs: number | null;
}

/**
 * Reads cumulative RTP counters from a stats report. Counters are summed across
 * audio and video streams so audio-only calls still produce a loss signal.
 *
 * Time: O(s) over stats entries. Space: O(1).
 */
export function readRtpCounters(
  stats: RTCStatsReport | Iterable<Record<string, unknown>>,
): RtpCounters {
  const counters: RtpCounters = {
    timestamp: 0,
    packetsSent: 0,
    remotePacketsLost: 0,
    packetsReceived: 0,
    packetsLost: 0,
    availableOutgoingKbps: null,
    rttMs: null,
  };

  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  const visit = (r: Record<string, unknown>) => {
    if (typeof r.timestamp === 'number' && r.timestamp > counters.timestamp) {
      counters.timestamp = r.timestamp;
    }
    switch (r.type) {
      case 'outbound-rtp':
        counters.packetsSent += num(r.packetsSent);
        break;
      case 'remote-inbound-rtp':
        counters.remotePacketsLost += Math.max(0, num(r.packetsLost));
        if (counters.rttMs === null && typeof r.roundTripTime === 'number') {
          counters.rttMs = r.roundTripTime * 1000;
        }
        break;
      case 'inbound-rtp':
        counters.packetsReceived += num(r.packetsReceived);
        counters.packetsLost += Math.max(0, num(r.packetsLost));
        break;
      case 'candidate-pair':
        if (r.nominated === true || r.state === 'succeeded') {
          if (typeof r.availableOutgoingBitrate === 'number') {
            counters.availableOutgoingKbps = r.availableOutgoingBitrate / 1000;
          }
          if (typeof r.currentRoundTripTime === 'number') {
            counters.rttMs = r.currentRoundTripTime * 1000;
          }
        }
        break;
      default:
        break;
    }
  };

  if (typeof (stats as RTCStatsReport).forEach === 'function') {
    (stats as RTCStatsReport).forEach((r) => visit(r as unknown as Record<string, unknown>));
  } else {
    for (const r of stats as Iterable<Record<string, unknown>>) visit(r);
  }
  return counters;
}

/**
 * Packet loss (%) over the interval between two snapshots, taking the worse of
 * the send and receive directions. Uses counter deltas so a lossy burst early
 * in the call does not mask (or inflate) the current network conditions.
 *
 * Time: O(1). Space: O(1).
 */
export function computeIntervalPacketLoss(prev: RtpCounters, curr: RtpCounters): number {
  const sent = curr.packetsSent - prev.packetsSent;
  const remoteLost = curr.remotePacketsLost - prev.remotePacketsLost;
  const received = curr.packetsReceived - prev.packetsReceived;
  const lost = curr.packetsLost - prev.packetsLost;

  const outboundLoss = sent > 0 && remoteLost > 0 ? (remoteLost / sent) * 100 : 0;
  const inboundTotal = received + lost;
  const inboundLoss = inboundTotal > 0 && lost > 0 ? (lost / inboundTotal) * 100 : 0;

  return Math.min(100, Math.max(0, outboundLoss, inboundLoss));
}

export interface AdaptiveDecision {
  resolution: AdaptiveResolution;
  stablePolls: number;
}

/**
 * Pure ladder controller: step down one rung when loss exceeds 5%, step back
 * up one rung only after {@link ABR_STABLE_POLLS_TO_STEP_UP} consecutive polls
 * below 2% loss. The gap between the thresholds (hysteresis) stops the encoder
 * oscillating on a borderline link.
 *
 * Time: O(1). Space: O(1).
 */
export function nextAdaptiveResolution(
  current: AdaptiveResolution,
  packetLossPercent: number,
  stablePolls: number,
  ceiling: AdaptiveResolution = '1080p',
): AdaptiveDecision {
  const index = ADAPTIVE_RESOLUTION_LADDER.indexOf(current);
  const ceilingIndex = ADAPTIVE_RESOLUTION_LADDER.indexOf(ceiling);

  if (packetLossPercent > ABR_STEP_DOWN_LOSS_PERCENT) {
    const next = ADAPTIVE_RESOLUTION_LADDER[Math.min(index + 1, ADAPTIVE_RESOLUTION_LADDER.length - 1)]!;
    return { resolution: next, stablePolls: 0 };
  }

  if (packetLossPercent < ABR_STEP_UP_LOSS_PERCENT) {
    const polls = stablePolls + 1;
    if (polls >= ABR_STABLE_POLLS_TO_STEP_UP && index > ceilingIndex) {
      return { resolution: ADAPTIVE_RESOLUTION_LADDER[index - 1]!, stablePolls: 0 };
    }
    return { resolution: current, stablePolls: polls };
  }

  // Between thresholds: hold the current rung and reset the stability streak.
  return { resolution: current, stablePolls: 0 };
}

export type ConnectionQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

/**
 * Maps loss/RTT to the user-facing quality pill level.
 *
 * Time: O(1). Space: O(1).
 */
export function classifyConnectionQuality(
  packetLossPercent: number | null,
  rttMs: number | null,
): ConnectionQuality {
  if (packetLossPercent === null) return 'unknown';
  const rtt = rttMs ?? 0;
  if (packetLossPercent > 10 || rtt > 600) return 'poor';
  if (packetLossPercent > ABR_STEP_DOWN_LOSS_PERCENT || rtt > 300) return 'fair';
  if (packetLossPercent > 1 || rtt > 150) return 'good';
  return 'excellent';
}

/**
 * Computes `scaleResolutionDownBy` so the encoder outputs `targetHeight` from a
 * source of `sourceHeight`. Never upscales (minimum factor 1).
 */
export function computeScaleDownFactor(sourceHeight: number, targetHeight: number): number {
  if (targetHeight <= 0 || sourceHeight <= 0) return 1;
  return Math.max(1, sourceHeight / targetHeight);
}

/**
 * Applies a ladder rung to one video `RTCRtpSender` through
 * `setParameters` (no renegotiation needed). `audio-only` deactivates the
 * video encoding instead of tearing down the track, so stepping back up is
 * instant.
 */
export async function applyResolutionToSender(
  sender: RTCRtpSender,
  resolution: AdaptiveResolution,
): Promise<void> {
  if (!sender.track || sender.track.kind !== 'video') return;

  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) {
    params.encodings = [{}];
  }

  const profile = RESOLUTION_PROFILES[resolution];
  const sourceHeight =
    (typeof sender.track.getSettings === 'function' ? sender.track.getSettings().height : undefined) ??
    profile.height;

  for (const encoding of params.encodings) {
    if (resolution === 'audio-only') {
      encoding.active = false;
      continue;
    }
    encoding.active = true;
    encoding.maxBitrate = profile.maxBitrate;
    encoding.maxFramerate = profile.maxFramerate;
    encoding.scaleResolutionDownBy = computeScaleDownFactor(sourceHeight, profile.height);
  }

  await sender.setParameters(params);
}

export interface AdaptiveBitrateSample {
  timestamp: number;
  packetLossPercent: number;
  rttMs: number | null;
  availableOutgoingKbps: number | null;
  resolution: AdaptiveResolution;
  quality: ConnectionQuality;
}

export interface AdaptiveBitrateOptions {
  intervalMs?: number;
  initialResolution?: AdaptiveResolution;
  /** Highest rung the controller may step up to (e.g. the camera's native size). */
  ceiling?: AdaptiveResolution;
  /** Apply rung changes to the peer connection's video senders. Default true. */
  applyToSenders?: boolean;
  onResolutionChange?: (resolution: AdaptiveResolution, sample: AdaptiveBitrateSample) => void;
  onSample?: (sample: AdaptiveBitrateSample) => void;
}

export interface AdaptiveBitrateController {
  stop: () => void;
  getResolution: () => AdaptiveResolution;
  /** Runs one poll immediately; exposed for tests and manual refresh. */
  poll: () => Promise<AdaptiveBitrateSample | null>;
}

/**
 * Polls `peerConnection.getStats()` every 2 seconds, estimates interval packet
 * loss and available bandwidth, and walks the 1080p → 720p → 480p →
 * audio-only ladder.
 *
 * Time: O(s) per poll over stats entries. Space: O(1) (only the previous
 * counter snapshot is retained).
 */
export function startAdaptiveBitrate(
  peerConnection: RTCPeerConnection,
  options: AdaptiveBitrateOptions = {},
): AdaptiveBitrateController {
  const {
    intervalMs = ABR_POLL_INTERVAL_MS,
    initialResolution = '720p',
    ceiling = '1080p',
    applyToSenders = true,
    onResolutionChange,
    onSample,
  } = options;

  let resolution: AdaptiveResolution = initialResolution;
  let stablePolls = 0;
  let previous: RtpCounters | null = null;
  let stopped = false;

  const applyResolution = async (next: AdaptiveResolution) => {
    if (!applyToSenders) return;
    const senders = peerConnection.getSenders?.() ?? [];
    await Promise.all(
      senders.map((sender) =>
        applyResolutionToSender(sender, next).catch((err) => {
          captureError(err instanceof Error ? err : new Error(String(err)), {
            context: 'adaptive-bitrate-set-parameters',
          });
        }),
      ),
    );
  };

  const poll = async (): Promise<AdaptiveBitrateSample | null> => {
    if (stopped) return null;
    let current: RtpCounters;
    try {
      current = readRtpCounters(await peerConnection.getStats());
    } catch {
      return null; // transient while the connection is closing
    }

    const prev = previous;
    previous = current;
    if (!prev) return null; // need two snapshots for a delta

    const packetLossPercent = computeIntervalPacketLoss(prev, current);
    const decision = nextAdaptiveResolution(resolution, packetLossPercent, stablePolls, ceiling);
    stablePolls = decision.stablePolls;

    const sample: AdaptiveBitrateSample = {
      timestamp: current.timestamp || Date.now(),
      packetLossPercent: Math.round(packetLossPercent * 100) / 100,
      rttMs: current.rttMs,
      availableOutgoingKbps: current.availableOutgoingKbps,
      resolution: decision.resolution,
      quality: classifyConnectionQuality(packetLossPercent, current.rttMs),
    };

    if (decision.resolution !== resolution) {
      resolution = decision.resolution;
      await applyResolution(resolution);
      onResolutionChange?.(resolution, sample);
    }
    onSample?.(sample);
    return sample;
  };

  void applyResolution(resolution);
  void poll();
  const handle = setInterval(() => {
    void poll();
  }, intervalMs);

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
    getResolution: () => resolution,
    poll,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   #256 — Browser-side noise cancellation & acoustic echo suppression
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Capture constraints that force the browser's built-in AEC, noise
 * suppression and AGC on. Chrome, Firefox and Safari all honour these; they
 * run before our Web Audio graph, which then removes the residual rumble and
 * room noise the built-in stages leave behind.
 */
export const ENHANCED_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

/** getUserMedia constraints with echo cancellation & noise suppression enforced. */
export function getEnhancedAudioConstraints(
  overrides: MediaTrackConstraints = {},
): MediaTrackConstraints {
  return { ...overrides, ...ENHANCED_AUDIO_CONSTRAINTS };
}

/**
 * Re-applies the enhanced constraints to an existing microphone track (e.g. a
 * track handed over by the video SDK). Resolves with whether the browser
 * reports both AEC and noise suppression as active afterwards.
 */
export async function enforceAudioTrackConstraints(track: MediaStreamTrack): Promise<boolean> {
  try {
    await track.applyConstraints(getEnhancedAudioConstraints());
  } catch (err) {
    captureError(err instanceof Error ? err : new Error(String(err)), {
      context: 'audio-apply-constraints',
    });
  }
  const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
  return settings.echoCancellation === true && settings.noiseSuppression === true;
}

export const HIGH_PASS_CUTOFF_HZ = 80;

export interface NoiseGateConfig {
  /** Level (dBFS) at which the gate opens. */
  openThresholdDb: number;
  /** Level (dBFS) below which the gate may close; lower than open for hysteresis. */
  closeThresholdDb: number;
  /** Time the gate stays open after the level drops below the close threshold. */
  holdMs: number;
  /** Gain time constants (seconds) for opening and closing. */
  attackSeconds: number;
  releaseSeconds: number;
  /** Gain applied while closed (0 = full mute, small values sound more natural). */
  floorGain: number;
}

export const DEFAULT_NOISE_GATE: NoiseGateConfig = {
  openThresholdDb: -50,
  closeThresholdDb: -56,
  holdMs: 200,
  attackSeconds: 0.005,
  releaseSeconds: 0.08,
  floorGain: 0.05,
};

/**
 * Root-mean-square level of a time-domain buffer, in dBFS. Silence maps to
 * -Infinity's practical floor of -100 dB.
 *
 * Time: O(n) over samples. Space: O(1).
 */
export function computeRmsDb(samples: Float32Array): number {
  if (samples.length === 0) return -100;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    sum += s * s;
  }
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 0) return -100;
  return Math.max(-100, 20 * Math.log10(rms));
}

export interface NoiseGateState {
  open: boolean;
  /** Last time (ms) the level was above the close threshold. */
  lastActiveAt: number;
}

/**
 * Pure gate state machine with hysteresis and hold.
 *
 * Time: O(1). Space: O(1).
 */
export function evaluateNoiseGate(
  state: NoiseGateState,
  levelDb: number,
  nowMs: number,
  config: NoiseGateConfig = DEFAULT_NOISE_GATE,
): NoiseGateState {
  if (levelDb >= config.openThresholdDb) {
    return { open: true, lastActiveAt: nowMs };
  }
  if (state.open && levelDb >= config.closeThresholdDb) {
    return { open: true, lastActiveAt: nowMs };
  }
  if (state.open && nowMs - state.lastActiveAt < config.holdMs) {
    return state;
  }
  return { open: false, lastActiveAt: state.lastActiveAt };
}

/** Node kinds in the processing graph, in signal order. */
export const AUDIO_GRAPH_TOPOLOGY = [
  'MediaStreamAudioSourceNode',
  'BiquadFilterNode(highpass)',
  'AnalyserNode(gate-sidechain)',
  'GainNode(noise-gate)',
  'MediaStreamAudioDestinationNode',
] as const;

export interface NoiseCancellationOptions {
  highPassHz?: number;
  gate?: Partial<NoiseGateConfig>;
  /** Interval for gate level detection. 10ms keeps attack well under a syllable. */
  detectionIntervalMs?: number;
  /** Inject an AudioContext (tests, or to share one across pipelines). */
  audioContext?: AudioContext;
}

export interface NoiseCancellationPipeline {
  /** Processed stream: filtered/gated audio + the input's original video tracks. */
  stream: MediaStream;
  context: AudioContext;
  nodes: {
    source: MediaStreamAudioSourceNode;
    highPass: BiquadFilterNode;
    analyser: AnalyserNode;
    gate: GainNode;
    destination: MediaStreamAudioDestinationNode;
  };
  /** Bypass (false) or re-enable (true) the filter + gate without rebuilding the graph. */
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  isGateOpen: () => boolean;
  close: () => Promise<void>;
}

function getAudioContextCtor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function isNoiseCancellationSupported(): boolean {
  return getAudioContextCtor() !== null;
}

/**
 * Builds the Web Audio graph
 * `source → high-pass (80 Hz) → analyser → gate gain → destination`.
 *
 * The 80 Hz high-pass removes HVAC rumble, desk thumps and mains hum
 * harmonics without touching the voice fundamental (~85–255 Hz). The gate
 * attenuates the residual noise floor between utterances; its level detector
 * reads the analyser (post-filter) so rumble cannot hold the gate open.
 *
 * Time: O(1) graph construction; O(fftSize) per detection tick.
 * Space: O(fftSize) for the analyser buffer.
 */
export function createNoiseCancellationPipeline(
  input: MediaStream,
  options: NoiseCancellationOptions = {},
): NoiseCancellationPipeline {
  const Ctor = getAudioContextCtor();
  const context = options.audioContext ?? (Ctor ? new Ctor() : null);
  if (!context) {
    throw new Error('Web Audio API is not available in this browser.');
  }

  const gateConfig: NoiseGateConfig = { ...DEFAULT_NOISE_GATE, ...options.gate };
  const detectionIntervalMs = options.detectionIntervalMs ?? 10;

  const source = context.createMediaStreamSource(input);

  const highPass = context.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = options.highPassHz ?? HIGH_PASS_CUTOFF_HZ;
  highPass.Q.value = Math.SQRT1_2; // Butterworth: maximally flat passband

  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0;

  const gate = context.createGain();
  gate.gain.value = gateConfig.floorGain;

  const destination = context.createMediaStreamDestination();

  source.connect(highPass);
  highPass.connect(analyser);
  analyser.connect(gate);
  gate.connect(destination);

  const buffer = new Float32Array(analyser.fftSize);
  let gateState: NoiseGateState = { open: false, lastActiveAt: 0 };
  let enabled = true;
  let closed = false;

  const setGain = (target: number, timeConstant: number) => {
    const now = context.currentTime;
    gate.gain.cancelScheduledValues(now);
    gate.gain.setTargetAtTime(target, now, timeConstant);
  };

  const detect = () => {
    if (!enabled || closed) return;
    analyser.getFloatTimeDomainData(buffer);
    const level = computeRmsDb(buffer);
    const next = evaluateNoiseGate(gateState, level, Date.now(), gateConfig);
    if (next.open !== gateState.open) {
      setGain(
        next.open ? 1 : gateConfig.floorGain,
        next.open ? gateConfig.attackSeconds : gateConfig.releaseSeconds,
      );
    }
    gateState = next;
  };
  const timer = setInterval(detect, detectionIntervalMs);

  const stream = new MediaStream([
    ...destination.stream.getAudioTracks(),
    ...input.getVideoTracks(),
  ]);

  const setEnabled = (value: boolean) => {
    if (closed || value === enabled) return;
    enabled = value;
    if (value) {
      // 0 Hz high-pass ≈ passthrough; restore cutoff and let the gate re-arm.
      highPass.frequency.value = options.highPassHz ?? HIGH_PASS_CUTOFF_HZ;
      gateState = { open: false, lastActiveAt: 0 };
      setGain(gateConfig.floorGain, gateConfig.releaseSeconds);
    } else {
      highPass.frequency.value = 0;
      setGain(1, gateConfig.attackSeconds);
    }
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    source.disconnect();
    highPass.disconnect();
    analyser.disconnect();
    gate.disconnect();
    destination.stream.getAudioTracks().forEach((t) => t.stop());
    if (!options.audioContext && context.state !== 'closed') {
      await context.close();
    }
  };

  return {
    stream,
    context,
    nodes: { source, highPass, analyser, gate, destination },
    setEnabled,
    isEnabled: () => enabled,
    isGateOpen: () => gateState.open,
    close,
  };
}

/* ─── Acoustic Feedback Detection & Auto-Ducking (#269) ─────────────── */

/**
 * When two participants join from the same room (e.g. a clinician and a
 * nurse on separate laptops), one device's microphone picks up the other's
 * speaker. The loop gain at the room's resonant frequency exceeds 1 and the
 * signal "howls": a single narrow spectral peak, far louder than the bins
 * around it, that persists and keeps the same frequency. Speech never looks
 * like that — its energy is spread over harmonics that move every few tens
 * of milliseconds — so a peak that is both narrow and stable is a reliable
 * howling signature.
 */
export interface FeedbackDetectionConfig {
  /** Only bins between these frequencies are considered (howling is almost always in the 200 Hz–5 kHz band). */
  minFrequencyHz: number;
  maxFrequencyHz: number;
  /** Peak must be at least this loud (dBFS) to count; avoids flagging quiet hum. */
  minPeakDb: number;
  /** Peak must stand this many dB above the median of its neighbourhood. */
  minProminenceDb: number;
  /**
   * Peak must also stand this many dB above everything else in the band.
   * Speech spreads energy over several harmonics of similar level; a howl
   * dominates the whole spectrum (peak-to-harmonic ratio).
   */
  minDominanceDb: number;
  /** Half-width, in bins, of the neighbourhood used for the prominence check. */
  neighbourhoodBins: number;
  /** Bins within this distance are treated as the "same" frequency between frames. */
  frequencyToleranceBins: number;
  /** A peak must persist at a stable frequency for this long before ducking. */
  sustainMs: number;
  /** After the last spike, stay ducked this long before restoring volume. */
  releaseMs: number;
}

export const DEFAULT_FEEDBACK_DETECTION: FeedbackDetectionConfig = {
  minFrequencyHz: 200,
  maxFrequencyHz: 5000,
  minPeakDb: -45,
  minProminenceDb: 25,
  minDominanceDb: 10,
  neighbourhoodBins: 12,
  frequencyToleranceBins: 2,
  sustainMs: 300,
  releaseMs: 4000,
};

/** Attenuation applied to playback while feedback is detected. */
export const FEEDBACK_DUCK_DB = 20;

/** Converts a dB change to a linear gain multiplier (-20 dB → 0.1). */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Linear playback gain while ducked: 20 dB below unity, i.e. 0.1. */
export const FEEDBACK_DUCK_GAIN = dbToGain(-FEEDBACK_DUCK_DB);

export interface FeedbackSpike {
  bin: number;
  frequencyHz: number;
  peakDb: number;
  prominenceDb: number;
}

function median(values: number[]): number {
  if (values.length === 0) return -Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Finds the most prominent narrowband peak in one frame of an
 * `AnalyserNode.getFloatFrequencyData` spectrum (dB per bin). Returns null
 * when no bin qualifies as a howling candidate.
 *
 * Time: O(B · W log W) for B bins in range and neighbourhood width W.
 * Space: O(W).
 */
export function detectFeedbackSpike(
  spectrumDb: Float32Array,
  sampleRate: number,
  config: FeedbackDetectionConfig = DEFAULT_FEEDBACK_DETECTION,
): FeedbackSpike | null {
  const binCount = spectrumDb.length;
  if (binCount === 0 || sampleRate <= 0) return null;
  const binHz = sampleRate / 2 / binCount;
  const first = Math.max(1, Math.ceil(config.minFrequencyHz / binHz));
  const last = Math.min(binCount - 2, Math.floor(config.maxFrequencyHz / binHz));

  let best: FeedbackSpike | null = null;
  for (let i = first; i <= last; i++) {
    const peak = spectrumDb[i]!;
    if (!Number.isFinite(peak) || peak < config.minPeakDb) continue;
    // Local maximum only.
    if (peak < spectrumDb[i - 1]! || peak < spectrumDb[i + 1]!) continue;

    // Skip the peak itself and its immediate skirt (window leakage) so a
    // pure tone's own sidelobes do not raise the reference level.
    const neighbours: number[] = [];
    const lo = Math.max(0, i - config.neighbourhoodBins);
    const hi = Math.min(binCount - 1, i + config.neighbourhoodBins);
    for (let j = lo; j <= hi; j++) {
      if (Math.abs(j - i) <= 2) continue;
      const v = spectrumDb[j]!;
      neighbours.push(Number.isFinite(v) ? v : -140);
    }
    const prominence = peak - median(neighbours);
    if (prominence < config.minProminenceDb) continue;
    if (!best || prominence > best.prominenceDb) {
      best = { bin: i, frequencyHz: i * binHz, peakDb: peak, prominenceDb: prominence };
    }
  }
  if (!best) return null;

  // Dominance: compare with the loudest bin outside the peak's neighbourhood.
  let rest = -Infinity;
  for (let j = first; j <= last; j++) {
    if (Math.abs(j - best.bin) <= config.neighbourhoodBins) continue;
    const v = spectrumDb[j]!;
    if (Number.isFinite(v) && v > rest) rest = v;
  }
  if (Number.isFinite(rest) && best.peakDb - rest < config.minDominanceDb) return null;
  return best;
}

export interface FeedbackState {
  /** Playback is currently ducked. */
  ducked: boolean;
  /** Candidate peak being tracked, and when it first appeared. */
  candidateBin: number | null;
  candidateSince: number;
  /** Last time a qualifying spike was seen. */
  lastSpikeAt: number;
  /** Frequency that triggered the current duck, for the on-screen notice. */
  frequencyHz: number | null;
}

export const INITIAL_FEEDBACK_STATE: FeedbackState = {
  ducked: false,
  candidateBin: null,
  candidateSince: 0,
  lastSpikeAt: 0,
  frequencyHz: null,
};

/**
 * Pure state machine: ducks once a spike holds a stable frequency for
 * `sustainMs`, and releases `releaseMs` after the last spike. Transient
 * peaks (a whistle, a dropped instrument) never last long enough to trigger.
 *
 * Time: O(1). Space: O(1).
 */
export function evaluateFeedbackState(
  state: FeedbackState,
  spike: FeedbackSpike | null,
  nowMs: number,
  config: FeedbackDetectionConfig = DEFAULT_FEEDBACK_DETECTION,
): FeedbackState {
  if (!spike) {
    if (state.ducked && nowMs - state.lastSpikeAt >= config.releaseMs) {
      return { ...INITIAL_FEEDBACK_STATE, lastSpikeAt: state.lastSpikeAt };
    }
    if (state.ducked) return state;
    return { ...state, candidateBin: null, candidateSince: 0 };
  }

  const sameFrequency =
    state.candidateBin !== null &&
    Math.abs(spike.bin - state.candidateBin) <= config.frequencyToleranceBins;
  const candidateSince = sameFrequency ? state.candidateSince : nowMs;
  const sustained = nowMs - candidateSince >= config.sustainMs;

  if (state.ducked) {
    return { ...state, candidateBin: spike.bin, candidateSince, lastSpikeAt: nowMs };
  }
  return {
    ducked: sustained,
    candidateBin: spike.bin,
    candidateSince,
    lastSpikeAt: nowMs,
    frequencyHz: sustained ? spike.frequencyHz : null,
  };
}

export interface FeedbackDetectorStatus {
  ducked: boolean;
  frequencyHz: number | null;
  /** Gain playback should use: 1, or {@link FEEDBACK_DUCK_GAIN} while ducked. */
  gain: number;
}

export interface FeedbackDetectorOptions {
  config?: Partial<FeedbackDetectionConfig>;
  /** Detection tick; 50 ms gives ~6 frames inside the 300 ms sustain window. */
  intervalMs?: number;
  audioContext?: AudioContext;
  onChange?: (status: FeedbackDetectorStatus) => void;
  now?: () => number;
}

export interface FeedbackDetector {
  getStatus: () => FeedbackDetectorStatus;
  /** Clears a duck immediately (e.g. after the user turns a device down). */
  reset: () => void;
  stop: () => Promise<void>;
}

/**
 * Taps the local microphone with an `AnalyserNode` (it is never connected to
 * the output, so nothing is added to the call) and reports when howling is
 * detected. The caller applies {@link FeedbackDetectorStatus.gain} to remote
 * playback: cutting the speaker by 20 dB drops the loop gain below 1 and the
 * howl collapses within a few hundred milliseconds.
 */
export function createFeedbackDetector(
  input: MediaStream,
  options: FeedbackDetectorOptions = {},
): FeedbackDetector {
  const Ctor = getAudioContextCtor();
  const context = options.audioContext ?? (Ctor ? new Ctor() : null);
  if (!context) throw new Error('Web Audio API is not available in this browser.');

  const config: FeedbackDetectionConfig = { ...DEFAULT_FEEDBACK_DETECTION, ...options.config };
  const now = options.now ?? Date.now;

  const source = context.createMediaStreamSource(input);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  // Light smoothing steadies the peak across frames without hiding onset.
  analyser.smoothingTimeConstant = 0.5;
  source.connect(analyser);

  const spectrum = new Float32Array(analyser.frequencyBinCount);
  let state: FeedbackState = INITIAL_FEEDBACK_STATE;
  let stopped = false;

  const toStatus = (s: FeedbackState): FeedbackDetectorStatus => ({
    ducked: s.ducked,
    frequencyHz: s.frequencyHz,
    gain: s.ducked ? FEEDBACK_DUCK_GAIN : 1,
  });

  const tick = () => {
    if (stopped) return;
    analyser.getFloatFrequencyData(spectrum);
    const spike = detectFeedbackSpike(spectrum, context.sampleRate, config);
    const next = evaluateFeedbackState(state, spike, now(), config);
    const changed = next.ducked !== state.ducked;
    state = next;
    if (changed) options.onChange?.(toStatus(state));
  };
  const timer = setInterval(tick, options.intervalMs ?? 50);

  return {
    getStatus: () => toStatus(state),
    reset: () => {
      const wasDucked = state.ducked;
      state = INITIAL_FEEDBACK_STATE;
      if (wasDucked) options.onChange?.(toStatus(state));
    },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
      if (!options.audioContext && context.state !== 'closed') await context.close();
    },
  };
}

/* ─── Audio Output (Speaker) Selection (#267) ───────────────────────── */

export const AUDIO_OUTPUT_STORAGE_KEY = 'heliora:audio-output-device';
/** `setSinkId('')` routes to the user agent's default output. */
export const DEFAULT_AUDIO_OUTPUT_ID = 'default';

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

type SinkableElement = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };

/** Chrome/Edge/Firefox 116+ support `setSinkId`; Safari does not. */
export function isAudioOutputSelectionSupported(): boolean {
  return (
    typeof HTMLMediaElement !== 'undefined' &&
    typeof (HTMLMediaElement.prototype as SinkableElement).setSinkId === 'function'
  );
}

/**
 * Lists speakers/headsets. Labels are blank until the page has been granted
 * microphone access, so unnamed devices get a numbered fallback label.
 */
export async function listAudioOutputDevices(
  mediaDevices: Pick<MediaDevices, 'enumerateDevices'> | undefined = typeof navigator !== 'undefined'
    ? navigator.mediaDevices
    : undefined,
): Promise<AudioOutputDevice[]> {
  if (!mediaDevices?.enumerateDevices) return [];
  const devices = await mediaDevices.enumerateDevices();
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  const seen = new Set<string>();
  const result: AudioOutputDevice[] = [];
  outputs.forEach((d, index) => {
    if (seen.has(d.deviceId)) return;
    seen.add(d.deviceId);
    result.push({
      deviceId: d.deviceId,
      label:
        d.label ||
        (d.deviceId === DEFAULT_AUDIO_OUTPUT_ID ? 'System default' : `Speaker ${index + 1}`),
    });
  });
  return result;
}

/**
 * Routes every element to `deviceId`. Elements that fail (device unplugged,
 * permission denied) are reported rather than thrown, so one bad element does
 * not leave the others on the old device.
 */
export async function applyAudioOutputDevice(
  elements: Iterable<HTMLMediaElement | null | undefined>,
  deviceId: string,
): Promise<{ applied: number; failed: number; error?: Error }> {
  const sinkId = deviceId === DEFAULT_AUDIO_OUTPUT_ID ? '' : deviceId;
  let applied = 0;
  let failed = 0;
  let error: Error | undefined;
  for (const el of elements) {
    const sinkable = el as SinkableElement | null | undefined;
    if (!sinkable || typeof sinkable.setSinkId !== 'function') continue;
    try {
      await sinkable.setSinkId(sinkId);
      applied++;
    } catch (err) {
      failed++;
      error = err instanceof Error ? err : new Error(String(err));
    }
  }
  return error ? { applied, failed, error } : { applied, failed };
}

export function loadPreferredAudioOutput(storage?: Storage): string {
  try {
    const s = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    return s?.getItem(AUDIO_OUTPUT_STORAGE_KEY) || DEFAULT_AUDIO_OUTPUT_ID;
  } catch {
    return DEFAULT_AUDIO_OUTPUT_ID;
  }
}

export function savePreferredAudioOutput(deviceId: string, storage?: Storage): void {
  try {
    const s = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    s?.setItem(AUDIO_OUTPUT_STORAGE_KEY, deviceId);
  } catch {
    // Private mode / quota: the choice still applies for this session.
  }
}

/**
 * Builds a short two-note chime as a 16-bit mono PCM WAV. Generated in code
 * so there is no asset to fetch and the sample works offline.
 *
 * Time/Space: O(sampleRate · durationSeconds).
 */
export function createTestToneWav(
  options: { sampleRate?: number; durationSeconds?: number; frequenciesHz?: number[] } = {},
): Uint8Array {
  const sampleRate = options.sampleRate ?? 22050;
  const duration = options.durationSeconds ?? 0.9;
  const notes = options.frequenciesHz ?? [660, 880];
  const sampleCount = Math.round(sampleRate * duration);
  const dataBytes = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  const perNote = Math.ceil(sampleCount / notes.length);
  for (let i = 0; i < sampleCount; i++) {
    const noteIndex = Math.min(notes.length - 1, Math.floor(i / perNote));
    const t = (i - noteIndex * perNote) / sampleRate;
    const noteLen = perNote / sampleRate;
    // 10 ms attack, exponential decay: no clicks at note boundaries.
    const envelope = Math.min(1, t / 0.01) * Math.exp((-4 * t) / noteLen);
    const sample = 0.35 * envelope * Math.sin(2 * Math.PI * notes[noteIndex]! * t);
    view.setInt16(44 + i * 2, Math.round(sample * 0x7fff), true);
  }
  return new Uint8Array(buffer);
}

/**
 * Plays the test chime on `deviceId`. Resolves once playback has started;
 * rejects when the browser blocks playback or the device is unavailable.
 */
export async function playTestSpeakerSample(
  deviceId: string,
  options: { createAudio?: () => HTMLAudioElement } = {},
): Promise<HTMLAudioElement> {
  const audio = options.createAudio?.() ?? new Audio();
  const wav = createTestToneWav();
  const url = URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }));
  const cleanup = () => URL.revokeObjectURL(url);
  audio.addEventListener('ended', cleanup, { once: true });
  audio.src = url;
  try {
    const { error } = await applyAudioOutputDevice([audio], deviceId);
    if (error) throw error;
    await audio.play();
  } catch (err) {
    cleanup();
    throw err;
  }
  return audio;
}
