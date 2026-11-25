import {
  decryptEncounterSnapshot,
  encryptEncounterSnapshot,
  exportKey,
  type EncryptedSnapshotPayload,
} from '@/lib/crypto';

/* ── Capture ────────────────────────────────────────────────────────── */

export class SnapshotCaptureError extends Error {
  readonly code: 'no-frame' | 'unsupported' | 'encode-failed';

  constructor(message: string, code: 'no-frame' | 'unsupported' | 'encode-failed') {
    super(message);
    this.name = 'SnapshotCaptureError';
    this.code = code;
  }
}

export interface EncryptedSnapshotRecord extends EncryptedSnapshotPayload {
  id: string;
  encounterId: string;
  capturedAt: string;
  width: number;
  height: number;
}

/**
 * Draws the current frame of a video element at its native resolution and encodes it
 * as a lossless PNG. Native resolution is used, not the on-screen size, so the
 * capture keeps the detail a dermatology review needs.
 *
 * Time: O(W·H) for the pixel copy and encode. Space: O(W·H).
 */
export async function captureVideoFramePng(
  video: HTMLVideoElement,
): Promise<{ blob: Blob; width: number; height: number }> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new SnapshotCaptureError('The video has no frame to capture yet.', 'no-frame');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new SnapshotCaptureError('Canvas capture is not supported in this browser.', 'unsupported');
  }
  context.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  if (!blob) {
    throw new SnapshotCaptureError('The snapshot could not be encoded.', 'encode-failed');
  }
  return { blob, width, height };
}

/**
 * Captures a frame and encrypts it under the encounter key. The returned record
 * holds only ciphertext, never the raw pixels.
 */
export async function captureEncryptedSnapshot(
  video: HTMLVideoElement,
  encounterKey: CryptoKey,
  encounterId: string,
): Promise<EncryptedSnapshotRecord> {
  const { blob, width, height } = await captureVideoFramePng(video);
  const plaintext = await blob.arrayBuffer();
  const { iv, ciphertext } = await encryptEncounterSnapshot(plaintext, encounterKey, encounterId);

  return {
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    encounterId,
    capturedAt: new Date().toISOString(),
    width,
    height,
    iv,
    ciphertext,
  };
}

/* ── Portable file format ──────────────────────────────────────────── */

const ENVELOPE_VERSION = 1;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Serializes a record to a JSON envelope that can be saved or sent to the record. */
export function serializeEncryptedSnapshot(record: EncryptedSnapshotRecord): string {
  return JSON.stringify(
    {
      version: ENVELOPE_VERSION,
      encounterId: record.encounterId,
      capturedAt: record.capturedAt,
      mimeType: 'image/png',
      width: record.width,
      height: record.height,
      iv: bytesToBase64(record.iv),
      ciphertext: bytesToBase64(new Uint8Array(record.ciphertext)),
    },
    null,
    2,
  );
}

/**
 * Parses an envelope produced by {@link serializeEncryptedSnapshot}. Returns `null`
 * for an unknown version or any missing or mistyped field.
 */
export function parseEncryptedSnapshot(json: string): EncryptedSnapshotRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== ENVELOPE_VERSION) return null;
  if (typeof envelope.encounterId !== 'string' || typeof envelope.capturedAt !== 'string') return null;
  if (typeof envelope.width !== 'number' || typeof envelope.height !== 'number') return null;
  if (typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') return null;

  const iv = base64ToBytes(envelope.iv);
  if (iv.length !== 12) return null;

  return {
    id: `snap-${envelope.capturedAt}`,
    encounterId: envelope.encounterId,
    capturedAt: envelope.capturedAt,
    width: envelope.width,
    height: envelope.height,
    iv,
    ciphertext: base64ToBytes(envelope.ciphertext).buffer,
  };
}

/** Serializes the raw encounter key so it can be stored apart from the snapshots. */
export async function serializeEncounterKey(encounterKey: CryptoKey, encounterId: string): Promise<string> {
  const raw = await exportKey(encounterKey);
  return JSON.stringify(
    {
      version: ENVELOPE_VERSION,
      encounterId,
      algorithm: 'AES-GCM-256',
      key: bytesToBase64(new Uint8Array(raw)),
    },
    null,
    2,
  );
}

/** Decrypts a stored snapshot record with the encounter key, for review. */
export async function decryptSnapshotToPng(
  record: EncryptedSnapshotRecord,
  encounterKey: CryptoKey,
): Promise<ArrayBuffer> {
  return decryptEncounterSnapshot(record, encounterKey, record.encounterId);
}

/* ── Patient notification ──────────────────────────────────────────── */

export interface SnapshotNotice {
  type: 'SNAPSHOT_CAPTURED';
  appointmentId: string;
  capturedAt: string;
}

export interface SnapshotChannel {
  announce: (capturedAt: string) => void;
  close: () => void;
}

/**
 * Opens a same-origin channel for capture notices. The capturing side calls
 * `announce`, and every other open view of the same appointment receives the notice.
 * Returns a no-op channel where BroadcastChannel is unavailable.
 */
export function createSnapshotChannel(
  appointmentId: string,
  onNotice: (notice: SnapshotNotice) => void,
): SnapshotChannel {
  if (typeof BroadcastChannel === 'undefined') {
    return { announce: () => undefined, close: () => undefined };
  }

  const channel = new BroadcastChannel(`heliora-snapshot-${appointmentId}`);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data as Partial<SnapshotNotice> | null;
    if (data?.type === 'SNAPSHOT_CAPTURED' && typeof data.capturedAt === 'string') {
      onNotice({ type: 'SNAPSHOT_CAPTURED', appointmentId, capturedAt: data.capturedAt });
    }
  };

  return {
    announce: (capturedAt: string) => {
      const notice: SnapshotNotice = { type: 'SNAPSHOT_CAPTURED', appointmentId, capturedAt };
      channel.postMessage(notice);
    },
    close: () => channel.close(),
  };
}

/** Short audible cue for capture. Best effort: silently skipped where audio is unavailable. */
export function playCaptureChime(): void {
  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.4);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.4);
    oscillator.onended = () => {
      void context.close();
    };
  } catch {
    // Audio cue is optional; the visual notice still appears.
  }
}
