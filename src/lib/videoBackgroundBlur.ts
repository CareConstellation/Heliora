/**
 * Background blur and virtual clinical backdrops for telemedicine video (#255).
 *
 * ## Pipeline
 * ```
 * camera MediaStream ─▶ <video> ─▶ MediaPipe selfie segmenter (GPU / WebGL delegate)
 *                                     │ confidence mask (person = 1)
 *                                     ▼
 *          background layer (blurred frame | clinical backdrop)
 *        + person layer (frame ∩ feathered mask, `destination-in`)
 *                                     ▼
 *                  output <canvas> ─▶ canvas.captureStream(fps) ─▶ video track
 * ```
 * Segmentation runs on MediaPipe's GPU delegate (WebGL2) with a CPU fallback.
 * Compositing uses Canvas 2D `filter: blur()` and compositing modes, which the
 * browser executes on the GPU, so no per-pixel JavaScript runs per frame.
 *
 * ## Frame budget (≥ 24 fps)
 * At 24 fps each frame has ~41.7 ms. The processor measures segmentation time
 * and, when it eats more than 80% of the budget, segments only every 2nd or 3rd
 * frame and reuses the last mask in between (people move little in 40–80 ms).
 * Compositing still runs every frame, so output frame rate is preserved.
 *
 * ## Privacy
 * Frames never leave the device: the model and WASM runtime are self-hosted
 * (see `DEFAULT_MEDIAPIPE_WASM_BASE`) and inference runs in the browser.
 * If segmentation cannot load, the processor reports `unavailable` and passes
 * the camera through untouched; the UI must tell the user their background is
 * visible rather than silently failing.
 */

/* ── Settings ────────────────────────────────────────────────────── */

export type BackgroundMode = 'none' | 'blur' | 'backdrop';
export type BlurIntensity = 'light' | 'strong';
export type ClinicalBackdropId = 'clinic-neutral' | 'consult-room' | 'calm-blue';

export interface BackgroundEffectSettings {
  mode: BackgroundMode;
  blurIntensity: BlurIntensity;
  backdrop: ClinicalBackdropId;
}

export const DEFAULT_BACKGROUND_SETTINGS: BackgroundEffectSettings = {
  mode: 'none',
  blurIntensity: 'light',
  backdrop: 'clinic-neutral',
};

/** Canvas blur radius in CSS pixels per intensity. */
export const BLUR_RADIUS_PX: Record<BlurIntensity, number> = {
  light: 6,
  strong: 16,
};

export interface ClinicalBackdrop {
  id: ClinicalBackdropId;
  label: string;
  description: string;
  /** Gradient stops, top to bottom. */
  stops: [string, string];
}

export const CLINICAL_BACKDROPS: readonly ClinicalBackdrop[] = [
  {
    id: 'clinic-neutral',
    label: 'Clinic neutral',
    description: 'Soft warm-grey wall, minimal distraction.',
    stops: ['#e9e6e1', '#cfcac3'],
  },
  {
    id: 'consult-room',
    label: 'Consult room',
    description: 'Muted sage tone used in Heliora clinics.',
    stops: ['#dfe9e2', '#a9c2b2'],
  },
  {
    id: 'calm-blue',
    label: 'Calm blue',
    description: 'Cool clinical blue with gentle vignette.',
    stops: ['#dbe7f3', '#9fb8d3'],
  },
] as const;

export const MIN_TARGET_FPS = 24;
export const DEFAULT_TARGET_FPS = 30;
export const MAX_SEGMENTATION_STRIDE = 3;

/* ── Segmenter abstraction ───────────────────────────────────────── */

/** Person-probability mask, row-major, values in [0, 1]. */
export interface SegmentationMask {
  width: number;
  height: number;
  data: Float32Array;
}

export interface SelfieSegmenter {
  segment(frame: HTMLVideoElement, timestampMs: number): SegmentationMask | null;
  close(): void;
}

/**
 * Self-hosted by default so frames, model and runtime never touch a third
 * party, and so the strict `connect-src 'self'` CSP holds. Run
 * `npm run mediapipe:assets` to populate `public/mediapipe/`.
 */
export const DEFAULT_MEDIAPIPE_WASM_BASE =
  process.env.NEXT_PUBLIC_MEDIAPIPE_WASM_BASE || '/mediapipe/wasm';
export const DEFAULT_SELFIE_MODEL_PATH =
  process.env.NEXT_PUBLIC_MEDIAPIPE_SELFIE_MODEL || '/mediapipe/selfie_segmenter.tflite';

export interface MediaPipeSegmenterOptions {
  wasmBaseUrl?: string;
  modelAssetPath?: string;
}

/**
 * Loads MediaPipe's Tasks Vision `ImageSegmenter` with the selfie model in
 * VIDEO mode. Tries the GPU (WebGL2) delegate first, then CPU.
 * The library is code-split so it only downloads when a user enables an effect.
 */
