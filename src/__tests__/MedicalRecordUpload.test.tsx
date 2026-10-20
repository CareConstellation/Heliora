import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MedicalRecordUpload from '@/components/records/MedicalRecordUpload';

const mockToast = jest.fn();
jest.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock('@/lib/crypto', () => ({
  encryptFile: jest.fn(async () => ({
    encryptedBuffer: new Uint8Array([9, 9, 9]).buffer,
    iv: new Uint8Array(12),
    key: {},
  })),
  exportKey: jest.fn(async () => new Uint8Array(32).buffer),
  hashBuffer: jest.fn(async () => 'hash'),
}));
jest.mock('@/lib/ipfs', () => ({
  computeCid: jest.fn(async () => ({ cid: 'bafkreilocal', bytes: new Uint8Array() })),
}));
jest.mock('@/lib/fileSanitizer', () => {
  class UnsafeFileError extends Error {
    constructor(readonly threats: string[]) {
      super(`File rejected: ${threats.join('; ')}`);
    }
  }
  return { UnsafeFileError, sanitizeFile: jest.fn() };
});
jest.mock('@/services/api.service', () => ({
  createIpfsUploadUrl: jest.fn(async () => 'https://uploads.pinata.cloud/v3/files?signed'),
  uploadCiphertextToIpfs: jest.fn(),
  uploadEncryptedRecord: jest.fn(async () => ({ id: 'rec-1' })),
}));

const { sanitizeFile, UnsafeFileError } = jest.requireMock('@/lib/fileSanitizer');
const { uploadCiphertextToIpfs, uploadEncryptedRecord } =
  jest.requireMock('@/services/api.service');
const { encryptFile } = jest.requireMock('@/lib/crypto');

function upload(file: File) {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <MedicalRecordUpload patientAddress="GPATIENT" />
    </QueryClientProvider>,
  );
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
}

const scan = new File([new Uint8Array([1, 2, 3])], 'scan.jpg', { type: 'image/jpeg' });

describe('MedicalRecordUpload', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sanitizes before encrypting and registers the locally computed CID (#28, #29)', async () => {
    const clean = new File([new Uint8Array([4])], 'scan.jpg', { type: 'image/jpeg' });
    sanitizeFile.mockResolvedValueOnce({ file: clean, format: 'jpeg', removed: ['GPS location'] });
    uploadCiphertextToIpfs.mockResolvedValueOnce('bafkreilocal');

    upload(scan);

    await waitFor(() => expect(uploadEncryptedRecord).toHaveBeenCalled());
    expect(encryptFile).toHaveBeenCalledWith(clean);
    const form: FormData = uploadEncryptedRecord.mock.calls[0][0];
    expect(form.get('cid')).toBe('bafkreilocal');
    expect(form.get('encryptedFile')).toBeNull(); // ciphertext lives on IPFS, not in the backend upload
    expect(mockToast).toHaveBeenCalledWith(
      'Record encrypted and uploaded. Removed: GPS location.',
      'success',
    );
  });

  it('aborts when the pinning service returns a different CID (#28)', async () => {
    sanitizeFile.mockResolvedValueOnce({ file: scan, format: 'jpeg', removed: [] });
    uploadCiphertextToIpfs.mockResolvedValueOnce('bafkreisomethingelse');

    upload(scan);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringContaining('does not match the encrypted file'),
        'error',
      ),
    );
    expect(uploadEncryptedRecord).not.toHaveBeenCalled();
  });

  it('alerts the user and never encrypts a file with executable content (#29)', async () => {
    sanitizeFile.mockRejectedValueOnce(
      new UnsafeFileError(['Windows executable (MZ) hidden after the end of the image']),
    );

    upload(scan);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Windows executable (MZ) hidden after the end of the image',
    );
    expect(encryptFile).not.toHaveBeenCalled();
  });

  it('accepts DICOM files reported with an empty MIME type (#29)', async () => {
    sanitizeFile.mockResolvedValueOnce({
      file: new File([], 'ct.dcm', { type: 'application/dicom' }),
      format: 'dicom',
      removed: [],
    });
    uploadCiphertextToIpfs.mockResolvedValueOnce('bafkreilocal');

    upload(new File([new Uint8Array([0])], 'ct.dcm'));

    await waitFor(() => expect(uploadEncryptedRecord).toHaveBeenCalled());
  });
});
