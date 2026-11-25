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
  AUDIO_GRAPH_TOPOLOGY,
  DEFAULT_NOISE_GATE,
  ENHANCED_AUDIO_CONSTRAINTS,
  HIGH_PASS_CUTOFF_HZ,
  computeRmsDb,
  createNoiseCancellationPipeline,
  enforceAudioTrackConstraints,
  evaluateNoiseGate,
  getEnhancedAudioConstraints,
  getQualityConstraints,
} from '@/lib/video';

/* ── Minimal Web Audio / MediaStream fakes that record the graph ── */

class FakeMediaStream {
  private tracks: { kind: string; stop: jest.Mock }[];
  constructor(tracks: { kind: string; stop: jest.Mock }[] = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}

const track = (kind: string) => ({ kind, stop: jest.fn() });

class FakeParam {
  value = 0;
  setTargetAtTime = jest.fn((v: number) => {
    this.value = v;
  });
  cancelScheduledValues = jest.fn();
}

class FakeNode {
  outputs: FakeNode[] = [];
  constructor(public readonly label: string) {}
  connect(node: FakeNode) {
    this.outputs.push(node);
    return node;
  }
  disconnect = jest.fn(() => {
    this.outputs = [];
  });
}

class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  level = 0; // amplitude the analyser reports
  nodes: FakeNode[] = [];
  close = jest.fn(async () => {
    this.state = 'closed';
  });

  private make<T extends FakeNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
  createMediaStreamSource() {
    return this.make(new FakeNode('MediaStreamAudioSourceNode'));
  }
  createBiquadFilter() {
    return this.make(
      Object.assign(new FakeNode('BiquadFilterNode'), { type: 'lowpass', frequency: new FakeParam(), Q: new FakeParam() }),
    );
  }
  createAnalyser() {
    return this.make(
      Object.assign(new FakeNode('AnalyserNode'), {
        fftSize: 2048,
        smoothingTimeConstant: 0.8,
        getFloatTimeDomainData: (buf: Float32Array) => {
          buf.fill(this.level);
        },
      }),
    );
  }
  createGain() {
    return this.make(Object.assign(new FakeNode('GainNode'), { gain: new FakeParam() }));
  }
  createMediaStreamDestination() {
    return this.make(
      Object.assign(new FakeNode('MediaStreamAudioDestinationNode'), {
        stream: new FakeMediaStream([track('audio')]),
      }),
    );
  }
}

/** Walks the graph from the source, returning node labels in signal order. */
function walk(start: FakeNode): string[] {
  const order: string[] = [];
  let node: FakeNode | undefined = start;
  while (node) {
    const n = node as FakeNode & { type?: string };
    order.push(n.label === 'BiquadFilterNode' ? `BiquadFilterNode(${n.type})` : n.label);
    node = node.outputs[0];
  }
  return order;
}

beforeAll(() => {
  (globalThis as unknown as { MediaStream: unknown }).MediaStream = FakeMediaStream;
});

describe('echo cancellation & noise suppression constraints (#256)', () => {
  it('enforces AEC, NS and AGC', () => {
    expect(ENHANCED_AUDIO_CONSTRAINTS).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });

  it('cannot be overridden off by callers', () => {
    const c = getEnhancedAudioConstraints({ echoCancellation: false, deviceId: 'mic-2' });
    expect(c.echoCancellation).toBe(true);
    expect(c.noiseSuppression).toBe(true);
    expect(c.deviceId).toBe('mic-2');
  });

  it('is applied on every quality tier', () => {
    for (const tier of ['high', 'medium', 'low', 'audio-only'] as const) {
      expect(getQualityConstraints(tier).audio).toMatchObject({ echoCancellation: true, noiseSuppression: true });
    }
  });

  it('re-applies constraints to an existing track and reports the result', async () => {
    const t = {
      applyConstraints: jest.fn(async () => undefined),
      getSettings: () => ({ echoCancellation: true, noiseSuppression: true }),
    };
    await expect(enforceAudioTrackConstraints(t as unknown as MediaStreamTrack)).resolves.toBe(true);
    expect(t.applyConstraints).toHaveBeenCalledWith(expect.objectContaining({ echoCancellation: true }));
  });

  it('reports false when the browser cannot honour them', async () => {
    const t = {
      applyConstraints: jest.fn(async () => {
        throw new Error('OverconstrainedError');
      }),
      getSettings: () => ({ echoCancellation: false }),
    };
    await expect(enforceAudioTrackConstraints(t as unknown as MediaStreamTrack)).resolves.toBe(false);
  });
});

