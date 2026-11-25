import {
  BLUR_RADIUS_PX,
  BackgroundEffectProcessor,
  CLINICAL_BACKDROPS,
  FrameRateMeter,
  MIN_TARGET_FPS,
  computeSegmentationStride,
  drawClinicalBackdrop,
  smoothstep,
  writeMaskToPixels,
  type SelfieSegmenter,
} from '@/lib/videoBackgroundBlur';

/* ── Fakes ─────────────────────────────────────────────────────── */

class FakeMediaStream {
  constructor(private readonly tracks: { kind: string; stop: jest.Mock }[] = []) {}
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

const track = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, stop: jest.fn(), ...extra });

interface CtxLog {
  filters: string[];
  composite: string[];
  drawn: unknown[];
}

function fakeContext(log: CtxLog) {
  const state = { filter: 'none', globalCompositeOperation: 'source-over', fillStyle: '' as unknown };
  return {
    get filter() {
      return state.filter;
    },
    set filter(v: string) {
      state.filter = v;
      log.filters.push(v);
    },
    get globalCompositeOperation() {
      return state.globalCompositeOperation;
    },
    set globalCompositeOperation(v: string) {
      state.globalCompositeOperation = v;
      log.composite.push(v);
    },
    fillStyle: '',
    save: jest.fn(),
    restore: jest.fn(() => {
      state.filter = 'none';
      state.globalCompositeOperation = 'source-over';
    }),
    drawImage: jest.fn((img: unknown) => log.drawn.push(img)),
    clearRect: jest.fn(),
    fillRect: jest.fn(),
    putImageData: jest.fn(),
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop: jest.fn() }),
    createRadialGradient: () => ({ addColorStop: jest.fn() }),
  };
}

let log: CtxLog;
let captureStream: jest.Mock;
const canvasTrack = track('video', { label: 'canvas' });

beforeAll(() => {
  (globalThis as unknown as { MediaStream: unknown }).MediaStream = FakeMediaStream;
});

beforeEach(() => {
  log = { filters: [], composite: [], drawn: [] };
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => fakeContext(log) as unknown as CanvasRenderingContext2D,
  );
  captureStream = jest.fn(() => new FakeMediaStream([canvasTrack]));
  (HTMLCanvasElement.prototype as unknown as { captureStream: unknown }).captureStream = captureStream;
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
  // jsdom rejects non-MediaStream srcObject values; store it plainly.
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get() {
      return (this as { _src?: unknown })._src ?? null;
    },
    set(v) {
      (this as { _src?: unknown })._src = v;
    },
  });
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function cameraStream() {
  return new FakeMediaStream([
    track('video', { getSettings: () => ({ width: 640, height: 360 }) }),
    track('audio'),
  ]) as unknown as MediaStream;
}

function fakeSegmenter(): SelfieSegmenter & { segment: jest.Mock; close: jest.Mock } {
  return {
    segment: jest.fn(() => ({ width: 2, height: 2, data: new Float32Array([0, 0.2, 0.8, 1]) })),
    close: jest.fn(),
  };
}

/* ── Pure helpers ─────────────────────────────────────────────── */

describe('mask helpers (#255)', () => {
  it('smoothstep clamps and eases', () => {
    expect(smoothstep(0.3, 0.7, 0)).toBe(0);
    expect(smoothstep(0.3, 0.7, 1)).toBe(1);
    expect(smoothstep(0.3, 0.7, 0.5)).toBeCloseTo(0.5);
  });

  it('writes person probability into the alpha channel', () => {
    const out = new Uint8ClampedArray(16);
    writeMaskToPixels({ width: 2, height: 2, data: new Float32Array([0, 0.2, 0.8, 1]) }, out);
    expect([out[3], out[7], out[11], out[15]]).toEqual([0, 0, 255, 255]);
    expect(out[0]).toBe(255);
  });

  it('rejects an undersized buffer', () => {
    expect(() => writeMaskToPixels({ width: 4, height: 4, data: new Float32Array(16) }, new Uint8ClampedArray(4))).toThrow();
  });
});

describe('frame budget (≥ 24 fps) (#255)', () => {
  it('increases the segmentation stride when segmentation exceeds the budget', () => {
    // 24 fps budget = 41.7 ms; 40 ms segmentation is > 80% of it.
    expect(computeSegmentationStride(40, 24, 1)).toBe(2);
    expect(computeSegmentationStride(80, 24, 2)).toBe(3);
    expect(computeSegmentationStride(200, 24, 3)).toBe(3); // capped
  });

  it('lowers the stride again when segmentation gets cheap', () => {
    expect(computeSegmentationStride(5, 30, 2)).toBe(1);
    expect(computeSegmentationStride(5, 30, 1)).toBe(1);
  });

  it('never budgets for less than 24 fps', () => {
    expect(computeSegmentationStride(30, 10, 1)).toBe(computeSegmentationStride(30, 24, 1));
  });

  it('FrameRateMeter measures a rolling fps', () => {
    const m = new FrameRateMeter();
    for (let i = 0; i <= 30; i++) m.tick(i * (1000 / 30));
    expect(m.fps()).toBeCloseTo(30, 0);
    expect(m.fps()).toBeGreaterThanOrEqual(MIN_TARGET_FPS);
  });
});