export async function loadMediaPipeSegmenter(
  options: MediaPipeSegmenterOptions = {},
): Promise<SelfieSegmenter> {
  const { FilesetResolver, ImageSegmenter } = await import(
    /* webpackChunkName: "mediapipe-vision" */ '@mediapipe/tasks-vision'
  );
  const fileset = await FilesetResolver.forVisionTasks(
    options.wasmBaseUrl ?? DEFAULT_MEDIAPIPE_WASM_BASE,
  );

  const create = (delegate: 'GPU' | 'CPU') =>
    ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: options.modelAssetPath ?? DEFAULT_SELFIE_MODEL_PATH,
        delegate,
      },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });

  let segmenter: Awaited<ReturnType<typeof create>>;
  try {
    segmenter = await create('GPU');
  } catch {
    segmenter = await create('CPU');
  }

  return {
    segment(frame, timestampMs) {
      let mask: SegmentationMask | null = null;
      segmenter.segmentForVideo(frame, timestampMs, (result) => {
        const confidence = result.confidenceMasks?.[0];
        if (confidence) {
          // Copy: MediaPipe frees the mask's memory when the callback returns.
          mask = {
            width: confidence.width,
            height: confidence.height,
            data: new Float32Array(confidence.getAsFloat32Array()),
          };
        }
      });
      return mask;
    },
    close() {
      segmenter.close();
    },
  };
}

/* ── Pure helpers (unit-tested) ──────────────────────────────────── */

/** Hermite smoothstep: maps [edge0, edge1] → [0, 1] with soft shoulders. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Writes a confidence mask into RGBA pixels (white, alpha = person
 * probability). The smoothstep narrows the uncertain band around the
 * silhouette so hair and shoulders keep a soft but stable edge.
 *
 * Time: O(w·h). Space: O(1) beyond the output buffer.
 */
export function writeMaskToPixels(mask: SegmentationMask, out: Uint8ClampedArray): void {
  const n = mask.width * mask.height;
  if (out.length < n * 4) {
    throw new Error('Output buffer too small for mask.');
  }
  for (let i = 0; i < n; i++) {
    const alpha = smoothstep(0.3, 0.7, mask.data[i] ?? 0);
    const o = i * 4;
    out[o] = 255;
    out[o + 1] = 255;
    out[o + 2] = 255;
    out[o + 3] = Math.round(alpha * 255);
  }
}

/**
 * Chooses how many frames share one segmentation result so that segmentation
 * fits the per-frame budget for `targetFps`.
 *
 * Time: O(1).
 */
export function computeSegmentationStride(
  avgSegmentationMs: number,
  targetFps: number,
  currentStride: number,
  maxStride = MAX_SEGMENTATION_STRIDE,
): number {
  const budgetMs = 1000 / Math.max(MIN_TARGET_FPS, targetFps);
  const perFrameCost = avgSegmentationMs / currentStride;
  if (perFrameCost > budgetMs * 0.8 && currentStride < maxStride) return currentStride + 1;
  if (currentStride > 1 && avgSegmentationMs / (currentStride - 1) < budgetMs * 0.4) {
    return currentStride - 1;
  }
  return currentStride;
}

/** Rolling one-second frame-rate meter. */
export class FrameRateMeter {
  private stamps: number[] = [];

  constructor(private readonly windowMs = 1000) {}

  tick(nowMs: number): void {
    this.stamps.push(nowMs);
    const cutoff = nowMs - this.windowMs;
    while (this.stamps.length > 0 && this.stamps[0]! < cutoff) this.stamps.shift();
  }

  fps(): number {
    if (this.stamps.length < 2) return 0;
    const span = this.stamps[this.stamps.length - 1]! - this.stamps[0]!;
    return span > 0 ? ((this.stamps.length - 1) * 1000) / span : 0;
  }
}

