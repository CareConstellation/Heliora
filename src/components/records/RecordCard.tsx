'use client';

import { memo, useState } from 'react';
import type { MedicalRecord } from '@/types';
import { shareRecord } from '@/services/api.service';
import RecordDetailDrawer from './RecordDetailDrawer';
import { useToast } from '@/hooks/useToast';

interface Props {
  record: MedicalRecord;
}

function RecordCard({ record }: Props) {
  const { toast } = useToast();
  const [showDrawer, setShowDrawer] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareInfo, setShareInfo] = useState<{ token: string; expiresAt: string } | null>(null);

  async function handleShare() {
    const provider = prompt('Enter provider Stellar address:');
    if (!provider) return;
    setSharing(true);
    try {
      const result = await shareRecord(record.id, provider);
      setShareInfo({ token: result.token, expiresAt: result.expiresAt });
    } catch {
      toast('Failed to generate share token.', 'error');
    } finally {
      setSharing(false);
    }
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-surface-card p-4 shadow-card transition-shadow">
        <p className="text-xs text-text-3">{new Date(record.date).toLocaleDateString()}</p>
        <p className="mt-1 font-semibold text-text-1">{record.diagnosis}</p>
        <p className="text-sm text-text-2">Dr. {record.doctorName}</p>

        {shareInfo && (
          <div className="mt-2 rounded-md bg-green-50 p-2 text-xs text-green-700">
            Token: <span className="font-mono break-all">{shareInfo.token}</span>
            <br />
            Expires: {new Date(shareInfo.expiresAt).toLocaleString()}
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setShowDrawer(true)}
            className="rounded-md bg-green px-3 py-1.5 text-xs font-medium text-[#030D09] hover:bg-green-600"
          >
            View
          </button>
          <button
            onClick={handleShare}
            disabled={sharing}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-1 hover:bg-surface-hover disabled:opacity-50"
          >
            {sharing ? 'Sharing…' : 'Share'}
          </button>
        </div>
      </div>

      {showDrawer && <RecordDetailDrawer record={record} onClose={() => setShowDrawer(false)} />}
    </>
  );
}

export default memo(RecordCard);