describe('clinical backdrops (#255)', () => {
  it('offers several procedural backdrops', () => {
    expect(CLINICAL_BACKDROPS.length).toBeGreaterThanOrEqual(3);
    const ctx = fakeContext(log);
    drawClinicalBackdrop(ctx as unknown as CanvasRenderingContext2D, 'calm-blue', 100, 50);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 50);
  });
});

/* ── Processor ───────────────────────────────────────────────── */

describe('BackgroundEffectProcessor canvas stream (#255)', () => {
  it('creates a canvas capture track at ≥ 24 fps and keeps audio', async () => {
    const p = new BackgroundEffectProcessor({ loadSegmenter: async () => fakeSegmenter() });
    const out = (await p.start(cameraStream())) as unknown as FakeMediaStream;

    expect(captureStream).toHaveBeenCalledTimes(1);
    expect(captureStream.mock.calls[0]![0]).toBeGreaterThanOrEqual(24);
    expect(out.getVideoTracks()).toEqual([canvasTrack]);
    expect(out.getAudioTracks()).toHaveLength(1);
    p.destroy();
    expect(canvasTrack.stop).toHaveBeenCalled();
  });

  it('clamps a requested target below 24 fps up to 24', async () => {
    const p = new BackgroundEffectProcessor({ targetFps: 15, loadSegmenter: async () => fakeSegmenter() });
    await p.start(cameraStream());
    expect(captureStream).toHaveBeenCalledWith(24);
    p.destroy();
  });

  it('throws when canvas capture is unsupported', async () => {
    delete (HTMLCanvasElement.prototype as unknown as { captureStream?: unknown }).captureStream;
    const p = new BackgroundEffectProcessor({ loadSegmenter: async () => fakeSegmenter() });
    await expect(p.start(cameraStream())).rejects.toThrow(/captureStream/);
  });

  it.each(['light', 'strong'] as const)('applies %s blur behind the segmented person', async (intensity) => {
    const seg = fakeSegmenter();
    const p = new BackgroundEffectProcessor({ loadSegmenter: async () => seg });
    p.setSettings({ mode: 'blur', blurIntensity: intensity });
    await p.start(cameraStream());
    await Promise.resolve();
    await Promise.resolve();

    p.renderFrame(1000);
    expect(seg.segment).toHaveBeenCalledTimes(1);
    expect(log.filters).toContain(`blur(${BLUR_RADIUS_PX[intensity]}px)`);
    expect(log.composite).toContain('destination-in');
    expect(p.getStats().status).toBe('active');
    p.destroy();
    expect(seg.close).toHaveBeenCalled();
  });

  it('light blur is weaker than strong blur', () => {
    expect(BLUR_RADIUS_PX.light).toBeLessThan(BLUR_RADIUS_PX.strong);
  });

  it('draws a clinical backdrop instead of the blurred frame', async () => {
    const p = new BackgroundEffectProcessor({ loadSegmenter: async () => fakeSegmenter() });
    p.setSettings({ mode: 'backdrop', backdrop: 'consult-room' });
    await p.start(cameraStream());
    await Promise.resolve();
    await Promise.resolve();
    p.renderFrame(1000);
    expect(log.filters.some((f) => f.startsWith('blur(6') || f.startsWith('blur(16'))).toBe(false);
    expect(log.drawn.some((d) => d instanceof HTMLCanvasElement)).toBe(true);
    p.destroy();
  });

  it('does not load the model while no effect is selected', async () => {
    const loader = jest.fn(async () => fakeSegmenter());
    const p = new BackgroundEffectProcessor({ loadSegmenter: loader });
    await p.start(cameraStream());
    p.renderFrame(1000);
    expect(loader).not.toHaveBeenCalled();
    p.setSettings({ mode: 'blur' });
    expect(loader).toHaveBeenCalledTimes(1);
    p.destroy();
  });

  it('reports unavailable and passes video through when the model fails to load', async () => {
    const onStatusChange = jest.fn();
    const p = new BackgroundEffectProcessor({
      loadSegmenter: async () => {
        throw new Error('wasm blocked');
      },
      onStatusChange,
    });
    p.setSettings({ mode: 'blur' });
    await p.start(cameraStream());
    await Promise.resolve();
    await Promise.resolve();
    expect(onStatusChange).toHaveBeenLastCalledWith('unavailable', expect.any(Error));

    p.renderFrame(1000);
    expect(log.filters).not.toContain(`blur(${BLUR_RADIUS_PX.light}px)`);
    expect(log.drawn).toHaveLength(1); // raw frame only
    p.destroy();
  });

  it('reuses the mask across frames when segmentation is slow', async () => {
    const seg = fakeSegmenter();
    let now = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    seg.segment.mockImplementation(() => {
      now += 45; // slower than the 41.7 ms budget at 24 fps
      return { width: 2, height: 2, data: new Float32Array(4).fill(1) };
    });
    const p = new BackgroundEffectProcessor({ targetFps: 24, loadSegmenter: async () => seg });
    p.setSettings({ mode: 'blur' });
    await p.start(cameraStream());
    await Promise.resolve();
    await Promise.resolve();

    for (let i = 0; i < 40; i++) p.renderFrame(i * 41);
    expect(p.getStats().segmentationStride).toBeGreaterThan(1);
    expect(seg.segment.mock.calls.length).toBeLessThan(40);
    p.destroy();
  });
});
