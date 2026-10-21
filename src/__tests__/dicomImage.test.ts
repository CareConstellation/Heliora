/**
 * @jest-environment node
 */
import { applyWindow, DicomError, parseDicomImage, WINDOW_PRESETS } from '@/lib/dicomImage';
import { sanitizeFile } from '@/lib/fileSanitizer';

/** Builds an explicit-VR little-endian DICOM with 16-bit signed pixels. */
function buildDicom(frames: number[][], opts: { syntax?: string } = {}): Uint8Array {
  const parts: number[] = new Array(128).fill(0).concat([...'DICM'].map((c) => c.charCodeAt(0)));
  const u16 = (n: number) => [n & 255, n >> 8];
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const el = (g: number, e: number, vr: string, value: number[]) => {
    const padded = value.length % 2 ? [...value, vr === 'UI' ? 0 : 0x20] : value;
    parts.push(...u16(g), ...u16(e), ...[...vr].map((c) => c.charCodeAt(0)));
    if (['OW', 'OB'].includes(vr)) parts.push(0, 0, ...u32(padded.length));
    else parts.push(...u16(padded.length));
    parts.push(...padded);
  };
  const str = (s: string) => [...s].map((c) => c.charCodeAt(0));
  el(0x2, 0x10, 'UI', str(opts.syntax ?? '1.2.840.10008.1.2.1'));
  el(0x10, 0x10, 'PN', str('DOE^JANE'));
  el(0x10, 0x20, 'LO', str('MRN-998877'));
  el(0x28, 0x2, 'US', u16(1));
  el(0x28, 0x8, 'IS', str(String(frames.length)));
  el(0x28, 0x10, 'US', u16(2));
  el(0x28, 0x11, 'US', u16(2));
  el(0x28, 0x100, 'US', u16(16));
  el(0x28, 0x103, 'US', u16(1));
  el(0x28, 0x1052, 'DS', str('-1024'));
  el(0x28, 0x1053, 'DS', str('1'));
  el(
    0x7fe0,
    0x10,
    'OW',
    frames.flat().flatMap((p) => u16(p & 0xffff)),
  );
  return new Uint8Array(parts);
}

describe('DICOM viewer pipeline (#68)', () => {
  const study = buildDicom([
    [0, 1024, 1424, 3000],
    [10, 20, 30, 40],
  ]);

  it('parses multi-frame pixels and applies the modality rescale', () => {
    const img = parseDicomImage(study.buffer as ArrayBuffer);
    expect([img.rows, img.columns, img.frames]).toEqual([2, 2, 2]);
    expect(Array.from(img.slices[0]!)).toEqual([-1024, 0, 400, 1976]);
  });

  it('exposes no patient metadata', () => {
    const img = parseDicomImage(study.buffer as ArrayBuffer);
    expect(Object.keys(img).sort()).toEqual(['columns', 'frames', 'rows', 'slices']);
    expect(JSON.stringify(img)).not.toMatch(/DOE|MRN/);
  });

  it('still parses after the sanitizer blanks identity tags', async () => {
    const { file } = await sanitizeFile(new File([study.buffer as ArrayBuffer], 'a.dcm'));
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).not.toContain('DOE^JANE');
    expect(parseDicomImage(bytes.buffer as ArrayBuffer).frames).toBe(2);
  });

  it('rejects compressed transfer syntaxes and non-DICOM input', () => {
    const jpeg = buildDicom([[1, 2, 3, 4]], { syntax: '1.2.840.10008.1.2.4.50' });
    expect(() => parseDicomImage(jpeg.buffer as ArrayBuffer)).toThrow(DicomError);
    expect(() => parseDicomImage(new ArrayBuffer(200))).toThrow('Not a DICOM file');
  });

  it('windows Hounsfield units per preset', () => {
    const { center, width } = WINDOW_PRESETS['Soft Tissue']; // -160..240 HU
    const px = applyWindow(Float32Array.from([-500, -160, 40, 240, 900]), center, width);
    expect([px[0], px[4], px[8], px[12], px[16]]).toEqual([0, 0, 128, 255, 255]);
  });
});
