/**
 * Client-side file sanitizer, run before encryption.
 *
 * - JPEG: removes EXIF GPS data, camera/lens serial numbers, owner name and maker
 *   notes (zeroed in place so orientation and other EXIF survive), plus XMP,
 *   IPTC and comment segments.
 * - PNG: removes eXIf and tEXt/zTXt/iTXt chunks, and checks every chunk CRC.
 * - PDF: removes the Info dictionary and XMP metadata, and detects JavaScript,
 *   launch actions, embedded files, RichMedia and XFA.
 * - DICOM: blanks patient-identity attributes in place (PS3.15 Annex E subset),
 *   including inside sequences, and zeroes the 128-byte preamble.
 *
 * The file's type is detected from its bytes, not from the browser's MIME type.
 * Executable payloads, scripts, and malformed or uninspectable structures
 * reject the file with {@link UnsafeFileError}.
 */

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream, type PDFObject } from 'pdf-lib';

export type SanitizedFormat = 'jpeg' | 'png' | 'pdf' | 'dicom';

export interface SanitizedFile {
  file: File;
  format: SanitizedFormat;
  /** Human-readable list of what was stripped. */
  removed: string[];
}

/** Raised when a file contains executable content, scripts or malformed structures. */
export class UnsafeFileError extends Error {
  constructor(readonly threats: string[]) {
    super(`File rejected: ${threats.join('; ')}`);
    this.name = 'UnsafeFileError';
  }
}

/** Collects findings for one file; a structural error aborts parsing as a threat. */
class Report {
  readonly removed = new Set<string>();
  readonly threats: string[] = [];
  malformed(message: string): never {
    throw new UnsafeFileError([...this.threats, message]);
  }
}

const ascii = (b: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...b.subarray(start, start + length));

/* ── Executable payload signatures ───────────────────────────────────── */

const EXECUTABLE_SIGNATURES: [string, number[]][] = [
  ['Windows executable (MZ)', [0x4d, 0x5a]],
  ['ELF executable', [0x7f, 0x45, 0x4c, 0x46]],
  ['Mach-O executable', [0xcf, 0xfa, 0xed, 0xfe]],
  ['ZIP/JAR/Office archive', [0x50, 0x4b, 0x03, 0x04]],
  ['shell script', [0x23, 0x21]],
];
const SCRIPT_MARKERS = /<script|<\?php|<html|<svg/i;

/** Names the executable or script payload starting at the first non-padding byte, if any. */
function executablePayload(bytes: Uint8Array): string | null {
  let i = 0;
  while (
    i < bytes.length &&
    (bytes[i] === 0x00 || bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d)
  )
    i++;
  const rest = bytes.subarray(i);
  for (const [name, sig] of EXECUTABLE_SIGNATURES) {
    if (sig.every((v, k) => rest[k] === v)) return name;
  }
  return SCRIPT_MARKERS.test(ascii(rest, 0, Math.min(rest.length, 512))) ? 'embedded script' : null;
}

/* ── JPEG ─────────────────────────────────────────────────────────── */

const TIFF_TYPE_BYTES: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
};
const EXIF_IFD_POINTER = 0x8769;
const GPS_IFD_POINTER = 0x8825;
/** Exif/TIFF tags whose values identify the device or its owner. */
const EXIF_IDENTIFYING_TAGS: Record<number, string> = {
  0x927c: 'camera maker notes',
  0xa430: 'camera owner name',
  0xa431: 'camera serial number',
  0xa435: 'lens serial number',
  0xc62f: 'camera serial number',
};

/**
 * Scrubs a TIFF/EXIF block in place. Identifying values are zeroed, and the GPS
 * IFD is emptied (entry count and next-IFD pointer set to 0), so no offsets move.
 * Returns false when the structure is inconsistent, so the caller drops the whole segment.
 */
