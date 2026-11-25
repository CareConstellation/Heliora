/* ── Pre-call hardware & network diagnostics (#262) ──────────────────
 * Pure decision logic lives here so it can be unit tested. The React
 * component only wires browser media and networking APIs to these helpers.
 */

/** Round trips at or below this are rated "good" (ms). */
export const PING_GOOD_MS = 150;
/** Round trips at or below this are rated "fair" (ms). Above it, "poor". */
export const PING_FAIR_MS = 400;
/** How long to wait for a relay candidate before reporting the server unreachable. */
export const TURN_CHECK_TIMEOUT_MS = 5_000;

const VU_GAIN = 4;
const SIGNAL_THRESHOLD = 0.02;

export type PingQuality = 'good' | 'fair' | 'poor' | 'unreachable';

export function classifyRoundTripMs(ms: number | null): PingQuality {
  if (ms === null || !Number.isFinite(ms)) return 'unreachable';
  if (ms <= PING_GOOD_MS) return 'good';
  if (ms <= PING_FAIR_MS) return 'fair';
  return 'poor';
}

/**
 * Converts time-domain audio samples (floats in [-1, 1]) into a 0..1 meter level
 * using RMS, so a steady voice moves the meter and silence keeps it at zero.
 *
 * Time: O(n) over the sample buffer. Space: O(1).
 */
export function computeVuLevel(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;

  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i] ?? 0;
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  return Math.min(1, rms * VU_GAIN);
}

/** True when a meter level is high enough to count as the user speaking. */
export function isSignalDetected(level: number): boolean {
  return level >= SIGNAL_THRESHOLD;
}

export type MediaErrorKind = 'permission' | 'missing-device' | 'busy' | 'other';

/** Maps a `getUserMedia` error name to the cause the user can act on. */
export function classifyMediaError(errorName: string | null): MediaErrorKind | null {
  if (!errorName) return null;
  switch (errorName) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'permission';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'missing-device';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy';
    default:
      return 'other';
  }
}

export interface PreCallReport {
  /** `DOMException.name` from `getUserMedia`, or `null` when both devices started. */
  mediaErrorName: string | null;
  micSignalDetected: boolean;
  /** `null` when the relay check did not produce a result. */
  roundTripMs: number | null;
  turnConfigured: boolean;
}

export type RecommendationSeverity = 'ok' | 'warning' | 'error';

export interface PreCallRecommendation {
  id: string;
  severity: RecommendationSeverity;
  message: string;
}

const MEDIA_ERROR_MESSAGES: Record<MediaErrorKind, string> = {
  permission:
    "Camera or microphone access is blocked. Allow both in your browser's site settings, then run the check again.",
  'missing-device':
    'No camera or microphone was found. Connect a device or enable it in your system settings, then run the check again.',
  busy:
    'Your camera or microphone is in use by another application. Close other video or call apps and try again.',
  other: 'The camera or microphone could not start. Reload the page and try again.',
};

/**
 * Turns a raw report into ordered, user-facing recommendations: errors first,
 * then warnings, then the all-clear message.
 */
export function buildPreCallRecommendations(report: PreCallReport): PreCallRecommendation[] {
  const items: PreCallRecommendation[] = [];

  const mediaKind = classifyMediaError(report.mediaErrorName);
  if (mediaKind) {
    items.push({ id: 'media', severity: 'error', message: MEDIA_ERROR_MESSAGES[mediaKind] });
  } else if (!report.micSignalDetected) {
    items.push({
      id: 'microphone-silent',
      severity: 'warning',
      message:
        'No sound was detected. Speak while the meter is running, and check that the right microphone is selected.',
    });
  }

  switch (classifyRoundTripMs(report.roundTripMs)) {
    case 'good':
      items.push({
        id: 'network',
        severity: 'ok',
        message: `Connection to the call relay looks good (${Math.round(report.roundTripMs ?? 0)} ms).`,
      });
      break;
    case 'fair':
      items.push({
        id: 'network',
        severity: 'warning',
        message: `Connection is slow (${Math.round(report.roundTripMs ?? 0)} ms). Video may stutter. Move closer to your router or switch networks.`,
      });
      break;
    case 'poor':
      items.push({
        id: 'network',
        severity: 'warning',
        message: `Connection is poor (${Math.round(report.roundTripMs ?? 0)} ms). Expect interruptions during the call.`,
      });
      break;
    case 'unreachable':
      if (report.turnConfigured) {
        items.push({
          id: 'network',
          severity: 'error',
          message:
            'Could not reach the call relay server. Calls on restrictive networks may fail. Try a different network.',
        });
      } else {
        items.push({
          id: 'network',
          severity: 'warning',
          message: 'No call relay server is configured for this deployment, so the network check was skipped.',
        });
      }
      break;
  }

  const hasErrors = items.some((item) => item.severity === 'error');
  const hasWarnings = items.some((item) => item.severity === 'warning');
  if (!hasErrors && !hasWarnings) {
    items.push({ id: 'ready', severity: 'ok', message: 'All checks passed. You are ready to join.' });
  }

  const rank: Record<RecommendationSeverity, number> = { error: 0, warning: 1, ok: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/**
 * Builds the relay configuration from public env vars. Returns `null` when no relay
 * is configured. Credentials are optional, for relays that do not require them.
 */
export function getTurnConfigFromEnv(): RTCConfiguration | null {
  const urls = (process.env.NEXT_PUBLIC_TURN_URLS ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  if (urls.length === 0) return null;

  const username = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const credential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
  const server: RTCIceServer = { urls };
  if (username && credential) {
    server.username = username;
    server.credential = credential;
  }
  return { iceServers: [server] };
}

/**
 * Estimates the round trip to the relay server by forcing relay-only ICE and timing
 * how long the first relay candidate takes to appear. Allocating a relay requires a
 * TURN round trip, so this is a close proxy for relay latency.
 *
 * Resolves `null` when no relay candidate arrives in time or WebRTC is unavailable.
 */
export function measureTurnRoundTrip(
  config: RTCConfiguration,
  timeoutMs: number = TURN_CHECK_TIMEOUT_MS,
): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof RTCPeerConnection === 'undefined') {
      resolve(null);
      return;
    }

    const pc = new RTCPeerConnection({ ...config, iceTransportPolicy: 'relay' });
    const started = performance.now();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      pc.close();
      resolve(value);
    };

    timer = setTimeout(() => finish(null), timeoutMs);

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        // Gathering finished without a relay candidate.
        finish(null);
        return;
      }
      if (/ typ relay /.test(event.candidate.candidate)) {
        finish(performance.now() - started);
      }
    };

    pc.createDataChannel('heliora-precall');
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => finish(null));
  });
}
