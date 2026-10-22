'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StrKey } from '@stellar/stellar-sdk';
import {
  addEnvelopeRecipient,
  loadOrCreateRecipientKeyPair,
  removeEnvelopeRecipient,
  unwrapDataKey,
  type EnvelopeHeader,
} from '@/lib/crypto';
import {
  addEnvelopeRecipientEntry,
  fetchEncryptionPublicKey,
  fetchEnvelopeHeader,
  removeEnvelopeRecipientEntry,
} from '@/services/api.service';
import { useToast } from '@/hooks/useToast';
import { useWalletStore } from '@/store/useWalletStore';
import { useContactResolver } from '@/hooks/useAddressBook';
import { resolveAddressInput } from '@/lib/addressBook';
import ContactAddressInput from '@/components/contacts/ContactAddressInput';
import ResolvedAddress from '@/components/contacts/ResolvedAddress';

interface Props {
  recordId: string;
}

/**
 * Manages who can decrypt an encrypted record. Adding a recipient unwraps the DEK
 * locally and wraps it to the new recipient's public key. Removing a recipient drops
 * their header entry. In both cases only the envelope header changes; the ciphertext
 * body is never re-encrypted or re-uploaded.
 */
export default function EnvelopeRecipients({ recordId }: Props) {
  const { publicKey } = useWalletStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [address, setAddress] = useState('');
  const { contacts } = useContactResolver();
  const queryKey = ['envelopeHeader', recordId];

  const {
    data: header,
    isLoading,
    isError,
  } = useQuery({
    queryKey,
    queryFn: () => fetchEnvelopeHeader(recordId),
  });

  const onUpdated = (next: EnvelopeHeader, message: string) => {
    queryClient.setQueryData(queryKey, next);
    toast(message, 'success');
  };

  const addMutation = useMutation({
    mutationFn: async (recipientId: string) => {
      if (!header || !publicKey) throw new Error('Connect your wallet to share this record.');
      if (!StrKey.isValidEd25519PublicKey(recipientId)) {
        throw new Error('Enter a valid Stellar address (G…).');
      }
      const [dek, recipientKey] = await Promise.all([
        loadOrCreateRecipientKeyPair(publicKey).then((keyPair) =>
          unwrapDataKey(header, publicKey, keyPair),
        ),
        fetchEncryptionPublicKey(recipientId),
      ]);
      const next = await addEnvelopeRecipient(header, dek, {
        id: recipientId,
        publicKey: recipientKey,
      });
      return addEnvelopeRecipientEntry(recordId, next.recipients[next.recipients.length - 1]!);
    },
    onSuccess: (next) => {
      setAddress('');
      onUpdated(next, 'Recipient added.');
    },
    onError: (err: Error) => toast(err.message || 'Could not add recipient.', 'error'),
  });

  const removeMutation = useMutation({
    mutationFn: async (recipientId: string) => {
      if (!header) throw new Error('Record header not loaded.');
      removeEnvelopeRecipient(header, recipientId); // rejects removing the last recipient
      return removeEnvelopeRecipientEntry(recordId, recipientId);
    },
    onSuccess: (next) => onUpdated(next, 'Recipient removed.'),
    onError: (err: Error) => toast(err.message || 'Could not remove recipient.', 'error'),
  });

  if (isLoading) return <div className="animate-pulse h-20 rounded-xl bg-surface-card" />;
  if (isError || !header)
    return <p className="text-sm text-red-600">Could not load record access.</p>;

  const busy = addMutation.isPending || removeMutation.isPending;

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-xl border border-border">
        {header.recipients.map((r) => (
          <li key={r.id} className="flex items-center justify-between px-3 py-2 text-xs">
            <span className="text-text-1">
              <ResolvedAddress address={r.id} />
              {r.id === publicKey && <span className="ml-2 text-text-3">(you)</span>}
            </span>
            {r.id !== publicKey && (
              <button
                onClick={() => removeMutation.mutate(r.id)}
                disabled={busy}
                aria-label={`Remove recipient ${r.id}`}
                className="rounded-md border border-border px-2 py-1 text-text-1 hover:bg-surface-hover disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addMutation.mutate(resolveAddressInput(address, contacts) ?? address.trim());
        }}
      >
        <ContactAddressInput
          id={`recipient-${recordId}`}
          label="Recipient Stellar address"
          value={address}
          onChange={setAddress}
          placeholder="Provider Stellar address (G…) or contact name"
        />
        <button
          type="submit"
          disabled={busy || !address.trim()}
          className="rounded-md bg-green px-3 py-2 text-xs font-medium text-[#030D09] hover:bg-green-600 disabled:opacity-50"
        >
          {addMutation.isPending ? 'Sharing…' : 'Share'}
        </button>
      </form>
    </div>
  );
}
