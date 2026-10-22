'use client';

import { memo, useState } from 'react';
import type { MedicalRecord } from '@/types';
import { shareRecord } from '@/services/api.service';
import RecordDetailDrawer from './RecordDetailDrawer';
import { useToast } from '@/hooks/useToast';
import { useContactResolver } from '@/hooks/useAddressBook';
import { resolveAddressInput } from '@/lib/addressBook';
import ContactAddressInput from '@/components/contacts/ContactAddressInput';
import ResolvedAddress from '@/components/contacts/ResolvedAddress';

interface Props {
  record: MedicalRecord;
}

function RecordCard({ record }: Props) {
  const { toast } = useToast();
  const [showDrawer, setShowDrawer] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [showShareForm, setShowShareForm] = useState(false);
  const [provider, setProvider] = useState('');
  const [shareInfo, setShareInfo] = useState<{
    token: string;
    expiresAt: string;
    providerAddress: string;
  } | null>(null);

  async function handleShare() {
    const providerAddress = resolveAddressInput(provider, contacts);
    if (!providerAddress) {
      toast('Enter a valid Stellar address or the name of a trusted contact.', 'error');
      return;
    }
    setSharing(true);
    try {
      const result = await shareRecord(record.id, providerAddress);
      setShareInfo({ token: result.token, expiresAt: result.expiresAt, providerAddress });
      setShowShareForm(false);
      setProvider('');
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
            Shared with <ResolvedAddress address={shareInfo.providerAddress} />
            <br />
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
            onClick={() => setShowShareForm((open) => !open)}
            disabled={sharing}
            aria-expanded={showShareForm}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-1 hover:bg-surface-hover disabled:opacity-50"
          >
            Share
          </button>
        </div>

        {showShareForm && (
          <form
            className="mt-3 flex items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleShare();
            }}
          >
            <ContactAddressInput
              id={`share-provider-${record.id}`}
              label="Provider Stellar address"
              value={provider}
              onChange={setProvider}
            />
            <button
              type="submit"
              disabled={sharing || !provider.trim()}
              className="rounded-md bg-green px-3 py-2 text-xs font-medium text-[#030D09] hover:bg-green-600 disabled:opacity-50"
            >
              {sharing ? 'Sharing…' : 'Generate token'}
            </button>
          </form>
        )}
      </div>

      {showDrawer && <RecordDetailDrawer record={record} onClose={() => setShowDrawer(false)} />}
    </>
  );
}

export default memo(RecordCard);
