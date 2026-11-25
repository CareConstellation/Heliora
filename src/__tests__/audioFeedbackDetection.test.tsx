jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  startSpan: (_o: unknown, cb: (s: unknown) => unknown) => cb({ setAttribute: jest.fn() }),
  setUser: jest.fn(),
  setTag: jest.fn(),
  init: jest.fn(),
}));

import { fireEvent, render, screen } from '@testing-library/react';
import FeedbackNotice from '@/components/consultation/FeedbackNotice';
import {
  createFeedbackDetector,
  dbToGain,
  DEFAULT_FEEDBACK_DETECTION,
  detectFeedbackSpike,
  evaluateFeedbackState,
  FEEDBACK_DUCK_DB,
  FEEDBACK_DUCK_GAIN,
  INITIAL_FEEDBACK_STATE,
  type FeedbackSpike,
} from '@/lib/video';

const SAMPLE_RATE = 48_000;
const BINS = 1024; // fftSize 2048
const BIN_HZ = SAMPLE_RATE / 2 / BINS;

/** Pink-ish noise floor around -80 dBFS with deterministic jitter. */
function noiseFloor(): Float32Array {
  const s = new Float32Array(BINS);
  for (let i = 0; i < BINS; i++) s[i] = -80 - (i / BINS) * 10 + ((i * 7919) % 5);
  return s;
}

/** Speech-like frame: a broad harmonic series, each partial a few bins wide. */
function speechFrame(fundamentalHz = 140): Float32Array {
  const s = noiseFloor();
  for (let h = 1; h * fundamentalHz < 4000; h++) {
    const centre = Math.round((h * fundamentalHz) / BIN_HZ);
    for (let d = -3; d <= 3; d++) {
      const i = centre + d;
      if (i > 0 && i < BINS) s[i] = Math.max(s[i]!, -38 - h * 1.5 - Math.abs(d) * 2);
    }
  }
  return s;
}

/** Howling frame: one narrow, very loud tone. */
function howlFrame(frequencyHz: number, peakDb = -12): Float32Array {
  const s = noiseFloor();
  const centre = Math.round(frequencyHz / BIN_HZ);
  s[centre] = peakDb;
  s[centre - 1] = peakDb - 12;
  s[centre + 1] = peakDb - 12;
  return s;
}

describe('dB helpers (#269)', () => {
  it('ducks by 20 dB, i.e. a 0.1 linear gain', () => {
    expect(FEEDBACK_DUCK_DB).toBe(20);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 10);
    expect(FEEDBACK_DUCK_GAIN).toBeCloseTo(0.1, 10);
  });
});

describe('detectFeedbackSpike (#269)', () => {
  it('detects a narrowband howl and reports its frequency', () => {
    const spike = detectFeedbackSpike(howlFrame(2500), SAMPLE_RATE);
    expect(spike).not.toBeNull();
    expect(spike!.frequencyHz).toBeCloseTo(2500, -2);
    expect(spike!.prominenceDb).toBeGreaterThanOrEqual(DEFAULT_FEEDBACK_DETECTION.minProminenceDb);
  });

  it('ignores normal speech with spread harmonics', () => {
    expect(detectFeedbackSpike(speechFrame(), SAMPLE_RATE)).toBeNull();
    expect(detectFeedbackSpike(speechFrame(220), SAMPLE_RATE)).toBeNull();
  });

  it('still detects a howl while someone is talking over it', () => {
    const frame = speechFrame();
    const centre = Math.round(2800 / BIN_HZ);
    frame[centre] = -10;
    frame[centre - 1] = -24;
    frame[centre + 1] = -24;
    expect(detectFeedbackSpike(frame, SAMPLE_RATE)?.frequencyHz).toBeCloseTo(2800, -2);
  });

  it('ignores silence / room noise', () => {
    expect(detectFeedbackSpike(noiseFloor(), SAMPLE_RATE)).toBeNull();
  });

  it('ignores peaks that are too quiet to be feedback', () => {
    expect(detectFeedbackSpike(howlFrame(1500, -60), SAMPLE_RATE)).toBeNull();
  });

  it('ignores tones outside the 200 Hz–5 kHz band (e.g. mains hum)', () => {
    expect(detectFeedbackSpike(howlFrame(100), SAMPLE_RATE)).toBeNull();
    expect(detectFeedbackSpike(howlFrame(9000), SAMPLE_RATE)).toBeNull();
  });

  it('handles -Infinity bins from a silent analyser', () => {
    const s = new Float32Array(BINS).fill(-Infinity);
    expect(detectFeedbackSpike(s, SAMPLE_RATE)).toBeNull();
  });
});

