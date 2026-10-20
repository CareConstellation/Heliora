/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { sanitizeFile, UnsafeFileError } from '@/lib/fileSanitizer';
import { validateRow } from '@/lib/bulkRecordParser';

// Fixtures were generated with Pillow/piexif (JPEG, PNG) and pydicom 3.0 (DICOM); see implementation.md.
const fixture = (name: string, type = '') =>
  new File([new Uint8Array(readFileSync(join(__dirname, 'fixtures/sanitizer', name)))], name, {
    type,
  });
const bytesOf = async (file: File) => Buffer.from(await file.arrayBuffer());

async function rejection(file: File): Promise<string[]> {
  try {
    await sanitizeFile(file);
  } catch (err) {
    if (err instanceof UnsafeFileError) return err.threats;
    throw err;
  }
  throw new Error('expected the file to be rejected');
}

describe('JPEG (#29)', () => {
  it('removes GPS, camera serials, owner name, maker notes, XMP and comments', async () => {
    const result = await sanitizeFile(fixture('exif-gps.jpg', 'image/jpeg'));
    const out = await bytesOf(result.file);

    expect(result.format).toBe('jpeg');
    expect(result.removed).toEqual(
      expect.arrayContaining([
        'GPS location',
        'camera serial number',
        'lens serial number',
        'camera owner name',
        'camera maker notes',
        'XMP metadata',
        'image comments',
      ]),
    );
    for (const secret of [
      'SN-CAM-998877',
      'LENS-112233',
      'Dr Jane Roe',
      'VENDOR-SERIAL',
      'John Doe',
      'xmpmeta',
    ]) {
      expect(out.includes(secret)).toBe(false);
    }
    expect(out.includes('Canon')).toBe(true); // non-identifying EXIF (make, orientation) is kept
    expect([out[0], out[1], out[out.length - 2], out[out.length - 1]]).toEqual([
      0xff, 0xd8, 0xff, 0xd9,
    ]);
  });

  it('blocks an executable hidden after the end-of-image marker (polyglot)', async () => {
    expect(await rejection(fixture('polyglot.jpg', 'image/jpeg'))).toEqual([
      'Windows executable (MZ) hidden after the end of the image',
    ]);
  });

  it('blocks truncated JPEG data', async () => {
    const full = await bytesOf(fixture('exif-gps.jpg'));
    expect(
      (
        await rejection(new File([new Uint8Array(full.subarray(0, full.length - 40))], 'cut.jpg'))
      )[0],
    ).toMatch(/JPEG/);
  });
});

describe('PNG (#29)', () => {
  it('removes eXIf and text chunks and keeps a valid image', async () => {
    const result = await sanitizeFile(fixture('metadata.png', 'image/png'));
    const out = await bytesOf(result.file);

    expect(result.removed).toEqual(['EXIF metadata (incl. GPS)', 'text metadata']);
    expect(out.includes('eXIf')).toBe(false);
    expect(out.includes('Dr Jane Roe')).toBe(false);
    expect(out.subarray(out.length - 8, out.length - 4).toString()).toBe('IEND');
  });

  it('blocks a chunk with a bad CRC as a malformed segment', async () => {
    expect(await rejection(fixture('bad-crc.png', 'image/png'))).toEqual([
      'PNG tEXt chunk failed its CRC check',
    ]);
  });
});