function scrubExif(tiff: Uint8Array, report: Report): boolean {
  if (tiff.length < 8) return false;
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return false;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);
  if (u16(2) !== 42) return false;

  const valueRange = (entry: number): [number, number] | null => {
    const size = (TIFF_TYPE_BYTES[u16(entry + 2)] ?? 0) * u32(entry + 4);
    const start = size <= 4 ? entry + 8 : u32(entry + 8);
    return start + size <= tiff.length ? [start, start + size] : null;
  };
  const entries = (ifd: number): number[] | null => {
    if (ifd + 2 > tiff.length) return null;
    const count = u16(ifd);
    if (ifd + 2 + count * 12 + 4 > tiff.length) return null;
    return Array.from({ length: count }, (_, k) => ifd + 2 + k * 12);
  };

  const ifd0 = entries(u32(4));
  if (!ifd0) return false;
  const scanned = [...ifd0];
  let gpsIfd: number | null = null;
  for (const e of ifd0) {
    if (u16(e) === GPS_IFD_POINTER) gpsIfd = u32(e + 8);
    if (u16(e) === EXIF_IFD_POINTER) {
      const exif = entries(u32(e + 8));
      if (!exif) return false;
      scanned.push(...exif);
    }
  }

  for (const e of scanned) {
    const label = EXIF_IDENTIFYING_TAGS[u16(e)];
    if (!label) continue;
    const range = valueRange(e);
    if (!range) return false;
    tiff.fill(0, range[0], range[1]);
    report.removed.add(label);
  }

  if (gpsIfd !== null) {
    const gps = entries(gpsIfd);
    if (!gps) return false;
    for (const e of gps) {
      const range = valueRange(e);
      if (!range) return false;
      tiff.fill(0, range[0], range[1]);
    }
    tiff.fill(0, gpsIfd, gpsIfd + 2 + gps.length * 12 + 4);
    report.removed.add('GPS location');
  }
  return true;
}

const EXIF_HEADER = 'Exif\0\0';

function sanitizeJpeg(b: Uint8Array, report: Report): Uint8Array {
  if (b[0] !== 0xff || b[1] !== 0xd8) report.malformed('JPEG is missing its start-of-image marker');
  const kept: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  for (;;) {
    while (b[i] === 0xff && b[i + 1] === 0xff) i++; // fill bytes before a marker
    if (i + 2 > b.length || b[i] !== 0xff)
      report.malformed('JPEG segment structure is corrupt or truncated');
    const marker = b[i + 1]!;
    if (marker === 0xd9) {
      kept.push(b.subarray(i, i + 2));
      const trailer = b.subarray(i + 2);
      if (trailer.some((v) => v !== 0)) {
        const payload = executablePayload(trailer);
        if (payload) report.threats.push(`${payload} hidden after the end of the image`);
        report.removed.add('data after end of image');
      }
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > b.length) report.malformed('JPEG segment structure is corrupt or truncated');
    const end = i + 2 + ((b[i + 2]! << 8) | b[i + 3]!);
    if (end > b.length || end < i + 4) report.malformed('JPEG segment length exceeds the file');
    const segment = b.slice(i, end);

    if (marker === 0xe1 && ascii(segment, 4, 6) === EXIF_HEADER) {
      if (scrubExif(segment.subarray(10), report)) kept.push(segment);
      else report.removed.add('unreadable EXIF metadata');
    } else if (marker === 0xe1) {
      report.removed.add('XMP metadata');
    } else if (marker === 0xed) {
      report.removed.add('IPTC/Photoshop metadata');
    } else if (marker === 0xfe) {
      report.removed.add('image comments');
    } else {
      kept.push(segment);
    }
    i = end;

    if (marker === 0xda) {
      // Entropy-coded scan data runs until the next marker that is not a stuffed 0x00 or an RSTn.
      const scanStart = i;
      while (
        i + 1 < b.length &&
        !(b[i] === 0xff && b[i + 1] !== 0x00 && !(b[i + 1]! >= 0xd0 && b[i + 1]! <= 0xd7))
      )
        i++;
      if (i + 1 >= b.length) report.malformed('JPEG ends without an end-of-image marker');
      kept.push(b.subarray(scanStart, i));
    }
  }
  return concatBytes(kept);
}

