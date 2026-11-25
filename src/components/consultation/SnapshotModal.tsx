'use client';

import { useEffect, useState } from 'react';
import {
  captureEncryptedSnapshot,
  serializeEncounterKey,
  serializeEncryptedSnapshot,
  SnapshotCaptureError,
  type EncryptedSnapshotRecord,
} from '@/lib/encounterSnapshot';

interface Props {
  appointmentId: string;
  /** True while a shared view is available to capture. */
  hasSource: boolean;
  /** Resolves the video element at capture time, so no ref is read during render. */
  getSource: () => HTMLVideoElement | null;
  /** Per-consultation AES-GCM key, or `null` while it is being created. */
  encounterKey: CryptoKey | null;
  snapshots: EncryptedSnapshotRecord[];
  onCaptured: (record: EncryptedSnapshotRecord) => void;
  onClose: () => void;
}

function downloadText(filename: string, contents: string) {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Captures the current frame of the shared view at native resolution and encrypts it
 * with the consultation key before it is stored or downloaded. The raw pixels never
 * leave the capture pipeline.
 */
export default function SnapshotModal({
  appointmentId,
  hasSource,
  getSource,
  encounterKey,
  snapshots,
  onCaptured,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCapture = hasSource && encounterKey !== null && !busy;

  const handleCapture = async () => {
    const source = getSource();
    if (!source || !encounterKey) {
      setError('Start screen sharing to capture a frame.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const record = await captureEncryptedSnapshot(source, encounterKey, appointmentId);
      onCaptured(record);
    } catch (err) {
      setError(
        err instanceof SnapshotCaptureError ? err.message : 'The snapshot could not be captured.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadSnapshot = (record: EncryptedSnapshotRecord) => {
    const stamp = record.capturedAt.replace(/[:.]/g, '-');
    downloadText(`heliora-snapshot-${appointmentId}-${stamp}.json`, serializeEncryptedSnapshot(record));
  };

  const handleDownloadKey = async () => {
    if (!encounterKey) return;
    const contents = await serializeEncounterKey(encounterKey, appointmentId);
    downloadText(`heliora-encounter-key-${appointmentId}.json`, contents);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="snapshot-modal-title"
        className="flex w-full max-w-md flex-col gap-4 rounded-xl bg-surface-card p-5 shadow-2xl"
      >
        <div>
          <h2 id="snapshot-modal-title" className="text-sm font-semibold text-text-1">
            Encrypted snapshot
          </h2>
          <p className="mt-1 text-xs text-text-3">
            Captures the current frame of the shared view at full resolution. The image is encrypted
            with this consultation&apos;s key before it is saved.
          </p>
        </div>

        {!hasSource && (
          <p className="text-xs text-text-2">Start screen sharing to capture a frame.</p>
        )}

        <button
          type="button"
          onClick={handleCapture}
          disabled={!canCapture}
          className="rounded-md bg-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Capturing…' : 'Capture snapshot'}
        </button>

        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}

        {snapshots.length > 0 && (
          <ul className="flex flex-col gap-2">
            {snapshots.map((record) => (
              <li
                key={record.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs text-text-2"
              >
                <span>
                  {record.width}×{record.height} · {new Date(record.capturedAt).toLocaleTimeString()}
                </span>
                <button
                  type="button"
                  onClick={() => handleDownloadSnapshot(record)}
                  className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-1 hover:bg-surface-hover"
                >
                  Download encrypted file
                </button>
              </li>
            ))}
          </ul>
        )}

        {snapshots.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-text-3">
              Store the encounter key apart from the snapshot files. Without it, the snapshots cannot be decrypted.
            </p>
            <button
              type="button"
              onClick={handleDownloadKey}
              disabled={!encounterKey}
              className="self-start rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-1 hover:bg-surface-hover disabled:opacity-50"
            >
              Download encounter key
            </button>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-1 hover:bg-surface-hover"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Visual capture indicator. Shown on the capturing side and on any other open view of
 * the same consultation that receives the capture notice. It clears itself after five seconds.
 */
export function CaptureNotice({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, 5_000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      role="status"
      className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-lg"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden="true" />
      {message}
    </div>
  );
}
