'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  encryptFileToEnvelope,
  exportRecipientPublicKey,
  loadOrCreateRecipientKeyPair,
  serializeEnvelope,
  MAX_ENVELOPE_FILE_BYTES,
  type RecipientPublicKey,
} from '@/lib/crypto';
import {
  fetchEncryptionPublicKey,
  registerEncryptionPublicKey,
  uploadEncryptedRecord,
} from '@/services/api.service';
import { useToast } from '@/hooks/useToast';
import { useWalletStore } from '@/store/useWalletStore';
import type { EncryptedRecord } from '@/types';

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'application/dicom'];
// Browsers often report DICOM scans (CT/MRI) with an empty MIME type, so fall back to the extension.
const isAccepted = (file: File) => ACCEPTED.includes(file.type) || /\.dcm$/i.test(file.name);

/**
 * Recipients the DEK is wrapped to: the patient (owner) and the uploader, if different.
 * The connected wallet uses this device's key pair; any other recipient uses their registered key.
 */
async function resolveRecipients(
  patientAddress: string,
  uploader: string,
): Promise<RecipientPublicKey[]> {
  const ownKey = await exportRecipientPublicKey(await loadOrCreateRecipientKeyPair(uploader));
  await registerEncryptionPublicKey(uploader, ownKey);
  const recipients: RecipientPublicKey[] = [{ id: uploader, publicKey: ownKey }];
  if (patientAddress !== uploader) {
    recipients.push({
      id: patientAddress,
      publicKey: await fetchEncryptionPublicKey(patientAddress),
    });
  }
  return recipients;
}

interface Props {
  patientAddress: string;
  onUploaded?: (record: EncryptedRecord) => void;
}

export default function MedicalRecordUpload({ patientAddress, onUploaded }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { publicKey } = useWalletStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<'idle' | 'encrypting' | 'uploading'>('idle');
  const [percent, setPercent] = useState(0);

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      // Validate
      if (!isAccepted(file)) {
        throw new Error('Unsupported file type. Please upload a PDF, JPEG, PNG, or DICOM scan.');
      }
      if (file.size > MAX_ENVELOPE_FILE_BYTES) {
        throw new Error('File exceeds the 250 MB limit.');
      }
      if (!publicKey) throw new Error('Connect your wallet to upload records.');

      // Encrypt as a stream of 64 KiB chunks; the DEK is only ever sent wrapped per recipient.
      setPercent(0);
      setProgress('encrypting');
      const recipients = await resolveRecipients(patientAddress, publicKey);
      const { header, body, contentHash } = await encryptFileToEnvelope(
        file,
        recipients,
        setPercent,
      );

      setProgress('uploading');
      const formData = new FormData();
      formData.append('patientAddress', patientAddress);
      formData.append('fileName', file.name);
      formData.append('fileType', file.type || 'application/dicom');
      formData.append('contentHash', contentHash);
      formData.append('encryptedFile', serializeEnvelope(header, body), file.name);

      return uploadEncryptedRecord(formData);
    },
    onSuccess: (record) => {
      setProgress('idle');
      toast('Record uploaded and encrypted successfully.', 'success');
      // Optimistic: invalidate records query so the list refreshes
      queryClient.invalidateQueries({ queryKey: ['encryptedRecords', patientAddress] });
      onUploaded?.(record);
      if (inputRef.current) inputRef.current.value = '';
    },
    onError: (err: Error) => {
      setProgress('idle');
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
        PDF, JPEG, PNG or DICOM · max 250 MB · encrypted before upload
      </p>

      {progress === 'encrypting' && (
        <div className="mt-3">
          <div
            role="progressbar"
            aria-label="Encryption progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.floor(percent)}
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface-inset"
          >
            <div className="h-full bg-green transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-sm text-green">Encrypting file… {Math.floor(percent)}%</p>
        </div>
      )}
      {progress === 'uploading' && (
        <p className="mt-3 text-sm text-green animate-pulse">Uploading…</p>
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