/** Paints a procedural clinical backdrop (no image assets to fetch or leak). */
export function drawClinicalBackdrop(
  ctx: CanvasRenderingContext2D,
  id: ClinicalBackdropId,
  width: number,
  height: number,
): void {
  const backdrop = CLINICAL_BACKDROPS.find((b) => b.id === id) ?? CLINICAL_BACKDROPS[0]!;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, backdrop.stops[0]);
  gradient.addColorStop(1, backdrop.stops[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.3,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

/* ── Processor ───────────────────────────────────────────────────── */

export type BackgroundEffectStatus = 'idle' | 'loading' | 'active' | 'unavailable';

export interface BackgroundEffectStats {
  fps: number;
  avgSegmentationMs: number;
  segmentationStride: number;
  status: BackgroundEffectStatus;
}

export interface BackgroundEffectProcessorOptions {
  targetFps?: number;
  /** Injectable for tests or alternative models; defaults to MediaPipe. */
  loadSegmenter?: () => Promise<SelfieSegmenter>;
  onStatusChange?: (status: BackgroundEffectStatus, error?: Error) => void;
  /** Document used to create media elements (tests). */
  doc?: Document;
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { alpha: true }) as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas 2D context is not available.');
  return ctx;
}

export class BackgroundEffectProcessor {
  private readonly targetFps: number;
  private readonly doc: Document;
  private readonly loadSegmenter: () => Promise<SelfieSegmenter>;
  private readonly onStatusChange?: BackgroundEffectProcessorOptions['onStatusChange'];

  private settings: BackgroundEffectSettings = { ...DEFAULT_BACKGROUND_SETTINGS };
  private status: BackgroundEffectStatus = 'idle';
  private segmenter: SelfieSegmenter | null = null;
  private segmenterPromise: Promise<SelfieSegmenter | null> | null = null;

  private video: VideoWithFrameCallback | null = null;
  private output: HTMLCanvasElement | null = null;
  private person: HTMLCanvasElement | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;
  private backdropCanvas: HTMLCanvasElement | null = null;
  private backdropKey = '';
  private maskImage: ImageData | null = null;
  private hasMask = false;

  private outputStream: MediaStream | null = null;
  private frameHandle: number | null = null;
  private usingVideoFrameCallback = false;
  private running = false;

  private frameIndex = 0;
  private stride = 1;
  private segTimes: number[] = [];
  private readonly meter = new FrameRateMeter();

  constructor(options: BackgroundEffectProcessorOptions = {}) {
    this.targetFps = Math.max(MIN_TARGET_FPS, options.targetFps ?? DEFAULT_TARGET_FPS);
    this.doc = options.doc ?? document;
    this.loadSegmenter = options.loadSegmenter ?? (() => loadMediaPipeSegmenter());
    this.onStatusChange = options.onStatusChange;
  }

  static isSupported(): boolean {
    if (typeof window === 'undefined' || typeof HTMLCanvasElement === 'undefined') return false;
    return typeof (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream === 'function';
  }

  /**
   * Starts processing `input` and returns the processed stream: one canvas
   * video track at the target frame rate plus the input's audio tracks.
   */
  async start(input: MediaStream): Promise<MediaStream> {
    this.stop();
    const sourceTrack = input.getVideoTracks()[0];
    const settings = sourceTrack?.getSettings?.() ?? {};
    const width = settings.width || 1280;
    const height = settings.height || 720;

    const video = this.doc.createElement('video') as VideoWithFrameCallback;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = input;
    this.video = video;

    this.output = this.makeCanvas(width, height);
    this.person = this.makeCanvas(width, height);

    const capture = (this.output as HTMLCanvasElement & {
      captureStream?: (fps?: number) => MediaStream;
    }).captureStream;
    if (typeof capture !== 'function') {
      throw new Error('canvas.captureStream() is not supported in this browser.');
    }
    const canvasStream = capture.call(this.output, this.targetFps);
    this.outputStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...input.getAudioTracks(),
    ]);

    this.running = true;
    try {
      await video.play();
    } catch {
      // Autoplay of a muted element is permitted; ignore rare policy rejections.
    }
    if (this.settings.mode !== 'none') void this.ensureSegmenter();
    this.scheduleFrame();
    return this.outputStream;
  }

  setSettings(next: Partial<BackgroundEffectSettings>): void {
    this.settings = { ...this.settings, ...next };
    if (this.settings.mode !== 'none' && this.running) void this.ensureSegmenter();
  }

  getSettings(): BackgroundEffectSettings {
    return { ...this.settings };
  }

  getStats(): BackgroundEffectStats {
    return {
      fps: Math.round(this.meter.fps() * 10) / 10,
      avgSegmentationMs: this.avgSegmentationMs(),
      segmentationStride: this.stride,
      status: this.status,
    };
  }

  getOutputStream(): MediaStream | null {
    return this.outputStream;
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle !== null) {
      if (this.usingVideoFrameCallback && this.video?.cancelVideoFrameCallback) {
        this.video.cancelVideoFrameCallback(this.frameHandle);
      } else if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.frameHandle);
      }
      this.frameHandle = null;
    }
    this.outputStream?.getVideoTracks().forEach((t) => t.stop());
    this.outputStream = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
  }

  destroy(): void {
    this.stop();
    this.segmenter?.close();
    this.segmenter = null;
    this.segmenterPromise = null;
  }

  /** Renders one frame. Public so tests can drive the loop deterministically. */
  renderFrame(nowMs: number = performance.now()): void {
    const video = this.video;
    const output = this.output;
    if (!video || !output || !this.person) return;
    if (video.readyState < 2 /* HAVE_CURRENT_DATA */) return;

    const w = output.width;
    const h = output.height;
    const ctx = get2d(output);

    const effectActive = this.settings.mode !== 'none' && this.segmenter !== null;
    if (!effectActive) {
      ctx.drawImage(video, 0, 0, w, h);
      this.meter.tick(nowMs);
      return;
    }

    if (this.frameIndex % this.stride === 0 || !this.hasMask) {
      this.updateMask(video, nowMs);
    }
    this.frameIndex++;

    // Background layer
    ctx.save();
    if (this.settings.mode === 'blur') {
      ctx.filter = `blur(${BLUR_RADIUS_PX[this.settings.blurIntensity]}px)`;
      ctx.drawImage(video, 0, 0, w, h);
    } else {
      ctx.drawImage(this.getBackdrop(w, h), 0, 0);
    }
    ctx.restore();

    // Person layer: frame ∩ feathered mask
    if (this.hasMask && this.maskCanvas) {
      const pctx = get2d(this.person);
      pctx.save();
      pctx.clearRect(0, 0, w, h);
      pctx.drawImage(video, 0, 0, w, h);
      pctx.globalCompositeOperation = 'destination-in';
      pctx.filter = 'blur(2px)';
      pctx.drawImage(this.maskCanvas, 0, 0, w, h);
      pctx.restore();
      ctx.drawImage(this.person, 0, 0);
    }

    this.meter.tick(nowMs);
  }

  /* ── internals ──────────────────────────────────────────────── */

  private makeCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = this.doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  private setStatus(status: BackgroundEffectStatus, error?: Error): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatusChange?.(status, error);
  }

  private ensureSegmenter(): Promise<SelfieSegmenter | null> {
    if (this.segmenter) return Promise.resolve(this.segmenter);
    if (this.segmenterPromise) return this.segmenterPromise;
    this.setStatus('loading');
    this.segmenterPromise = this.loadSegmenter()
      .then((s) => {
        this.segmenter = s;
        this.setStatus('active');
        return s;
      })
      .catch((err: unknown) => {
        this.setStatus('unavailable', err instanceof Error ? err : new Error(String(err)));
        return null;
      });
    return this.segmenterPromise;
  }

  private updateMask(video: HTMLVideoElement, nowMs: number): void {
    if (!this.segmenter) return;
    const t0 = performance.now();
    const mask = this.segmenter.segment(video, nowMs);
    this.recordSegmentationTime(performance.now() - t0);
    if (!mask) return;

    if (!this.maskCanvas || this.maskCanvas.width !== mask.width || this.maskCanvas.height !== mask.height) {
      this.maskCanvas = this.makeCanvas(mask.width, mask.height);
      this.maskImage = null;
    }
    const mctx = get2d(this.maskCanvas);
    this.maskImage ??= mctx.createImageData(mask.width, mask.height);
    writeMaskToPixels(mask, this.maskImage.data);
    mctx.putImageData(this.maskImage, 0, 0);
    this.hasMask = true;
  }

  private recordSegmentationTime(ms: number): void {
    this.segTimes.push(ms);
    if (this.segTimes.length > 30) this.segTimes.shift();
    if (this.segTimes.length >= 10) {
      this.stride = computeSegmentationStride(this.avgSegmentationMs(), this.targetFps, this.stride);
    }
  }

  private avgSegmentationMs(): number {
    if (this.segTimes.length === 0) return 0;
    const avg = this.segTimes.reduce((a, b) => a + b, 0) / this.segTimes.length;
    return Math.round(avg * 100) / 100;
  }

  private getBackdrop(width: number, height: number): HTMLCanvasElement {
    const key = `${this.settings.backdrop}:${width}x${height}`;
    if (!this.backdropCanvas || this.backdropKey !== key) {
      this.backdropCanvas = this.makeCanvas(width, height);
      drawClinicalBackdrop(get2d(this.backdropCanvas), this.settings.backdrop, width, height);
      this.backdropKey = key;
    }
    return this.backdropCanvas;
  }

  private scheduleFrame(): void {
    if (!this.running || !this.video) return;
    const step = () => {
      this.frameHandle = null;
      if (!this.running) return;
      try {
        this.renderFrame();
      } catch (err) {
        this.setStatus('unavailable', err instanceof Error ? err : new Error(String(err)));
      }
      this.scheduleFrame();
    };
    const video = this.video;
    if (typeof video.requestVideoFrameCallback === 'function') {
      // Fires once per decoded camera frame: no wasted work, no missed frames.
      this.usingVideoFrameCallback = true;
      this.frameHandle = video.requestVideoFrameCallback(step);
    } else if (typeof requestAnimationFrame === 'function') {
      this.usingVideoFrameCallback = false;
      this.frameHandle = requestAnimationFrame(step);
    }
  }
}
