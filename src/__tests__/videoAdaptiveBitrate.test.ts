jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  startSpan: (_o: unknown, cb: (s: unknown) => unknown) => cb({ setAttribute: jest.fn() }),
  setUser: jest.fn(),
  setTag: jest.fn(),
  init: jest.fn(),
}));

import {
  ABR_POLL_INTERVAL_MS,
  ABR_STABLE_POLLS_TO_STEP_UP,
  applyResolutionToSender,
  classifyConnectionQuality,
  computeIntervalPacketLoss,
  computeScaleDownFactor,
  nextAdaptiveResolution,
  readRtpCounters,
  startAdaptiveBitrate,
  type AdaptiveResolution,
  type RtpCounters,
} from '@/lib/video';

function counters(partial: Partial<RtpCounters>): RtpCounters {
  return {
    timestamp: 0,
    packetsSent: 0,
    remotePacketsLost: 0,
    packetsReceived: 0,
    packetsLost: 0,
    availableOutgoingKbps: null,
    rttMs: null,
    ...partial,
  };
}

/** Builds a getStats() report: cumulative send/receive counters. */
function statsReport(opts: { sent: number; remoteLost: number; received?: number; lost?: number; ts: number }) {
  const entries: Record<string, unknown>[] = [
    { type: 'outbound-rtp', kind: 'video', packetsSent: opts.sent, timestamp: opts.ts },
    { type: 'remote-inbound-rtp', kind: 'video', packetsLost: opts.remoteLost, roundTripTime: 0.08, timestamp: opts.ts },
    { type: 'inbound-rtp', kind: 'video', packetsReceived: opts.received ?? 0, packetsLost: opts.lost ?? 0, timestamp: opts.ts },
    { type: 'candidate-pair', nominated: true, availableOutgoingBitrate: 1_500_000, currentRoundTripTime: 0.05, timestamp: opts.ts },
  ];
  const map = new Map(entries.map((e, i) => [String(i), e]));
  return { forEach: (cb: (v: unknown) => void) => map.forEach((v) => cb(v)) } as unknown as RTCStatsReport;
}

describe('readRtpCounters (#254)', () => {
  it('sums send/receive counters and reads the bandwidth estimate', () => {
    const c = readRtpCounters([
      { type: 'outbound-rtp', kind: 'audio', packetsSent: 100, timestamp: 1 },
      { type: 'outbound-rtp', kind: 'video', packetsSent: 900, timestamp: 2 },
      { type: 'remote-inbound-rtp', packetsLost: 30, roundTripTime: 0.1 },
      { type: 'inbound-rtp', packetsReceived: 500, packetsLost: 5 },
      { type: 'candidate-pair', nominated: true, availableOutgoingBitrate: 800_000, currentRoundTripTime: 0.04 },
    ]);
    expect(c.packetsSent).toBe(1000);
    expect(c.remotePacketsLost).toBe(30);
    expect(c.packetsReceived).toBe(500);
    expect(c.packetsLost).toBe(5);
    expect(c.availableOutgoingKbps).toBe(800);
    expect(c.rttMs).toBeCloseTo(40);
    expect(c.timestamp).toBe(2);
  });

  it('ignores negative packetsLost (duplicates) and non-numeric fields', () => {
    const c = readRtpCounters([{ type: 'inbound-rtp', packetsReceived: 'x', packetsLost: -4 }]);
    expect(c.packetsReceived).toBe(0);
    expect(c.packetsLost).toBe(0);
  });
});

describe('computeIntervalPacketLoss (#254)', () => {
  it('uses deltas, not cumulative totals', () => {
    // 50 lost early in the call, then a clean interval.
    const prev = counters({ packetsSent: 1000, remotePacketsLost: 50 });
    const curr = counters({ packetsSent: 2000, remotePacketsLost: 50 });
    expect(computeIntervalPacketLoss(prev, curr)).toBe(0);
  });

  it('returns the worse of send and receive direction', () => {
    const prev = counters({});
    const curr = counters({ packetsSent: 100, remotePacketsLost: 2, packetsReceived: 90, packetsLost: 10 });
    expect(computeIntervalPacketLoss(prev, curr)).toBeCloseTo(10);
  });

  it('is 0 with no traffic', () => {
    expect(computeIntervalPacketLoss(counters({}), counters({}))).toBe(0);
  });
});

describe('nextAdaptiveResolution (#254)', () => {
  it('steps down 1080p → 720p → 480p → audio-only when loss > 5%', () => {
    let r: AdaptiveResolution = '1080p';
    const seen: AdaptiveResolution[] = [];
    for (let i = 0; i < 4; i++) {
      r = nextAdaptiveResolution(r, 7.5, 0).resolution;
      seen.push(r);
    }
    expect(seen).toEqual(['720p', '480p', 'audio-only', 'audio-only']);
  });

  it('does not step down at exactly 5% loss', () => {
    expect(nextAdaptiveResolution('720p', 5, 0).resolution).toBe('720p');
  });

  it('steps up only after sustained healthy polls (hysteresis)', () => {
    let state = { resolution: 'audio-only' as AdaptiveResolution, stablePolls: 0 };
    for (let i = 0; i < ABR_STABLE_POLLS_TO_STEP_UP - 1; i++) {
      state = nextAdaptiveResolution(state.resolution, 0.5, state.stablePolls);
      expect(state.resolution).toBe('audio-only');
    }
    state = nextAdaptiveResolution(state.resolution, 0.5, state.stablePolls);
    expect(state).toEqual({ resolution: '480p', stablePolls: 0 });
  });

  it('resets the streak on moderate loss and never exceeds the ceiling', () => {
    expect(nextAdaptiveResolution('480p', 3, 4)).toEqual({ resolution: '480p', stablePolls: 0 });
    expect(nextAdaptiveResolution('720p', 0, 10, '720p').resolution).toBe('720p');
  });
});

