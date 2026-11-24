const startSpan = jest.fn();
const setAttribute = jest.fn();
const addBreadcrumb = jest.fn();
const captureMessage = jest.fn();

jest.mock('@sentry/nextjs', () => ({
  startSpan: (opts: unknown, cb: (span: unknown) => unknown) => {
    startSpan(opts);
    return cb({ setAttribute });
  },
  addBreadcrumb: (b: unknown) => addBreadcrumb(b),
  captureMessage: (msg: string, level?: string) => captureMessage(msg, level),
  captureException: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  init: jest.fn(),
  browserTracingIntegration: jest.fn(() => ({ name: 'BrowserTracing' })),
  replayIntegration: jest.fn((opts: unknown) => ({ name: 'Replay', opts })),
}));

import {
  aggregateCallQualityMetrics,
  computePercentile,
  extractWebRtcStatsSample,
  type WebRtcStatsSample,
} from '@/lib/video';
import {
  DROPPED_FRAMES_ALERT_THRESHOLD_PERCENT,
  reportCallQualityTelemetry,
} from '@/lib/sentry';

describe('WebRTC call quality metrics and Sentry reporter (#272)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('computes p95 percentiles accurately', () => {
    expect(computePercentile([], 95)).toBe(0);
    const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 10); // 10..200
    expect(computePercentile(values, 95)).toBe(190);
    expect(computePercentile(values, 50)).toBe(100);
  });

  it('extracts jitter, RTT, packet loss, and frame stats from RTCStatsReport', () => {
    const mockReport = [
      {
        type: 'inbound-rtp',
        kind: 'video',
        timestamp: 1700000000000,
        jitter: 0.025, // 25ms
        packetsReceived: 950,
        packetsLost: 50,
        framesDecoded: 800,
        framesDropped: 200,
      },
      {
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        currentRoundTripTime: 0.085, // 85ms
      },
    ];

    const sample = extractWebRtcStatsSample(mockReport);
    expect(sample).toEqual({
      timestamp: 1700000000000,
      jitterMs: 25,
      rttMs: 85,
      packetsReceived: 950,
      packetsLost: 50,
      framesDecoded: 800,
      framesDropped: 200,
    });
  });

  it('aggregates p95 jitter, p95 RTT, avg RTT, packet loss %, and dropped frames %', () => {
    const samples: WebRtcStatsSample[] = [
      { timestamp: 1, jitterMs: 10, rttMs: 40, packetsReceived: 100, packetsLost: 0, framesDecoded: 100, framesDropped: 0 },
      { timestamp: 2, jitterMs: 20, rttMs: 60, packetsReceived: 200, packetsLost: 5, framesDecoded: 200, framesDropped: 10 },
      { timestamp: 3, jitterMs: 50, rttMs: 120, packetsReceived: 380, packetsLost: 20, framesDecoded: 300, framesDropped: 100 },
    ];

    const metrics = aggregateCallQualityMetrics(samples, 'medium');
    expect(metrics.p95JitterMs).toBe(50);
    expect(metrics.p95RttMs).toBe(120);
    expect(metrics.avgRttMs).toBe(73.33);
    expect(metrics.packetLossPercent).toBe(5); // 20 / 400
    expect(metrics.droppedFramesPercent).toBe(25); // 100 / 400
    expect(metrics.sampleCount).toBe(3);
    expect(metrics.qualityTier).toBe('medium');
  });

  it('sends anonymous quality transaction to Sentry without alert when dropped frames <= 20%', () => {
    const result = reportCallQualityTelemetry({
      p95JitterMs: 18,
      p95RttMs: 75,
      avgRttMs: 55,
      packetLossPercent: 1.5,
      droppedFramesPercent: DROPPED_FRAMES_ALERT_THRESHOLD_PERCENT,
      sampleCount: 10,
      qualityTier: 'high',
    });

    expect(result.alertTriggered).toBe(false);
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'telemedicine.call_quality',
        op: 'webrtc.quality',
      }),
    );
    expect(setAttribute).toHaveBeenCalledWith('webrtc.jitter_p95_ms', 18);
    expect(setAttribute).toHaveBeenCalledWith('webrtc.rtt_p95_ms', 75);
    expect(setAttribute).toHaveBeenCalledWith('webrtc.packet_loss_pct', 1.5);
    expect(setAttribute).toHaveBeenCalledWith('webrtc.dropped_frames_pct', 20);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('triggers Sentry warning alert when dropped frames > 20%', () => {
    const result = reportCallQualityTelemetry({
      p95JitterMs: 42,
      p95RttMs: 180,
      avgRttMs: 140,
      packetLossPercent: 8.2,
      droppedFramesPercent: 24.5,
      sampleCount: 12,
    });

    expect(result.alertTriggered).toBe(true);
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'webrtc.quality',
        level: 'warning',
      }),
    );
    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('24.5% exceeds 20% threshold'),
      'warning',
    );
  });
});
