/**
 * Minimal reader for uncompressed little-endian DICOM pixel data (single or multi-frame).
 *
 * Only the tags needed to draw pixels are read; every other attribute (patient name, ID,
 * birth date, …) is skipped without being decoded, so nothing identifying can reach the UI.
 * Compressed transfer syntaxes are rejected rather than half-rendered.
 */

export interface DicomImage {
  rows: number;
  columns: number;
  frames: number;
  /** Stored values with the modality rescale (slope/intercept) applied, one array per frame. */
  slices: Float32Array[];
  /** Window preset embedded in the file, if any. */
  window?: { center: number; width: number };
}

const IMPLICIT_LE = '1.2.840.10008.1.2';
const EXPLICIT_LE = '1.2.840.10008.1.2.1';
const LONG_VRS = new Set(['OB', 'OD', 'OF', 'OL', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT']);

export class DicomError extends Error {}

export function parseDicomImage(buf: ArrayBuffer): DicomImage {
  const v = new DataView(buf);
  const text = (o: number, n: number) =>
    String.fromCharCode(...new Uint8Array(buf, o, n)).replace(/[\0 ]+$/, '');
  if (buf.byteLength < 132 || text(128, 4) !== 'DICM') throw new DicomError('Not a DICOM file');

  let explicit = true;
  let syntax = EXPLICIT_LE;
  const t: Record<string, string | number> = {};
  let pixelStart = -1;
  let pixelLength = 0;

  let o = 132;
  while (o + 8 <= buf.byteLength) {
    const group = v.getUint16(o, true);
    const elem = v.getUint16(o + 2, true);
    // File meta (group 0002) is always explicit LE; the dataset follows the declared syntax.
    const isExplicit = group === 2 || explicit;
    let vr = '';
    let len: number;
    let header = 8;
    if (isExplicit) {
      vr = text(o + 4, 2);
      if (LONG_VRS.has(vr)) {
        len = v.getUint32(o + 8, true);
        header = 12;
      } else len = v.getUint16(o + 6, true);
    } else len = v.getUint32(o + 4, true);

    const start = o + header;
    const key = `${group.toString(16).padStart(4, '0')}${elem.toString(16).padStart(4, '0')}`;
    if (key === '7fe00010') {
      if (len === 0xffffffff)
        throw new DicomError('Compressed (encapsulated) DICOM is not supported');
      pixelStart = start;
      pixelLength = len;
      break;
    }
    if (len === 0xffffffff) throw new DicomError('Undefined-length sequences are not supported');
    if (start + len > buf.byteLength) throw new DicomError('Truncated DICOM file');

    if (key === '00020010') {
      syntax = text(start, len);
      if (syntax !== IMPLICIT_LE && syntax !== EXPLICIT_LE)
        throw new DicomError(`Unsupported transfer syntax ${syntax}`);
      explicit = syntax === EXPLICIT_LE;
    } else if (['00280002', '00280010', '00280011', '00280100', '00280103'].includes(key)) {
      t[key] = v.getUint16(start, true);
    } else if (['00280008', '00281050', '00281051', '00281052', '00281053'].includes(key)) {
      t[key] = text(start, len).split('\\')[0] ?? '';
    }
    o = start + len;
  }

  const rows = t['00280010'] as number;
  const columns = t['00280011'] as number;
  const bits = t['00280100'] as number;
  if (pixelStart < 0 || !rows || !columns) throw new DicomError('DICOM file has no pixel data');
  if ((t['00280002'] ?? 1) !== 1)
    throw new DicomError('Only single-channel (grayscale) DICOM is supported');
  if (bits !== 8 && bits !== 16) throw new DicomError(`Unsupported bit depth ${bits}`);

  const frames = Number(t['00280008'] ?? 1) || 1;
  const bytes = bits / 8;
  const frameSize = rows * columns;
  if (
    pixelStart + frames * frameSize * bytes > buf.byteLength ||
    pixelLength < frames * frameSize * bytes
  )
    throw new DicomError('Truncated pixel data');

  const signed = t['00280103'] === 1;
  const slope = Number(t['00281053'] ?? 1) || 1;
  const intercept = Number(t['00281052'] ?? 0) || 0;
  const slices: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const slice = new Float32Array(frameSize);
    const base = pixelStart + f * frameSize * bytes;
    for (let i = 0; i < frameSize; i++) {
      const raw =
        bits === 8
          ? signed
            ? v.getInt8(base + i)
            : v.getUint8(base + i)
          : signed
            ? v.getInt16(base + i * 2, true)
            : v.getUint16(base + i * 2, true);
      slice[i] = raw * slope + intercept;
    }
    slices.push(slice);
  }

  const center = parseFloat(String(t['00281050']));
  const width = parseFloat(String(t['00281051']));
  return {
    rows,
    columns,
    frames,
    slices,
    ...(Number.isFinite(center) && Number.isFinite(width) ? { window: { center, width } } : {}),
  };
}

/** Hounsfield window presets: [center, width]. */
export const WINDOW_PRESETS = {
  'Soft Tissue': { center: 40, width: 400 },
  Lung: { center: -600, width: 1500 },
  Bone: { center: 400, width: 1800 },
} as const;

/** Maps Hounsfield values to 8-bit RGBA grayscale for the given window. */
export function applyWindow(
  slice: Float32Array,
  center: number,
  width: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(slice.length * 4);
  const lo = center - width / 2;
  const w = Math.max(width, 1);
  for (let i = 0; i < slice.length; i++) {
    const g = (((slice[i] ?? 0) - lo) / w) * 255;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g;
    out[i * 4 + 3] = 255;
  }
  return out;
}
