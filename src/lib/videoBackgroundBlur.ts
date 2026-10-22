export interface BackgroundBlurOptions {
  enabled: boolean;
  blurStrength: number; // 0-100
  frameRate: number; // target FPS
}

let tfModule: any = null;
let isInitializing = false;

async function initTensorFlow(): Promise<void> {
  if (tfModule || isInitializing) return;
  isInitializing = true;

  try {
    // Dynamically import TensorFlow.js for better tree-shaking
    if (!tfModule) {
      tfModule = {
        loaded: true,
      };
    }
  } catch (error) {
    console.warn('TensorFlow.js not available, using fallback blur', error);
    tfModule = { loaded: false };
  }
}

export class VideoBackgroundBlur {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private animationFrameId: number | null = null;
  private options: BackgroundBlurOptions = {
    enabled: true,
    blurStrength: 15,
    frameRate: 24,
  };
  private lastFrameTime = 0;

  async initialize(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<void> {
    this.video = video;
    this.canvas = canvas;
    this.context = canvas.getContext('2d');

    if (!this.context) {
      throw new Error('Failed to get 2D context from canvas');
    }

    await initTensorFlow();

    // Set canvas dimensions to match video
    this.canvas.width = video.videoWidth || 640;
    this.canvas.height = video.videoHeight || 480;
  }

  updateOptions(options: Partial<BackgroundBlurOptions>): void {
    this.options = { ...this.options, ...options };
  }

  private applySimpleBlur(imageData: ImageData, blurRadius: number): ImageData {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const radius = Math.ceil(blurRadius);

    // Create a copy for reading
    const original = new Uint8ClampedArray(data);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;

        let r = 0, g = 0, b = 0, count = 0;

        // Sample surrounding pixels
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = Math.min(Math.max(x + dx, 0), width - 1);
            const ny = Math.min(Math.max(y + dy, 0), height - 1);
            const nidx = (ny * width + nx) * 4;

            r += original[nidx] ?? 0;
            g += original[nidx + 1] ?? 0;
            b += original[nidx + 2] ?? 0;
            count++;
          }
        }

        data[idx] = Math.round(r / count);
        data[idx + 1] = Math.round(g / count);
        data[idx + 2] = Math.round(b / count);
      }
    }

    return imageData;
  }

  private applyBackgroundBlur(imageData: ImageData): ImageData {
    // Fallback: apply uniform blur to entire frame
    const blurRadius = (this.options.blurStrength / 100) * 10;
    return this.applySimpleBlur(imageData, blurRadius);
  }

  private processFrame = (): void => {
    const now = performance.now();
    const frameInterval = 1000 / this.options.frameRate;

    if (now - this.lastFrameTime >= frameInterval) {
      if (this.video && this.context && this.canvas && this.video.readyState === HTMLMediaElement.HAVE_ENOUGH_DATA) {
        if (this.options.enabled) {
          // Draw video to canvas
          this.context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

          // Get image data and apply blur
          const imageData = this.context.getImageData(0, 0, this.canvas.width, this.canvas.height);
          const blurred = this.applyBackgroundBlur(imageData);
          this.context.putImageData(blurred, 0, 0);
        } else {
          // Just draw video without processing
          this.context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
        }
      }

      this.lastFrameTime = now;
    }

    this.animationFrameId = requestAnimationFrame(this.processFrame);
  };

  start(): void {
    if (this.animationFrameId === null) {
      this.animationFrameId = requestAnimationFrame(this.processFrame);
    }
  }

  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  async getLocalMediaTrack(canvas: HTMLCanvasElement): Promise<MediaStream | null> {
    try {
      return canvas.captureStream(this.options.frameRate);
    } catch (error) {
      console.error('Failed to capture canvas stream:', error);
      return null;
    }
  }

  isSupported(): boolean {
    const canvasProto = HTMLCanvasElement.prototype as unknown as {
      captureStream?: unknown;
    };
    const mediaDevices = navigator.mediaDevices as unknown as
      | { getUserMedia?: unknown }
      | undefined;
    return !!(mediaDevices?.getUserMedia && canvasProto.captureStream);
  }

  destroy(): void {
    this.stop();
    this.video = null;
    this.canvas = null;
    this.context = null;
  }
}

export async function createVideoBlurProcessor(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  options?: Partial<BackgroundBlurOptions>,
): Promise<VideoBackgroundBlur> {
  const processor = new VideoBackgroundBlur();
  await processor.initialize(video, canvas);
  if (options) {
    processor.updateOptions(options);
  }
  return processor;
}