/* ── PNG ──────────────────────────────────────────────────────────── */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_CRITICAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);
const PNG_METADATA = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 (ISO-HDLC), as used by PNG chunks. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const v of bytes) c = CRC_TABLE[(c ^ v) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function sanitizePng(b: Uint8Array, report: Report): Uint8Array {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const kept: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  for (let first = true; ; first = false) {
    if (i + 12 > b.length) report.malformed('PNG ends without an IEND chunk');
    const length = view.getUint32(i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || end > b.length)
      report.malformed('PNG chunk structure is corrupt');
    if (first && type !== 'IHDR') report.malformed('PNG does not start with an IHDR chunk');
    if (crc32(b.subarray(i + 4, i + 8 + length)) !== view.getUint32(i + 8 + length)) {
      report.malformed(`PNG ${type} chunk failed its CRC check`);
    }
    if (type[0] === type[0]!.toUpperCase() && !PNG_CRITICAL.has(type)) {
      report.malformed(`PNG contains an unknown critical chunk (${type})`);
    }
    if (PNG_METADATA.has(type))
      report.removed.add(type === 'eXIf' ? 'EXIF metadata (incl. GPS)' : 'text metadata');
    else kept.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  const trailer = b.subarray(i);
  if (trailer.some((v) => v !== 0)) {
    const payload = executablePayload(trailer);
    if (payload) report.threats.push(`${payload} hidden after the end of the image`);
    report.removed.add('data after end of image');
  }
  return concatBytes(kept);
}

/* ── PDF ──────────────────────────────────────────────────────────── */

/** Action types (`/S`) that run code, launch programs or send or receive data. */
const PDF_DANGEROUS_ACTIONS: Record<string, string> = {
  JavaScript: 'JavaScript action',
  Launch: 'launch action (runs an external program)',
  ImportData: 'data import action',
  SubmitForm: 'form submission action',
  Rendition: 'multimedia rendition action',
};
/** Keys whose presence means active or embedded content. */
const PDF_DANGEROUS_KEYS: Record<string, string> = {
  JS: 'embedded JavaScript',
  JavaScript: 'embedded JavaScript',
  EmbeddedFile: 'embedded file',
  EmbeddedFiles: 'embedded files',
  RichMedia: 'RichMedia (Flash/multimedia) content',
  XFA: 'XFA form scripting',
};
const PDF_METADATA_KEYS = ['Metadata', 'PieceInfo'];

async function sanitizePdf(b: Uint8Array, report: Report): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(b, {
      updateMetadata: false,
      throwOnInvalidObject: true,
      ignoreEncryption: true,
    });
  } catch {
    report.malformed('PDF structure is corrupt and cannot be inspected');
  }
  if (doc.isEncrypted) report.malformed('PDF is password-protected and cannot be inspected');

  const found = new Set<string>();
  // Walks direct objects only; indirect references are visited by enumerateIndirectObjects.
  const visit = (obj: PDFObject | undefined, depth: number) => {
    if (depth > 64) report.malformed('PDF object nesting is too deep');
    const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (dict) {
      const action = dict.get(PDFName.of('S'));
      const actionName = action instanceof PDFName ? action.decodeText() : '';
      if (PDF_DANGEROUS_ACTIONS[actionName]) found.add(PDF_DANGEROUS_ACTIONS[actionName]!);
      for (const key of dict.keys()) {
        const label = PDF_DANGEROUS_KEYS[key.decodeText()];
        if (label) found.add(label);
        visit(dict.get(key), depth + 1);
      }
      for (const key of PDF_METADATA_KEYS) {
        if (dict.delete(PDFName.of(key))) report.removed.add('XMP/application metadata');
      }
    } else if (obj instanceof PDFArray) {
      for (let k = 0; k < obj.size(); k++) visit(obj.get(k), depth + 1);
    }
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) visit(obj, 0);
  report.threats.push(...found);

  if (doc.context.trailerInfo.Info) {
    delete doc.context.trailerInfo.Info;
    report.removed.add('document info (author, title, producer…)');
  }
  return doc.save({ updateFieldAppearances: false });
}

/* ── DICOM ────────────────────────────────────────────────────────── */

/** Patient-identity attributes blanked in place (subset of PS3.15 Annex E Table E.1-1). */
const DICOM_IDENTITY_TAGS = new Map<number, string>([
  [0x00100010, 'Patient Name'],
  [0x00100020, 'Patient ID'],
  [0x00100021, 'Issuer of Patient ID'],
  [0x00100030, 'Patient Birth Date'],
  [0x00100032, 'Patient Birth Time'],
  [0x00100040, 'Patient Sex'],
  [0x00101000, 'Other Patient IDs'],
  [0x00101001, 'Other Patient Names'],
  [0x00101005, 'Patient Birth Name'],
  [0x00101010, 'Patient Age'],
  [0x00101040, 'Patient Address'],
  [0x00101060, 'Patient Mother Birth Name'],
  [0x00102154, 'Patient Telephone Numbers'],
  [0x00102160, 'Ethnic Group'],
  [0x00104000, 'Patient Comments'],
  [0x00080050, 'Accession Number'],
  [0x00080080, 'Institution Name'],
  [0x00080081, 'Institution Address'],
  [0x00080090, 'Referring Physician Name'],
  [0x00081048, 'Physicians of Record'],
  [0x00081050, 'Performing Physician Name'],
  [0x00081070, 'Operators Name'],
  [0x00081010, 'Station Name'],
  [0x00181000, 'Device Serial Number'],
  [0x00200010, 'Study ID'],
]);
/** VRs whose values are text, so they are blanked with spaces (the DICOM padding character). */
const DICOM_TEXT_VRS = new Set([
  'AE',
  'AS',
  'CS',
  'DA',
  'DS',
  'DT',
  'IS',
  'LO',
  'LT',
  'PN',
  'SH',
  'ST',
  'TM',
  'UC',
  'UT',
]);
/** VRs with a 2-byte reserved field and 32-bit length in explicit VR (PS3.5 §7.1.2). */
const DICOM_LONG_VRS = new Set([
  'OB',
  'OD',
  'OF',
  'OL',
  'OV',
  'OW',
  'SQ',
  'SV',
  'UC',
  'UN',
  'UR',
  'UT',
  'UV',
]);
const UNDEFINED_LENGTH = 0xffffffff;
const ITEM = 0xfffee000;
const ITEM_DELIMITATION = 0xfffee00d;
const SEQUENCE_DELIMITATION = 0xfffee0dd;
const PIXEL_DATA = 0x7fe00010;
const TRANSFER_SYNTAX_UID = 0x00020010;
const IMPLICIT_VR_LE = '1.2.840.10008.1.2';
const EXPLICIT_VR_BE = '1.2.840.10008.1.2.2';
const DEFLATED_EXPLICIT_VR_LE = '1.2.840.10008.1.2.1.99';

