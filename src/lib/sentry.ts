import * as Sentry from '@sentry/nextjs';
import type { UserRole } from '@/types';

/* ─── Sampling ──────────────────────────────────────────────────────────────
 * Performance tracing is sampled so it adds no measurable overhead for the
 * majority of sessions:
 *  - An upstream sampling decision (e.g. from a `sentry-trace` header) is always
 *    honoured so distributed traces are never broken half-way.
 *  - Health checks, static assets and prefetches are never traced.
 *  - Stellar transaction lifecycles are rare, user-initiated and high-value, so
 *    they get their own (higher) rate.
 *  - Everything else uses the base rate (10% in production by default).
 */

export type SentryRuntime = 'client' | 'server' | 'edge';

const DEFAULT_PRODUCTION_TRACES_RATE = 0.1;
const DEFAULT_PRODUCTION_STELLAR_TRACES_RATE = 0.5;
const DEFAULT_REPLAY_SESSION_RATE = 0.1;

const NEVER_TRACE = [
  /\/health(z)?\b/i,
  /\/_next\/static\//,
  /\/favicon\.ico$/,
  /\.(png|jpe?g|svg|webp|woff2?)$/i,
];

/** Parses a 0–1 sample rate from an env var, falling back on missing/invalid values. */
export function parseSampleRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) return fallback;
  return value;
}

export interface SampleRates {
  traces: number;
  stellarTraces: number;
  replaySession: number;
  replayOnError: number;
}

export function getSampleRates(env: Record<string, string | undefined> = process.env): SampleRates {
  const isProduction = env.NODE_ENV === 'production';
  return {
    traces: parseSampleRate(
      env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
      isProduction ? DEFAULT_PRODUCTION_TRACES_RATE : 1.0,
    ),
    stellarTraces: parseSampleRate(
      env.NEXT_PUBLIC_SENTRY_STELLAR_TRACES_SAMPLE_RATE,
      isProduction ? DEFAULT_PRODUCTION_STELLAR_TRACES_RATE : 1.0,
    ),
    replaySession: parseSampleRate(
      env.NEXT_PUBLIC_SENTRY_REPLAY_SESSION_SAMPLE_RATE,
      DEFAULT_REPLAY_SESSION_RATE,
    ),
    replayOnError: 1.0,
  };
}

/** Subset of Sentry's sampling context that the sampler relies on. */
export interface TracesSamplingContext {
  name: string;
  attributes?: Record<string, unknown> | undefined;
  parentSampled?: boolean | undefined;
  inheritOrSampleWith?: ((fallbackRate: number) => number) | undefined;
}

export function createTracesSampler(rates: SampleRates) {
  return (context: TracesSamplingContext): number => {
    const name = context.name ?? '';
    if (NEVER_TRACE.some((pattern) => pattern.test(name))) return 0;

    const op = String(context.attributes?.['sentry.op'] ?? '');
    const rate = op.startsWith('stellar.') ? rates.stellarTraces : rates.traces;

    // Keep distributed traces whole: follow the parent's decision when there is one.
    if (context.inheritOrSampleWith) return context.inheritOrSampleWith(rate);
    if (typeof context.parentSampled === 'boolean') return context.parentSampled ? 1 : 0;
    return rate;
  };
}

/**
 * Origins that receive `sentry-trace`/`baggage` headers. Restricted to our own
 * backend: adding custom headers to Horizon, Soroban RPC or SEP anchors would
 * trigger CORS preflights they may reject. Those calls are still timed as
 * `http.client` child spans; they just don't continue the trace server-side.
 */