describe('evaluateFeedbackState (#269)', () => {
  const spikeAt = (bin: number): FeedbackSpike => ({ bin, frequencyHz: bin * BIN_HZ, peakDb: -10, prominenceDb: 60 });

  it('ducks only after the same frequency persists for the sustain window', () => {
    let s = evaluateFeedbackState(INITIAL_FEEDBACK_STATE, spikeAt(100), 0);
    expect(s.ducked).toBe(false);
    s = evaluateFeedbackState(s, spikeAt(101), 150); // within tolerance
    expect(s.ducked).toBe(false);
    s = evaluateFeedbackState(s, spikeAt(100), DEFAULT_FEEDBACK_DETECTION.sustainMs);
    expect(s.ducked).toBe(true);
    expect(s.frequencyHz).toBeCloseTo(100 * BIN_HZ);
  });

  it('does not duck for a peak that keeps moving (whistling, singing)', () => {
    let s = INITIAL_FEEDBACK_STATE;
    for (let t = 0; t <= 1000; t += 50) {
      s = evaluateFeedbackState(s, spikeAt(100 + (t / 50) * 10), t);
      expect(s.ducked).toBe(false);
    }
  });

  it('does not duck for a short transient', () => {
    let s = evaluateFeedbackState(INITIAL_FEEDBACK_STATE, spikeAt(100), 0);
    s = evaluateFeedbackState(s, spikeAt(100), 100);
    s = evaluateFeedbackState(s, null, 150);
    s = evaluateFeedbackState(s, spikeAt(100), 400);
    expect(s.ducked).toBe(false);
  });

  it('stays ducked while howling continues and releases after the release window', () => {
    let s = evaluateFeedbackState(INITIAL_FEEDBACK_STATE, spikeAt(200), 0);
    s = evaluateFeedbackState(s, spikeAt(200), 400);
    expect(s.ducked).toBe(true);
    s = evaluateFeedbackState(s, spikeAt(200), 1000);
    s = evaluateFeedbackState(s, null, 1000 + DEFAULT_FEEDBACK_DETECTION.releaseMs - 1);
    expect(s.ducked).toBe(true);
    s = evaluateFeedbackState(s, null, 1000 + DEFAULT_FEEDBACK_DETECTION.releaseMs);
    expect(s.ducked).toBe(false);
  });
});

describe('createFeedbackDetector (#269)', () => {
  class FakeNode {
    connect = jest.fn();
    disconnect = jest.fn();
  }
  class FakeAnalyser extends FakeNode {
    fftSize = 2048;
    smoothingTimeConstant = 0;
    frame: Float32Array = noiseFloor();
    get frequencyBinCount() {
      return this.fftSize / 2;
    }
    getFloatFrequencyData(out: Float32Array) {
      out.set(this.frame);
    }
  }
  function fakeContext() {
    const analyser = new FakeAnalyser();
    const source = new FakeNode();
    const ctx = {
      sampleRate: SAMPLE_RATE,
      state: 'running',
      createMediaStreamSource: jest.fn(() => source),
      createAnalyser: jest.fn(() => analyser),
      close: jest.fn(),
    };
    return { ctx: ctx as unknown as AudioContext, analyser, source };
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('taps the mic with an analyser that is never routed to the output', () => {
    const { ctx, source, analyser } = fakeContext();
    const detector = createFeedbackDetector({} as MediaStream, { audioContext: ctx });
    expect(source.connect).toHaveBeenCalledWith(analyser);
    expect(analyser.connect).not.toHaveBeenCalled();
    void detector.stop();
  });

  it('ducks playback by 20 dB on sustained howling and restores afterwards', async () => {
    const { ctx, analyser } = fakeContext();
    let now = 0;
    const onChange = jest.fn();
    const detector = createFeedbackDetector({} as MediaStream, {
      audioContext: ctx,
      onChange,
      intervalMs: 50,
      now: () => now,
    });
    const advance = (ms: number) => {
      for (let i = 0; i < ms / 50; i++) {
        now += 50;
        jest.advanceTimersByTime(50);
      }
    };

    analyser.frame = speechFrame();
    advance(1000);
    expect(detector.getStatus()).toEqual({ ducked: false, frequencyHz: null, gain: 1 });

    analyser.frame = howlFrame(3150);
    advance(400);
    expect(onChange).toHaveBeenCalledTimes(1);
    const status = detector.getStatus();
    expect(status.ducked).toBe(true);
    expect(status.gain).toBeCloseTo(0.1);
    expect(status.frequencyHz).toBeCloseTo(3150, -2);

    analyser.frame = noiseFloor();
    advance(DEFAULT_FEEDBACK_DETECTION.releaseMs + 100);
    expect(detector.getStatus().ducked).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith({ ducked: false, frequencyHz: null, gain: 1 });

    await detector.stop();
    expect(analyser.disconnect).toHaveBeenCalled();
  });

  it('reset() restores volume immediately', () => {
    const { ctx, analyser } = fakeContext();
    let now = 0;
    const detector = createFeedbackDetector({} as MediaStream, { audioContext: ctx, now: () => now });
    analyser.frame = howlFrame(1000);
    for (let i = 0; i < 10; i++) {
      now += 50;
      jest.advanceTimersByTime(50);
    }
    expect(detector.getStatus().ducked).toBe(true);
    detector.reset();
    expect(detector.getStatus().gain).toBe(1);
    void detector.stop();
  });
});

describe('FeedbackNotice (#269)', () => {
  it('shows the muting notice and lets the user restore volume', () => {
    const onDismiss = jest.fn();
    render(<FeedbackNotice frequencyHz={2480.4} onDismiss={onDismiss} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/volume lowered by 20 dB/i);
    expect(alert).toHaveTextContent(/2480 Hz/);
    fireEvent.click(screen.getByRole('button', { name: /restore volume/i }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