describe('DICOM (#29)', () => {
  const identity = [
    'Doe^John',
    'MRN-0042',
    '19800102',
    'Marina Rd',
    'Heliora General',
    'CT-SN-7788',
    'Roe^Jane',
  ];

  it.each(['explicit-le.dcm', 'implicit-le.dcm'])(
    'blanks patient identity headers, nested sequences and private text in %s',
    async (name) => {
      const source = await bytesOf(fixture(name));
      const result = await sanitizeFile(fixture(name));
      const out = await bytesOf(result.file);

      expect(result.format).toBe('dicom');
      expect(out.length).toBe(source.length); // values are blanked in place, so no offsets move
      for (const value of [...identity, 'ALT-ID-555', 'Lagos Clinic', 'Private: John Doe']) {
        expect(out.includes(value)).toBe(false);
      }
      expect(out.includes('CT CHEST')).toBe(true); // clinical attributes are kept
      expect(out.includes('HELIORA TEST')).toBe(true); // private creator is kept
      expect(out.subarray(out.length - 4)).toEqual(source.subarray(source.length - 4)); // pixel data untouched
    },
  );

  it('handles undefined-length sequences and encapsulated pixel data', async () => {
    const result = await sanitizeFile(fixture('encapsulated-undefined.dcm'));
    const out = await bytesOf(result.file);
    expect(result.removed).toEqual(['Patient Name', 'Patient ID']);
    expect(out.includes('ALT-ID-555')).toBe(false);
    expect(out.includes('FAKEJPEGFRAME')).toBe(true);
  });

  it('blocks an executable embedded in the 128-byte preamble (CVE-2019-11687)', async () => {
    expect(await rejection(fixture('preamble-pe.dcm'))).toEqual([
      'Windows executable (MZ) in the DICOM preamble',
    ]);
  });

  it('blocks a dataset that runs past the end of the file', async () => {
    const full = await bytesOf(fixture('explicit-le.dcm'));
    expect(
      await rejection(new File([new Uint8Array(full.subarray(0, full.length - 3))], 'cut.dcm')),
    ).toEqual(['DICOM element runs past the end of the file']);
  });
});

describe('PDF (#29)', () => {
  it('removes document info metadata without adding a producer of its own', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.setAuthor('Dr Jane Roe');
    doc.setTitle('John Doe MRI');
    const result = await sanitizeFile(
      new File([new Uint8Array(await doc.save())], 'r.pdf', { type: 'application/pdf' }),
    );
    const out = await bytesOf(result.file);

    expect(result.removed).toContain('document info (author, title, producer…)');
    for (const s of ['Dr Jane Roe', 'John Doe', 'pdf-lib'])
      expect(out.toString('latin1').includes(s)).toBe(false);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });

  it('blocks JavaScript actions and embedded files', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.catalog.set(
      PDFName.of('OpenAction'),
      doc.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }),
    );
    await doc.attach(new Uint8Array([0x4d, 0x5a]), 'payload.exe', {
      mimeType: 'application/octet-stream',
    });

    expect(
      await rejection(
        new File([new Uint8Array(await doc.save())], 'e.pdf', { type: 'application/pdf' }),
      ),
    ).toEqual(
      expect.arrayContaining(['JavaScript action', 'embedded JavaScript', 'embedded files']),
    );
  });

  it('blocks a launch action', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.catalog.set(
      PDFName.of('OpenAction'),
      doc.context.obj({ S: 'Launch', F: PDFString.of('cmd.exe') }),
    );
    expect(await rejection(new File([new Uint8Array(await doc.save())], 'l.pdf'))).toEqual([
      'launch action (runs an external program)',
    ]);
  });
});

describe('format checks (#29)', () => {
  it('rejects content that does not match the declared file type', async () => {
    expect(await rejection(fixture('metadata.png', 'application/pdf'))).toEqual([
      'file claims to be application/pdf but its content is PNG',
    ]);
  });

  it('rejects unsupported content', async () => {
    expect(await rejection(new File(['MZ\x90\x00'], 'scan.pdf'))).toEqual([
      'file content is not a supported JPEG, PNG, PDF or DICOM file',
    ]);
  });
});

describe('bulk import macro detection (#29)', () => {
  it.each(['=HYPERLINK("http://x")', '+cmd|calc', '-2+3', '@SUM(A1)', '＝cmd'])(
    'flags spreadsheet formula %s',
    (value) => {
      const row = validateRow(
        { date: '2024-01-01', doctorName: 'Dr A', diagnosis: 'Flu', notes: value },
        0,
      );
      expect(row._valid).toBe(false);
      expect(row._errors).toContain('Possible spreadsheet formula (macro) in notes');
    },
  );

  it('accepts ordinary values', () => {
    expect(
      validateRow({ date: '2024-01-01', doctorName: 'Dr A', diagnosis: 'Flu (A-type)' }, 0)._valid,
    ).toBe(true);
  });
});
