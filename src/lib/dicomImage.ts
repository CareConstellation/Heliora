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

export interface DicomTag {
  tag: string;
  formattedTag: string;
  group: number;
  element: number;
  name: string;
  vr: string;
  length: number;
  value: string | number;
  redacted?: boolean;
}

export interface ParseDicomTagsOptions {
  /** When false (default), Patient-group (0010,xxxx) values are redacted. */
  includePatientMetadata?: boolean;
}

const IMPLICIT_LE = '1.2.840.10008.1.2';
const EXPLICIT_LE = '1.2.840.10008.1.2.1';
const LONG_VRS = new Set(['OB', 'OD', 'OF', 'OL', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT']);

const DICOM_TAG_NAMES: Record<string, string> = {
  '00020010': 'TransferSyntaxUID',
  '00080016': 'SOPClassUID',
  '00080018': 'SOPInstanceUID',
  '00080020': 'StudyDate',
  '00080030': 'StudyTime',
  '00080060': 'Modality',
  '00080070': 'Manufacturer',
  '00081030': 'StudyDescription',
  '0008103e': 'SeriesDescription',
  '00100010': 'PatientName',
  '00100020': 'PatientID',
  '00100030': 'PatientBirthDate',
  '00100040': 'PatientSex',
  '00180050': 'SliceThickness',
  '00200011': 'SeriesNumber',
  '00200013': 'InstanceNumber',
  '00280002': 'SamplesPerPixel',
  '00280004': 'PhotometricInterpretation',
  '00280008': 'NumberOfFrames',
  '00280010': 'Rows',
  '00280011': 'Columns',
  '00280030': 'PixelSpacing',
  '00280100': 'BitsAllocated',
  '00280101': 'BitsStored',
  '00280102': 'HighBit',
  '00280103': 'PixelRepresentation',
  '00281050': 'WindowCenter',
  '00281051': 'WindowWidth',
  '00281052': 'RescaleIntercept',
  '00281053': 'RescaleSlope',
};

const IMPLICIT_VR_BY_TAG: Record<string, string> = {
  '00080060': 'CS',
  '00280002': 'US',
  '00280004': 'CS',
  '00280008': 'IS',
  '00280010': 'US',
  '00280011': 'US',
  '00280100': 'US',
  '00280101': 'US',
  '00280102': 'US',
  '00280103': 'US',
  '00281050': 'DS',
  '00281051': 'DS',
  '00281052': 'DS',
  '00281053': 'DS',
};

export class DicomError extends Error {}

function decodeTagValue(
  v: DataView,
  buf: ArrayBuffer,
  vr: string,
  start: number,
  len: number,
): string | number {
  if (len === 0) return '';
  if (vr === 'US' && len >= 2) return v.getUint16(start, true);
  if (vr === 'SS' && len >= 2) return v.getInt16(start, true);
  if (vr === 'UL' && len >= 4) return v.getUint32(start, true);
  if (vr === 'SL' && len >= 4) return v.getInt32(start, true);
  if (vr === 'FL' && len >= 4) return v.getFloat32(start, true);
  if (vr === 'FD' && len >= 8) return v.getFloat64(start, true);
  if (LONG_VRS.has(vr) && vr !== 'UT') return `[${vr} ${len} bytes]`;
  return String.fromCharCode(...new Uint8Array(buf, start, len)).replace(/[\0 ]+$/, '');
}

/**
 * Parses DICOM metadata tags from a little-endian DICOM buffer up to PixelData (7fe0,0010).
 * Patient-identifying tags (group 0010) are redacted unless `includePatientMetadata` is true.
 */
export function parseDicomTags(buf: ArrayBuffer, options: ParseDicomTagsOptions = {}): DicomTag[] {
  const v = new DataView(buf);
  const text = (o: number, n: number) =>
    String.fromCharCode(...new Uint8Array(buf, o, n)).replace(/[\0 ]+$/, '');
  if (buf.byteLength < 132 || text(128, 4) !== 'DICM') {
    throw new DicomError('Not a DICOM file');
  }

  const includePatient = options.includePatientMetadata ?? false;
  let explicit = true;
  const tags: DicomTag[] = [];
  let o = 132;

  while (o + 8 <= buf.byteLength) {
    const group = v.getUint16(o, true);
    const elem = v.getUint16(o + 2, true);
    const isExplicit = group === 2 || explicit;
    let vr = '';
    let len: number;
    let header = 8;

    if (isExplicit) {
      vr = text(o + 4, 2);
      if (LONG_VRS.has(vr)) {
        if (o + 12 > buf.byteLength) throw new DicomError('Truncated DICOM file');
        len = v.getUint32(o + 8, true);
        header = 12;
      } else {
        len = v.getUint16(o + 6, true);
      }
    } else {
      len = v.getUint32(o + 4, true);
    }

    const start = o + header;
    const gHex = group.toString(16).padStart(4, '0');
    const eHex = elem.toString(16).padStart(4, '0');
    const key = `${gHex}${eHex}`;

    if (key === '7fe00010') break;
    if (len === 0xffffffff) throw new DicomError('Undefined-length sequences are not supported');
    if (start + len > buf.byteLength) throw new DicomError('Truncated DICOM file');

    const resolvedVr = vr || IMPLICIT_VR_BY_TAG[key] || 'UN';
    if (key === '00020010') {
      const syntax = text(start, len);
      if (syntax !== IMPLICIT_LE && syntax !== EXPLICIT_LE) {
        throw new DicomError(`Unsupported transfer syntax ${syntax}`);
      }
      explicit = syntax === EXPLICIT_LE;
    }

    const isPatientGroup = group === 0x0010;
    const redacted = isPatientGroup && !includePatient;
    const value = redacted ? '[REDACTED]' : decodeTagValue(v, buf, resolvedVr, start, len);

    tags.push({
      tag: key,
      formattedTag: `(${gHex},${eHex})`,
      group,
      element: elem,
      name: DICOM_TAG_NAMES[key] ?? `Tag_${gHex}_${eHex}`,
      vr: resolvedVr,
      length: len,
      value,
      ...(redacted ? { redacted: true } : {}),
    });

    o = start + len;
  }

  return tags;
}

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
  invert = false,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(slice.length * 4);
  const lo = center - width / 2;
  const w = Math.max(width, 1);
  for (let i = 0; i < slice.length; i++) {
    const clamped = Math.max(0, Math.min(255, Math.round((((slice[i] ?? 0) - lo) / w) * 255)));
    const g = invert ? 255 - clamped : clamped;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Renders a single DICOM frame onto an HTMLCanvasElement with window/level and invert support. */
export function renderDicomToCanvas(
  canvas: HTMLCanvasElement,
  image: DicomImage,
  frame: number,
  options: { center: number; width: number; invert?: boolean },
): boolean {
  const ctx = canvas.getContext('2d');
  const slice = image.slices[frame];
  if (!ctx || !slice) return false;
  if (canvas.width !== image.columns) canvas.width = image.columns;
  if (canvas.height !== image.rows) canvas.height = image.rows;
  const pixels = applyWindow(slice, options.center, options.width, options.invert ?? false);
  ctx.putImageData(new ImageData(pixels, image.columns, image.rows), 0, 0);
  return true;
}
