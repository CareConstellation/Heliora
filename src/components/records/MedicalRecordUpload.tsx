'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { encryptFile, exportKey, hashBuffer } from '@/lib/crypto';
import { sanitizeFile, UnsafeFileError } from '@/lib/fileSanitizer';
import { computeCid } from '@/lib/ipfs';
import {
  createIpfsUploadUrl,
  uploadCiphertextToIpfs,
  uploadEncryptedRecord,
} from '@/services/api.service';
import { useToast } from '@/hooks/useToast';
import type { EncryptedRecord } from '@/types';

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'application/dicom'];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
// Browsers usually report DICOM scans with an empty MIME type; the sanitizer checks the real format from the bytes.
const isAccepted = (file: File) => ACCEPTED.includes(file.type) || /\.dcm$/i.test(file.name);

interface Props {
  patientAddress: string;
  onUploaded?: (record: EncryptedRecord) => void;
}

export default function MedicalRecordUpload({ patientAddress, onUploaded }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<'idle' | 'sanitizing' | 'encrypting' | 'uploading'>(
    'idle',
  );
  const [threats, setThreats] = useState<string[]>([]);

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      // Validate
      if (!isAccepted(file)) {
        throw new Error('Unsupported file type. Please upload a PDF, JPEG, PNG, or DICOM file.');
      }
      if (file.size > MAX_BYTES) {
        throw new Error('File exceeds the 10 MB limit.');
      }

      // Strip identifying metadata and reject active or malformed content before encryption
      setThreats([]);
      setProgress('sanitizing');
      const sanitized = await sanitizeFile(file);

      // Encrypt
      setProgress('encrypting');
      const { encryptedBuffer, iv, key } = await encryptFile(sanitized.file);
      const exportedKey = await exportKey(key);
      const contentHash = await hashBuffer(encryptedBuffer);
      const { cid } = await computeCid(new Uint8Array(encryptedBuffer));

      // Upload the ciphertext to IPFS; the pinning service must return the CID computed locally
      setProgress('uploading');
      const pinnedCid = await uploadCiphertextToIpfs(
        await createIpfsUploadUrl(),
        new Blob([encryptedBuffer]),
      );
      if (pinnedCid !== cid) {
        throw new Error(
          'IPFS returned a CID that does not match the encrypted file. Upload aborted.',
        );
      }

      const formData = new FormData();
      formData.append('patientAddress', patientAddress);
      formData.append('fileName', file.name);
      formData.append('fileType', sanitized.file.type);
      formData.append('contentHash', contentHash);
      formData.append('cid', cid);
      formData.append('iv', new Blob([iv.buffer as ArrayBuffer]));
      formData.append('exportedKey', new Blob([exportedKey as ArrayBuffer]));

      const record = await uploadEncryptedRecord(formData);
      return { record, removed: sanitized.removed };
    },
    onSuccess: ({ record, removed }) => {
      setProgress('idle');
      toast(
        removed.length > 0
          ? `Record encrypted and uploaded. Removed: ${removed.join(', ')}.`
          : 'Record uploaded and encrypted successfully.',
        'success',
      );
      // Optimistic: invalidate records query so the list refreshes
      void queryClient.invalidateQueries({ queryKey: ['encryptedRecords', patientAddress] });
      onUploaded?.(record);
      if (inputRef.current) inputRef.current.value = '';
    },
    onError: (err: Error) => {
      setProgress('idle');
      if (err instanceof UnsafeFileError) setThreats(err.threats);
      toast(err.message || 'Upload failed. Please try again.', 'error');
      console.error('[MedicalRecordUpload]', err);
    },
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) mutation.mutate(file);
  }

  const busy = mutation.isPending;

  return (
    <div className="rounded-xl border-2 border-dashed border-border bg-surface-card p-6 text-center">
      <p className="text-3xl mb-2">🔒</p>
      <p className="font-medium text-text-1">Upload Encrypted Medical Record</p>
      <p className="text-xs text-text-3 mt-1">
        PDF, JPEG, PNG or DICOM · max 10 MB · metadata stripped and encrypted before upload
      </p>

      {progress !== 'idle' && (
        <p className="mt-3 text-sm text-green animate-pulse">
          {progress === 'sanitizing'
            ? 'Removing identifying metadata…'
            : progress === 'encrypting'
              ? 'Encrypting file…'
              : 'Uploading to IPFS…'}
        </p>
      )}

      {threats.length > 0 && (
        <div role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-left text-xs text-red-700">
          <p className="font-semibold">This file was blocked for your safety:</p>
          <ul className="mt-1 list-disc pl-4">
            {threats.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="mt-4 rounded-md bg-green px-4 py-2 text-sm font-medium text-[#030D09] hover:bg-green-600 disabled:opacity-50"
      >
        {busy ? 'Processing…' : 'Choose File'}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.dcm"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}