function sanitizeDicom(b: Uint8Array, report: Report): Uint8Array {
  const out = b.slice();
  const view = new DataView(out.buffer);
  if (out.length < 132 || ascii(out, 128, 4) !== 'DICM')
    report.malformed('DICOM file is missing its "DICM" prefix');

  // CVE-2019-11687: the free-form preamble can carry a PE/ELF executable (DICOM polyglot).
  const preamble = out.subarray(0, 128);
  if (preamble.some((v) => v !== 0)) {
    const payload = executablePayload(preamble);
    if (payload) report.threats.push(`${payload} in the DICOM preamble`);
    preamble.fill(0);
    report.removed.add('DICOM preamble data');
  }

  // The File Meta group is always explicit VR little endian; its transfer syntax selects the dataset encoding.
  let explicit = true;
  let le = true;
  let datasetExplicit = true;
  let datasetLittleEndian = true;
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);
  const tagAt = (o: number) => ((u16(o) << 16) | u16(o + 2)) >>> 0;
  const need = (o: number, n: number) => {
    if (o + n > out.length) report.malformed('DICOM element runs past the end of the file');
  };

  /**
   * Walks elements from `pos` to `end`, or until `stopTag` (an item or sequence
   * delimiter) for undefined-length containers. Returns the position after the
   * last element consumed.
   */
  const walk = (
    pos: number,
    end: number,
    stopTag: number | null,
    depth: number,
    metaOnly = false,
  ): number => {
    if (depth > 32) report.malformed('DICOM sequences are nested too deeply');
    while (pos < end) {
      need(pos, 8);
      const tag = tagAt(pos);
      if (metaOnly && tag >>> 16 !== 0x0002) return pos;
      if (tag === stopTag) return pos + 8;

      let vr: string | null = null;
      let length: number;
      let header: number;
      if (explicit && tag >>> 16 !== 0xfffe) {
        vr = ascii(out, pos + 4, 2);
        if (!/^[A-Z]{2}$/.test(vr))
          report.malformed('DICOM element has an invalid value representation');
        if (DICOM_LONG_VRS.has(vr)) {
          need(pos, 12);
          length = u32(pos + 8);
          header = 12;
        } else {
          length = u16(pos + 6);
          header = 8;
        }
      } else {
        length = u32(pos + 4);
        header = 8;
      }
      const value = pos + header;

      if (length === UNDEFINED_LENGTH) {
        if (tag === PIXEL_DATA) {
          // Encapsulated pixel data: defined-length fragments until the sequence delimiter.
          let p = value;
          for (;;) {
            need(p, 8);
            const fragTag = tagAt(p);
            const fragLen = u32(p + 4);
            if (fragTag === SEQUENCE_DELIMITATION) {
              pos = p + 8;
              break;
            }
            if (fragTag !== ITEM || fragLen === UNDEFINED_LENGTH)
              report.malformed('DICOM pixel data fragments are corrupt');
            need(p + 8, fragLen);
            p += 8 + fragLen;
          }
        } else {
          // An explicit-VR UN of undefined length holds an implicit VR little endian sequence (PS3.5 §6.2.2).
          const outer = explicit;
          if (vr === 'UN') explicit = false;
          pos = walkItems(value, out.length, SEQUENCE_DELIMITATION, depth + 1);
          explicit = outer;
        }
        continue;
      }

      need(value, length);
      // Implicit VR carries no VR: a value that starts with an Item tag can only be a sequence.
      const implicitSequence = vr === null && length >= 8 && tagAt(value) === ITEM;
      if (vr === 'SQ' || implicitSequence) {
        walkItems(value, value + length, null, depth + 1);
      } else if (metaOnly && tag === TRANSFER_SYNTAX_UID) {
        const uid = ascii(out, value, length).replace(/[\0 ]+$/, '');
        if (uid === DEFLATED_EXPLICIT_VR_LE)
          report.malformed('deflate-compressed DICOM datasets cannot be inspected');
        datasetExplicit = uid !== IMPLICIT_VR_LE;
        datasetLittleEndian = uid !== EXPLICIT_VR_BE;
      } else {
        const label = DICOM_IDENTITY_TAGS.get(tag);
        // Private data elements (odd group, element > 0x00FF) may hold identity text; private creators are kept.
        // Without a VR (implicit syntax), a value that is entirely printable ASCII is treated as text.
        const isPrivateData = (tag >>> 16) % 2 === 1 && (tag & 0xffff) > 0x00ff;
        const privateText =
          isPrivateData &&
          (vr !== null
            ? DICOM_TEXT_VRS.has(vr)
            : out
                .subarray(value, value + length)
                .every((c) => (c >= 0x20 && c <= 0x7e) || c === 0));
        if ((label || privateText) && length > 0) {
          out.fill(vr === null || DICOM_TEXT_VRS.has(vr) ? 0x20 : 0x00, value, value + length);
          report.removed.add(label ?? 'private text attributes');
        }
      }
      pos = value + length;
    }
    if (stopTag !== null) report.malformed('DICOM sequence is missing its delimiter');
    return pos;
  };

  /** Walks sequence items, each a nested dataset of defined or undefined length. */
  const walkItems = (pos: number, end: number, stopTag: number | null, depth: number): number => {
    while (pos < end) {
      need(pos, 8);
      const tag = tagAt(pos);
      const length = u32(pos + 4);
      if (tag === stopTag) return pos + 8;
      if (tag !== ITEM) report.malformed('DICOM sequence contains a non-item element');
      pos =
        length === UNDEFINED_LENGTH
          ? walk(pos + 8, out.length, ITEM_DELIMITATION, depth + 1)
          : (walk(pos + 8, pos + 8 + length, null, depth + 1), pos + 8 + length);
    }
    if (stopTag !== null) report.malformed('DICOM sequence is missing its delimiter');
    return pos;
  };

  const datasetStart = walk(132, out.length, null, 0, true);
  explicit = datasetExplicit;
  le = datasetLittleEndian;
  walk(datasetStart, out.length, null, 0);
  return out;
}