describe('noise gate (#256)', () => {
  it('computes RMS level in dBFS', () => {
    expect(computeRmsDb(new Float32Array(128).fill(1))).toBeCloseTo(0);
    expect(computeRmsDb(new Float32Array(128).fill(0.1))).toBeCloseTo(-20);
    expect(computeRmsDb(new Float32Array(128))).toBe(-100);
    expect(computeRmsDb(new Float32Array(0))).toBe(-100);
  });

  it('opens above the open threshold', () => {
    expect(evaluateNoiseGate({ open: false, lastActiveAt: 0 }, -30, 1000).open).toBe(true);
  });

  it('stays closed between thresholds when already closed (hysteresis)', () => {
    expect(evaluateNoiseGate({ open: false, lastActiveAt: 0 }, -53, 1000).open).toBe(false);
  });

  it('stays open between thresholds when already open', () => {
    expect(evaluateNoiseGate({ open: true, lastActiveAt: 0 }, -53, 1000)).toEqual({ open: true, lastActiveAt: 1000 });
  });

  it('holds open for holdMs after the level drops, then closes', () => {
    const open = { open: true, lastActiveAt: 1000 };
    expect(evaluateNoiseGate(open, -80, 1000 + DEFAULT_NOISE_GATE.holdMs - 1).open).toBe(true);
    expect(evaluateNoiseGate(open, -80, 1000 + DEFAULT_NOISE_GATE.holdMs).open).toBe(false);
  });
});

describe('createNoiseCancellationPipeline audio graph topology (#256)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function build() {
    const ctx = new FakeAudioContext();
    const video = track('video');
    const input = new FakeMediaStream([track('audio'), video]);
    const pipeline = createNoiseCancellationPipeline(input as unknown as MediaStream, {
      audioContext: ctx as unknown as AudioContext,
    });
    return { ctx, pipeline, video };
  }

  it('wires source → high-pass → analyser → gate → destination', () => {
    const { pipeline } = build();
    const order = walk(pipeline.nodes.source as unknown as FakeNode);
    expect(order).toEqual([
      'MediaStreamAudioSourceNode',
      'BiquadFilterNode(highpass)',
      'AnalyserNode',
      'GainNode',
      'MediaStreamAudioDestinationNode',
    ]);
    expect(order).toHaveLength(AUDIO_GRAPH_TOPOLOGY.length);
  });

  it('uses an 80 Hz Butterworth high-pass', () => {
    const { pipeline } = build();
    expect(pipeline.nodes.highPass.type).toBe('highpass');
    expect(pipeline.nodes.highPass.frequency.value).toBe(HIGH_PASS_CUTOFF_HZ);
    expect(HIGH_PASS_CUTOFF_HZ).toBe(80);
    expect(pipeline.nodes.highPass.Q.value).toBeCloseTo(Math.SQRT1_2);
  });

  it('outputs processed audio plus the original video tracks', () => {
    const { pipeline, video } = build();
    const out = pipeline.stream as unknown as FakeMediaStream;
    expect(out.getAudioTracks()).toEqual(
      (pipeline.nodes.destination.stream as unknown as FakeMediaStream).getAudioTracks(),
    );
    expect(out.getVideoTracks()).toEqual([video]);
  });

  it('gates: opens on speech, closes to the floor after hold on silence', () => {
    const { ctx, pipeline } = build();
    const gain = pipeline.nodes.gate.gain as unknown as FakeParam;
    expect(pipeline.isGateOpen()).toBe(false);

    ctx.level = 0.1; // -20 dBFS: speech
    jest.advanceTimersByTime(10);
    expect(pipeline.isGateOpen()).toBe(true);
    expect(gain.value).toBe(1);

    ctx.level = 0.0001; // -80 dBFS: room noise
    jest.advanceTimersByTime(DEFAULT_NOISE_GATE.holdMs + 20);
    expect(pipeline.isGateOpen()).toBe(false);
    expect(gain.value).toBe(DEFAULT_NOISE_GATE.floorGain);
  });

  it('bypass disables the filter and opens the gain fully', () => {
    const { pipeline } = build();
    pipeline.setEnabled(false);
    expect(pipeline.isEnabled()).toBe(false);
    expect(pipeline.nodes.highPass.frequency.value).toBe(0);
    expect((pipeline.nodes.gate.gain as unknown as FakeParam).value).toBe(1);
    pipeline.setEnabled(true);
    expect(pipeline.nodes.highPass.frequency.value).toBe(80);
  });

  it('close() tears down the graph and does not close an injected context', async () => {
    const { ctx, pipeline } = build();
    await pipeline.close();
    // Every node with outgoing edges is disconnected; the destination is a sink.
    for (const node of ctx.nodes.filter((n) => n.label !== 'MediaStreamAudioDestinationNode')) {
      expect(node.disconnect).toHaveBeenCalled();
    }
    const destTrack = (pipeline.nodes.destination.stream as unknown as FakeMediaStream).getAudioTracks()[0]!;
    expect(destTrack.stop).toHaveBeenCalled();
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it('throws a clear error when Web Audio is unavailable', () => {
    expect(() => createNoiseCancellationPipeline(new FakeMediaStream() as unknown as MediaStream)).toThrow(
      /Web Audio API is not available/,
    );
  });
});
