/**
 * @jest-environment node
 */
import { applyWindow, DicomError, parseDicomImage, parseDicomTags, WINDOW_PRESETS } from '@/lib/dicomImage';

function buildDicomBuffer(opts: {
  syntax?: string;
  modality?: string;
  patientName?: string;
  windowCenter?: string;
  windowWidth?: string;
  rows?: number;
  cols?: number;
  pixels?: number[];
} = {}): ArrayBuffer {
  const parts: number[] = new Array(128).fill(0).concat([...'DICM'].map((c) => c.charCodeAt(0)));
  const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const str = (s: string) => [...s].map((c) => c.charCodeAt(0));

  const syntax = opts.syntax ?? '1.2.840.10008.1.2.1';
  const implicit = syntax === '1.2.840.10008.1.2';

  const el = (g: number, e: number, vr: string, value: number[]) => {
    const padded = value.length % 2 ? [...value, vr === 'UI' ? 0 : 0x20] : value;
    parts.push(...u16(g), ...u16(e));
    if (g === 0x0002 || !implicit) {
      parts.push(...str(vr));
      if (['OW', 'OB', 'SQ', 'UN', 'UT'].includes(vr)) {
        parts.push(0, 0, ...u32(padded.length));
      } else {
        parts.push(...u16(padded.length));
      }
    } else {
      parts.push(...u32(padded.length));
    }
    parts.push(...padded);
  };

  el(0x0002, 0x0010, 'UI', str(syntax));
  el(0x0008, 0x0060, 'CS', str(opts.modality ?? 'CT'));
  el(0x0010, 0x0010, 'PN', str(opts.patientName ?? 'DOE^JOHN'));
  el(0x0028, 0x0002, 'US', u16(1));
  el(0x0028, 0x0010, 'US', u16(opts.rows ?? 2));
  el(0x0028, 0x0011, 'US', u16(opts.cols ?? 2));
  el(0x0028, 0x0100, 'US', u16(16));
  el(0x0028, 0x0103, 'US', u16(0));
  if (opts.windowCenter) el(0x0028, 0x1050, 'DS', str(opts.windowCenter));
  if (opts.windowWidth) el(0x0028, 0x1051, 'DS', str(opts.windowWidth));
  const pixels = opts.pixels ?? [100, 200, 300, 400];
  el(0x7fe0, 0x0010, 'OW', pixels.flatMap((p) => u16(p)));

  return new Uint8Array(parts).buffer;
}

describe('DICOM tag parsing and invert windowing (#275)', () => {
  it('parses explicit-VR DICOM tags and redacts patient group (0010) by default', () => {
    const buf = buildDicomBuffer({
      modality: 'MR',
      patientName: 'SMITH^ALICE',
      windowCenter: '50',
      windowWidth: '350',
    });

    const tags = parseDicomTags(buf);
    const modalityTag = tags.find((t) => t.tag === '00080060');
    const patientTag = tags.find((t) => t.tag === '00100010');
    const rowsTag = tags.find((t) => t.tag === '00280010');

    expect(modalityTag).toMatchObject({
      formattedTag: '(0008,0060)',
      name: 'Modality',
      vr: 'CS',
      value: 'MR',
    });
    expect(patientTag).toMatchObject({
      formattedTag: '(0010,0010)',
      name: 'PatientName',
      value: '[REDACTED]',
      redacted: true,
    });
    expect(rowsTag?.value).toBe(2);
  });

  it('includes patient metadata when includePatientMetadata is true', () => {
    const buf = buildDicomBuffer({ patientName: 'SMITH^ALICE' });
    const tags = parseDicomTags(buf, { includePatientMetadata: true });
    const patientTag = tags.find((t) => t.tag === '00100010');
    expect(patientTag?.value).toBe('SMITH^ALICE');
    expect(patientTag?.redacted).toBeUndefined();
  });

  it('parses implicit-VR little-endian DICOM tags and pixel data', () => {
    const buf = buildDicomBuffer({
      syntax: '1.2.840.10008.1.2',
      modality: 'CR',
      pixels: [0, 50, 100, 255],
    });
    const tags = parseDicomTags(buf);
    expect(tags.find((t) => t.tag === '00080060')?.value).toBe('CR');
    const img = parseDicomImage(buf);
    expect(Array.from(img.slices[0]!)).toEqual([0, 50, 100, 255]);
  });

  it('throws DicomError on invalid or unsupported transfer syntax', () => {
    const bad = buildDicomBuffer({ syntax: '1.2.840.10008.1.2.4.90' });
    expect(() => parseDicomTags(bad)).toThrow(DicomError);
    expect(() => parseDicomTags(new ArrayBuffer(64))).toThrow('Not a DICOM file');
  });

  it('supports invert mode in applyWindow', () => {
    const { center, width } = WINDOW_PRESETS['Soft Tissue'];
    const slice = Float32Array.from([-500, 40, 900]);
    const normal = applyWindow(slice, center, width, false);
    const inverted = applyWindow(slice, center, width, true);

    expect([normal[0], normal[4], normal[8]]).toEqual([0, 128, 255]);
    expect([inverted[0], inverted[4], inverted[8]]).toEqual([255, 127, 0]);
  });
});