describe('classifyConnectionQuality (#254)', () => {
  it.each([
    [null, null, 'unknown'],
    [0.2, 40, 'excellent'],
    [2, 100, 'good'],
    [6, 100, 'fair'],
    [1, 400, 'fair'],
    [12, 100, 'poor'],
    [0, 700, 'poor'],
  ] as const)('loss=%s rtt=%s → %s', (loss, rtt, expected) => {
    expect(classifyConnectionQuality(loss, rtt)).toBe(expected);
  });
});

describe('applyResolutionToSender (#254)', () => {
  function mockSender(height = 1080) {
    const params: RTCRtpSendParameters = { encodings: [{}] } as unknown as RTCRtpSendParameters;
    return {
      track: { kind: 'video', getSettings: () => ({ height }) },
      getParameters: jest.fn(() => params),
      setParameters: jest.fn(async () => undefined),
      params,
    };
  }

  it('scales resolution and caps bitrate without renegotiation', async () => {
    const s = mockSender(1080);
    await applyResolutionToSender(s as unknown as RTCRtpSender, '480p');
    const enc = s.params.encodings[0]!;
    expect(enc.active).toBe(true);
    expect(enc.scaleResolutionDownBy).toBeCloseTo(2.25);
    expect(enc.maxBitrate).toBe(600_000);
    expect(s.setParameters).toHaveBeenCalledTimes(1);
  });

  it('disables the video encoding for audio-only', async () => {
    const s = mockSender();
    await applyResolutionToSender(s as unknown as RTCRtpSender, 'audio-only');
    expect(s.params.encodings[0]!.active).toBe(false);
  });

  it('skips audio senders', async () => {
    const s = { ...mockSender(), track: { kind: 'audio' } };
    await applyResolutionToSender(s as unknown as RTCRtpSender, '480p');
    expect(s.setParameters).not.toHaveBeenCalled();
  });

  it('never upscales', () => {
    expect(computeScaleDownFactor(480, 1080)).toBe(1);
    expect(computeScaleDownFactor(720, 0)).toBe(1);
  });
});

describe('startAdaptiveBitrate (#254)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('polls getStats every 2s and steps down on packet loss', async () => {
    const reports = [
      statsReport({ sent: 0, remoteLost: 0, ts: 0 }),
      statsReport({ sent: 1000, remoteLost: 100, ts: 2000 }), // 10% loss
      statsReport({ sent: 2000, remoteLost: 180, ts: 4000 }), // 8% loss
    ];
    let call = 0;
    const sender = {
      track: { kind: 'video', getSettings: () => ({ height: 1080 }) },
      getParameters: () => ({ encodings: [{}] }),
      setParameters: jest.fn(async () => undefined),
    };
    const pc = {
      getStats: jest.fn(async () => reports[Math.min(call++, reports.length - 1)]),
      getSenders: () => [sender],
    } as unknown as RTCPeerConnection;

    const changes: AdaptiveResolution[] = [];
    const onSample = jest.fn();
    const ctrl = startAdaptiveBitrate(pc, {
      initialResolution: '1080p',
      onResolutionChange: (r) => changes.push(r),
      onSample,
    });

    await jest.advanceTimersByTimeAsync(0);
    expect(pc.getStats).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(ABR_POLL_INTERVAL_MS);
    expect(pc.getStats).toHaveBeenCalledTimes(2);
    expect(changes).toEqual(['720p']);

    await jest.advanceTimersByTimeAsync(ABR_POLL_INTERVAL_MS);
    expect(changes).toEqual(['720p', '480p']);
    expect(ctrl.getResolution()).toBe('480p');

    const lastSample = onSample.mock.calls.at(-1)![0];
    expect(lastSample.packetLossPercent).toBeCloseTo(8);
    expect(lastSample.availableOutgoingKbps).toBe(1500);
    expect(lastSample.quality).toBe('fair');
    expect(sender.setParameters).toHaveBeenCalled();

    ctrl.stop();
    await jest.advanceTimersByTimeAsync(ABR_POLL_INTERVAL_MS * 3);
    expect(pc.getStats).toHaveBeenCalledTimes(3);
  });

  it('tolerates getStats failures while the connection closes', async () => {
    const pc = {
      getStats: jest.fn(async () => {
        throw new Error('closed');
      }),
      getSenders: () => [],
    } as unknown as RTCPeerConnection;
    const ctrl = startAdaptiveBitrate(pc);
    await expect(ctrl.poll()).resolves.toBeNull();
    ctrl.stop();
  });
});
