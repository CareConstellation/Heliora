import {
  createEncounterKey,
  decryptEncounterSnapshot,
  encryptEncounterSnapshot,
  exportKey,
} from '@/lib/crypto';
import {
  captureEncryptedSnapshot,
  captureVideoFramePng,
  createSnapshotChannel,
  decryptSnapshotToPng,
  parseEncryptedSnapshot,
  serializeEncounterKey,
  serializeEncryptedSnapshot,
} from '@/lib/encounterSnapshot';

function makeVideo(width: number, height: number): HTMLVideoElement {
  const video = document.createElement('video');
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: width });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: height });
  return video;
}

/** Stubs the canvas so the capture pipeline produces the given PNG bytes. */
function mockCanvas(pngBytes: number[]) {
  const drawImage = jest.fn();
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  jest
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((callback: BlobCallback) => {
      callback(new Blob([new Uint8Array(pngBytes)], { type: 'image/png' }));
    });
  return { drawImage };
}

function bytes(buffer: ArrayBuffer): number[] {
  return Array.from(new Uint8Array(buffer));
}

describe('feat(telemedicine): encrypted snapshot capture for dermatological examination (#263)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('encounter encryption', () => {
    it('creates an exportable 256-bit AES-GCM encounter key', async () => {
      const key = await createEncounterKey();

      expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
      expect((await exportKey(key)).byteLength).toBe(32);
    });

    it('round-trips a snapshot buffer under the same encounter ID', async () => {
      const key = await createEncounterKey();
      const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;

      const payload = await encryptEncounterSnapshot(plaintext, key, 'encounter-a');
      const decrypted = await decryptEncounterSnapshot(payload, key, 'encounter-a');

      expect(bytes(decrypted)).toEqual(bytes(plaintext));
    });

    it('rejects decryption under a different encounter ID, because the ID is bound as AAD', async () => {
      const key = await createEncounterKey();
      const payload = await encryptEncounterSnapshot(new Uint8Array([9, 9, 9]).buffer, key, 'encounter-a');

      await expect(decryptEncounterSnapshot(payload, key, 'encounter-b')).rejects.toBeDefined();
    });

    it('rejects a tampered ciphertext', async () => {
      const key = await createEncounterKey();
      const payload = await encryptEncounterSnapshot(new Uint8Array([1, 2, 3, 4]).buffer, key, 'encounter-a');
      const tampered = new Uint8Array(payload.ciphertext.slice(0));
      tampered[0] = (tampered[0] ?? 0) ^ 0xff;

      await expect(
        decryptEncounterSnapshot({ iv: payload.iv, ciphertext: tampered.buffer }, key, 'encounter-a'),
      ).rejects.toBeDefined();
    });

    it('uses a fresh 96-bit IV for every snapshot', async () => {
      const key = await createEncounterKey();
      const plaintext = new Uint8Array([1]).buffer;

      const first = await encryptEncounterSnapshot(plaintext, key, 'encounter-a');
      const second = await encryptEncounterSnapshot(plaintext, key, 'encounter-a');

      expect(first.iv.length).toBe(12);
      expect(Array.from(first.iv)).not.toEqual(Array.from(second.iv));
    });
  });

  describe('captureVideoFramePng', () => {
    it('refuses to capture before the video has a frame', async () => {
      await expect(captureVideoFramePng(makeVideo(0, 0))).rejects.toMatchObject({ code: 'no-frame' });
    });

    it('draws the frame at native resolution and encodes it as PNG', async () => {
      const { drawImage } = mockCanvas([137, 80, 78, 71]);
      const video = makeVideo(1920, 1080);

      const result = await captureVideoFramePng(video);

      expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.blob.type).toBe('image/png');
    });
  });

  describe('captureEncryptedSnapshot', () => {
    it('stores only ciphertext and decrypts back to the captured PNG bytes', async () => {
      mockCanvas([1, 2, 3, 4, 5]);
      const key = await createEncounterKey();

      const record = await captureEncryptedSnapshot(makeVideo(1280, 720), key, 'encounter-c');

      expect(record.encounterId).toBe('encounter-c');
      expect(record.width).toBe(1280);
      expect(record.height).toBe(720);
      expect(bytes(record.ciphertext)).not.toEqual([1, 2, 3, 4, 5]);
      expect(bytes(await decryptSnapshotToPng(record, key))).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('portable file format', () => {
    it('round-trips a record through the JSON envelope', async () => {
      mockCanvas([7, 8, 9]);
      const key = await createEncounterKey();
      const record = await captureEncryptedSnapshot(makeVideo(640, 480), key, 'encounter-d');

      const parsed = parseEncryptedSnapshot(serializeEncryptedSnapshot(record));

      expect(parsed).not.toBeNull();
      expect(parsed!.encounterId).toBe('encounter-d');
      expect(parsed!.width).toBe(640);
      expect(bytes(parsed!.iv)).toEqual(bytes(record.iv));
      expect(bytes(parsed!.ciphertext)).toEqual(bytes(record.ciphertext));
      expect(bytes(await decryptSnapshotToPng(parsed!, key))).toEqual([7, 8, 9]);
    });

    it('rejects unknown versions and malformed envelopes', () => {
      expect(parseEncryptedSnapshot('not json')).toBeNull();
      expect(parseEncryptedSnapshot(JSON.stringify({ version: 2 }))).toBeNull();
      expect(
        parseEncryptedSnapshot(
          JSON.stringify({
            version: 1,
            encounterId: 'e',
            capturedAt: 'now',
            width: 1,
            height: 1,
            iv: 'AAAA', // 3 bytes, not 12
            ciphertext: 'AAAA',
          }),
        ),
      ).toBeNull();
    });

    it('exports the raw encounter key for storage apart from the snapshots', async () => {
      const key = await createEncounterKey();

      const serialized = JSON.parse(await serializeEncounterKey(key, 'encounter-e')) as {
        algorithm: string;
        encounterId: string;
        key: string;
      };

      expect(serialized.algorithm).toBe('AES-GCM-256');
      expect(serialized.encounterId).toBe('encounter-e');
      expect(atob(serialized.key).length).toBe(32);
    });
  });

  describe('createSnapshotChannel', () => {
    it('is safe to use where BroadcastChannel is unavailable', () => {
      const original = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
      Reflect.deleteProperty(globalThis, 'BroadcastChannel');
      try {
        const channel = createSnapshotChannel('encounter-f', jest.fn());
        expect(() => channel.announce(new Date().toISOString())).not.toThrow();
        expect(() => channel.close()).not.toThrow();
      } finally {
        if (original !== undefined) {
          (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = original;
        }
      }
    });
  });
});