export function getTracePropagationTargets(
  apiUrl = process.env.NEXT_PUBLIC_API_URL,
): Array<string | RegExp> {
  const targets: Array<string | RegExp> = [/^\/(?!\/)/];
  if (apiUrl) {
    try {
      const { origin } = new URL(apiUrl);
      targets.push(new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`));
    } catch {
      // Relative API URL: covered by the same-origin pattern above.
    }
  }
  return targets;
}

/* ─── PII / secret scrubbing ────────────────────────────────────────────────
 * Applied to every error event, transaction and breadcrumb before it leaves
 * the browser or server. Matching is by key name (for structured data) and by
 * value pattern (for free text such as messages and URLs).
 */

export const REDACTED = '[Redacted]';

const SENSITIVE_KEY =
  /pass(word|phrase)?|secret|private.?key|secret.?key|seed|mnemonic|recovery|shard|token|authori[sz]ation|cookie|signature|signed.?(tx|xdr|envelope)|envelope.?xdr|^xdr$|ciphertext|plaintext|ssn|social.?security|dob|birth|diagnos|icd|notes?$|symptom|prescri|medication|allerg|treatment|clinical|intake|questionnaire|transcri|dictation|record.?content|^content$|patient.?name|full.?name|first.?name|last.?name|^name$|email|phone|address|insurance|policy.?number|license/i;

const VALUE_PATTERNS: Array<[RegExp, string]> = [
  // Stellar secret seeds (S… base32, 56 chars).
  [/\bS[A-Z2-7]{55}\b/g, '[stellar-secret]'],
  // Stellar account and contract addresses.
  [/\b[GC][A-Z2-7]{55}\b/g, '[stellar-address]'],
  // Bearer tokens and JWTs.
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [Redacted]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[jwt]'],
  // Email addresses.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  // Long base64 blobs such as transaction envelopes or ciphertext.
  [/\b[A-Za-z0-9+/]{120,}={0,2}/g, '[blob]'],
];

/** Redacts secrets and PII patterns in free text. */
export function scrubString(value: string): string {
  return VALUE_PATTERNS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    value,
  );
}

/** Drops the query string (which carries addresses and identifiers) from a URL. */
export function scrubUrl(url: string): string {
  const queryStart = url.search(/[?#]/);
  const path = queryStart === -1 ? url : url.slice(0, queryStart);
  return scrubString(path);
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

const MAX_SCRUB_DEPTH = 8;

/** Deep-copies `value`, masking sensitive keys and patterns. Never mutates input. */
export function scrubData<T>(value: T, depth = 0): T {
  if (depth > MAX_SCRUB_DEPTH) return REDACTED as T;
  if (typeof value === 'string') return scrubString(value) as T;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrubData(item, depth + 1)) as T;

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (/^(url|from|to|http\.url|url\.full)$/i.test(key) && typeof inner === 'string') {
      out[key] = scrubUrl(inner);
    } else if (/^(query|query_string|http\.query|url\.query)$/i.test(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = isSensitiveKey(key) ? REDACTED : scrubData(inner, depth + 1);
    }
  }
  return out as T;
}

export function scrubBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  const scrubbed: Sentry.Breadcrumb = { ...breadcrumb };
  if (scrubbed.message) scrubbed.message = scrubString(scrubbed.message);
  if (scrubbed.data) {
    const data = scrubData(scrubbed.data);
    // Console breadcrumbs carry raw logged objects; never forward them.
    if (scrubbed.category === 'console') delete data.arguments;
    // Request/response bodies are never needed to debug latency.
    delete data.body;
    delete data.request_body;
    delete data.response_body;
    scrubbed.data = data;
  }
  return scrubbed;
}

/**
 * SDK-populated contexts whose fields describe the runtime, not the user. Their
 * `name`/`version` fields must survive (e.g. browser "Chrome"), but they are
 * still pattern-scrubbed in case a value embeds something sensitive.
 */
const RUNTIME_CONTEXTS = new Set(['browser', 'os', 'device', 'runtime', 'app', 'culture', 'trace']);

function scrubContexts(contexts: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(contexts)) {
    if (RUNTIME_CONTEXTS.has(key) && value && typeof value === 'object') {
      const ctx = value as Record<string, unknown>;
      const { data, ...fields } = ctx;
      out[key] = {
        ...Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' ? scrubString(v) : v]),
        ),
        ...(data !== undefined ? { data: scrubData(data) } : {}),
      };
    } else {
      out[key] = isSensitiveKey(key) ? REDACTED : scrubData(value);
    }
  }
  return out;
}

type SentryOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type BeforeSendTransaction = NonNullable<SentryOptions['beforeSendTransaction']>;
type BeforeSend = NonNullable<SentryOptions['beforeSend']>;

/** The parts of a Sentry event (error or transaction) that can carry PII. */
export interface ScrubbableEvent {
  message?: string;
  transaction?: string;
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    [key: string]: unknown;
  };
  user?: { id?: string | number; [key: string]: unknown };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  exception?: { values?: Array<{ value?: string; [key: string]: unknown }> };
  breadcrumbs?: Sentry.Breadcrumb[];
  spans?: Array<{ description?: string; data?: Record<string, unknown>; [key: string]: unknown }>;
}

export function scrubEvent<E>(event: E): E {
  const scrubbed = { ...(event as ScrubbableEvent) };

  if (scrubbed.message) scrubbed.message = scrubString(scrubbed.message);
  if (scrubbed.transaction) scrubbed.transaction = scrubUrl(scrubbed.transaction);

  if (scrubbed.request) {
    // Drop body (`data`), cookies and query_string entirely; keep only routing info.
    const { url, headers, method } = scrubbed.request;
    scrubbed.request = {
      ...(url ? { url: scrubUrl(url) } : {}),
      ...(headers ? { headers: scrubData(headers) } : {}),
      ...(method ? { method } : {}),
    };
  }

  if (scrubbed.user) {
    // Keep only the pseudonymous id set by setSentryUser.
    scrubbed.user = scrubbed.user.id !== undefined ? { id: scrubbed.user.id } : {};
  }

  if (scrubbed.extra) scrubbed.extra = scrubData(scrubbed.extra);
  if (scrubbed.contexts) scrubbed.contexts = scrubContexts(scrubbed.contexts);
  if (scrubbed.tags) scrubbed.tags = scrubData(scrubbed.tags);

  if (scrubbed.exception?.values) {
    scrubbed.exception = {
      ...scrubbed.exception,
      values: scrubbed.exception.values.map((ex) => ({
        ...ex,
        ...(ex.value ? { value: scrubString(ex.value) } : {}),
      })),
    };
  }

  if (scrubbed.breadcrumbs) {
    scrubbed.breadcrumbs = scrubbed.breadcrumbs
      .map((crumb) => scrubBreadcrumb(crumb))
      .filter((crumb): crumb is Sentry.Breadcrumb => crumb !== null);
  }

  if (scrubbed.spans) {
    scrubbed.spans = scrubbed.spans.map((span) => ({
      ...span,
      ...(span.description ? { description: scrubUrl(span.description) } : {}),
      ...(span.data ? { data: scrubData(span.data) } : {}),
    }));
  }

  return scrubbed as E;
}

/* ─── Init options ──────────────────────────────────────────────────────── */

/** Shared `Sentry.init` options for every runtime (client, server, edge). */
export function getSentryOptions(runtime: SentryRuntime) {
  const rates = getSampleRates();
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  const base = {
    dsn,
    environment: process.env.NODE_ENV,
    // Without a DSN the SDK would still instrument; skip all work instead.
    enabled: process.env.NODE_ENV === 'production' && !!dsn,
    sendDefaultPii: false,
    tracesSampler: createTracesSampler(rates),
    tracePropagationTargets: getTracePropagationTargets(),
    maxBreadcrumbs: 50,
    beforeBreadcrumb: (breadcrumb: Sentry.Breadcrumb) => scrubBreadcrumb(breadcrumb),
    beforeSend: (<E>(event: E) => scrubEvent(event)) as BeforeSend,
    beforeSendTransaction: (<E>(event: E) => scrubEvent(event)) as BeforeSendTransaction,
  };

  if (runtime !== 'client') return base;

  return {
    ...base,
    replaysSessionSampleRate: rates.replaySession,
    replaysOnErrorSampleRate: rates.replayOnError,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }),
    ],
  };
}

export function initSentry(runtime: SentryRuntime = 'client') {
  Sentry.init(getSentryOptions(runtime));
}

/* ─── Tracing helpers ───────────────────────────────────────────────────── */

/**
 * Wraps a user-initiated action (click → API calls → chain calls) in a single
 * span so every Axios request and Stellar call it makes joins one trace.
 */
export function traceUserAction<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  return Sentry.startSpan({ name, op: 'ui.action', forceTransaction: true }, async () => fn());
}

export type StellarTxPhase = 'build' | 'simulate' | 'sign' | 'submit' | 'confirm';

export type StellarStepRunner = <S>(phase: StellarTxPhase, fn: () => Promise<S> | S) => Promise<S>;

/**
 * Traces a multi-step Stellar transaction lifecycle. The parent span covers the
 * whole lifecycle; each `step` (build → simulate → sign → submit → confirm) gets
 * its own child span, so wallet-signing time and Horizon/RPC submission latency
 * are separately visible. Failures mark the active span as errored.
 */
export function traceStellarTransaction<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (step: StellarStepRunner, setTxHash: (hash: string) => void) => Promise<T>,
): Promise<T> {
  return Sentry.startSpan(
    { name, op: 'stellar.tx', attributes: scrubData(attributes) },
    async (parent) => {
      const step: StellarStepRunner = (phase, run) =>
        Sentry.startSpan({ name: `stellar.${phase}`, op: `stellar.tx.${phase}` }, async () =>
          run(),
        );
      const setTxHash = (hash: string) => parent.setAttribute('stellar.tx_hash', hash);
      return fn(step, setTxHash);
    },
  );
}

/**
 * Times one Horizon call including endpoint failover. Records the endpoint host
 * that finally answered and how many endpoints were tried, so slow fallbacks are
 * visible next to the `http.client` spans of each attempt.
 */
export function traceHorizonCall<T>(
  fn: (recordAttempt: (endpointUrl: string) => void) => Promise<T>,
): Promise<T> {
  return Sentry.startSpan({ name: 'horizon.request', op: 'stellar.horizon' }, async (span) => {
    let attempts = 0;
    const recordAttempt = (endpointUrl: string) => {
      attempts += 1;
      span.setAttribute('stellar.horizon.attempts', attempts);
      try {
        span.setAttribute('stellar.horizon.endpoint', new URL(endpointUrl).host);
      } catch {
        // Ignore malformed endpoint URLs.
      }
    };
    return fn(recordAttempt);
  });
}

/**
 * Records Horizon node health status in Sentry telemetry.
 * Captures latency, failure count, and alerts when consecutive failures mount.
 */
export function recordNodeHealthTelemetry(
  endpointUrl: string,
  health: { isHealthy: boolean; latency: number | null; failureCount: number; error?: string },
) {
  Sentry.addBreadcrumb({
    category: 'stellar.horizon.health',
    message: `Horizon node ${endpointUrl} is ${health.isHealthy ? 'healthy' : 'unhealthy'} (failures: ${health.failureCount}, latency: ${health.latency !== null ? Math.round(health.latency) : 'N/A'}ms)`,
    level: health.isHealthy ? 'info' : 'warning',
    data: { endpoint: endpointUrl, ...health },
  });

  if (!health.isHealthy && health.failureCount >= 3) {
    Sentry.captureMessage(
      `Horizon node failure threshold exceeded for ${endpointUrl}: ${health.error ?? 'Service unavailable'}`,
      'warning',
    );
  }
}

/* ─── User context ──────────────────────────────────────────────────────── */

export function setSentryUser(walletAddress: string, role: UserRole) {
  Sentry.setUser({ id: walletAddress });
  Sentry.setTag('user.role', role.toLowerCase());
}

export function clearSentryUser() {
  Sentry.setUser(null);
}

export function captureError(error: Error, context?: Record<string, unknown>) {
  Sentry.captureException(error, context ? { extra: scrubData(context) } : undefined);
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info') {
  Sentry.captureMessage(scrubString(message), level);
}

/* ─── WebRTC Call Quality Telemetry (#272) ──────────────────────────────── */

export const DROPPED_FRAMES_ALERT_THRESHOLD_PERCENT = 20;

export interface CallQualityMetrics {
  p95JitterMs: number;
  p95RttMs: number;
  avgRttMs: number;
  packetLossPercent: number;
  droppedFramesPercent: number;
  sampleCount: number;
  framesDecoded?: number;
  framesDropped?: number;
  qualityTier?: string;
}

/**
 * Sends an anonymous WebRTC call quality transaction to Sentry and triggers a
 * warning alert if dropped frames exceed 20%.
 */
export function reportCallQualityTelemetry(metrics: CallQualityMetrics): { alertTriggered: boolean } {
  const attributes = scrubData({
    'webrtc.jitter_p95_ms': metrics.p95JitterMs,
    'webrtc.rtt_p95_ms': metrics.p95RttMs,
    'webrtc.rtt_avg_ms': metrics.avgRttMs,
    'webrtc.packet_loss_pct': metrics.packetLossPercent,
    'webrtc.dropped_frames_pct': metrics.droppedFramesPercent,
    'webrtc.sample_count': metrics.sampleCount,
    ...(metrics.qualityTier ? { 'webrtc.quality_tier': metrics.qualityTier } : {}),
  });

  Sentry.startSpan(
    {
      name: 'telemedicine.call_quality',
      op: 'webrtc.quality',
      attributes,
    },
    (span) => {
      for (const [key, val] of Object.entries(attributes)) {
        if (typeof val === 'number' || typeof val === 'string') {
          span.setAttribute(key, val);
        }
      }
    },
  );

  const alertTriggered = metrics.droppedFramesPercent > DROPPED_FRAMES_ALERT_THRESHOLD_PERCENT;
  if (alertTriggered) {
    Sentry.addBreadcrumb({
      category: 'webrtc.quality',
      message: `Dropped frames (${metrics.droppedFramesPercent.toFixed(1)}%) exceeded ${DROPPED_FRAMES_ALERT_THRESHOLD_PERCENT}% threshold`,
      level: 'warning',
      data: attributes,
    });
    Sentry.captureMessage(
      `WebRTC call quality degraded: dropped frames ${metrics.droppedFramesPercent.toFixed(1)}% exceeds ${DROPPED_FRAMES_ALERT_THRESHOLD_PERCENT}% threshold`,
      'warning',
    );
  }

  return { alertTriggered };
}