/* ── Entry point ──────────────────────────────────────────────────── */

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Identifies the format from magic bytes, so a renamed or mislabelled file cannot skip inspection. */
function detectFormat(b: Uint8Array): SanitizedFormat | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (PNG_SIGNATURE.every((v, i) => b[i] === v)) return 'png';
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  if (b.length >= 132 && ascii(b, 128, 4) === 'DICM') return 'dicom';
  return null;
}

const MIME_FOR: Record<SanitizedFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  dicom: 'application/dicom',
};

/**
 * Sanitizes a file before encryption. Time O(n) in file size (one structural
 * pass, plus pdf-lib's parse and rewrite for PDFs); space O(n) for the cleaned copy.
 * @throws {UnsafeFileError} If the file is unsupported, mislabelled, malformed,
 *   or carries executable, script or macro content.
 */
export async function sanitizeFile(file: File): Promise<SanitizedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = detectFormat(bytes);
  if (!format)
    throw new UnsafeFileError(['file content is not a supported JPEG, PNG, PDF or DICOM file']);
  if (file.type && file.type !== MIME_FOR[format]) {
    throw new UnsafeFileError([
      `file claims to be ${file.type} but its content is ${format.toUpperCase()}`,
    ]);
  }

  const report = new Report();
  const clean =
    format === 'jpeg'
      ? sanitizeJpeg(bytes, report)
      : format === 'png'
        ? sanitizePng(bytes, report)
        : format === 'pdf'
          ? await sanitizePdf(bytes, report)
          : sanitizeDicom(bytes, report);
  if (report.threats.length > 0) throw new UnsafeFileError(report.threats);

  return {
    file: new File([clean as Uint8Array<ArrayBuffer>], file.name, { type: MIME_FOR[format] }),
    format,
    removed: [...report.removed],
  };
}
