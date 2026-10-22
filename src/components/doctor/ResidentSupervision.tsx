'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StrKey } from '@stellar/stellar-sdk';
import { CheckCircle2, FileSignature, Loader2, UserCheck } from 'lucide-react';
import { createSupervisorCosignature } from '@/lib/delegatedProxy';
import { freighterMessageSigner, type MessageSigner } from '@/lib/stellar';
import {
  fetchProxyEncounterDrafts,
  requestDelegatedProxyToken,
  submitSupervisorCosignature,
} from '@/services/api.service';
import { useProxyStore } from '@/store/proxyStore';
import { useWalletStore } from '@/store/useWalletStore';
import type { EncounterDraft } from '@/types';

const errorText = (err: unknown, fallback: string) =>
  typeof err === 'object' &&
  err &&
  'message' in err &&
  typeof err.message === 'string' &&
  err.message
    ? err.message
    : fallback;

const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

const STATUS_BADGE: Record<EncounterDraft['status'], { className: string; label: string }> = {
  pending_cosign: { className: 'badge-muted', label: 'awaiting co-signature' },
  cosigned: { className: 'badge-green', label: 'co-signed' },
  returned: { className: 'badge-red', label: 'returned' },
};

/**
 * Lets an attending physician start a delegated proxy session for a resident,
 * review the resident's consultation note drafts, and approve them with a
 * wallet co-signature that the backend logs.
 */
export default function ResidentSupervision({
  signMessage = freighterMessageSigner,
}: {
  signMessage?: MessageSigner;
}) {
  const { publicKey } = useWalletStore();
  const { activeToken, cosignatureLog, enterProxyMode, logCosignature } = useProxyStore();
  const queryClient = useQueryClient();
  const [residentAddress, setResidentAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const startMutation = useMutation({
    mutationFn: async (resident: string) => {
      if (!publicKey) throw new Error('Connect your wallet to supervise a resident.');
      if (!StrKey.isValidEd25519PublicKey(resident)) {
        throw new Error('Enter the resident’s Stellar address (G…).');
      }
      if (resident === publicKey) throw new Error('You cannot supervise your own account.');
      const token = await requestDelegatedProxyToken(publicKey, resident);
      if (token.supervisorAddress !== publicKey || token.residentAddress !== resident) {
        throw new Error('The proxy token was issued for different accounts.');
      }
      if (!enterProxyMode(token)) throw new Error('The proxy token is already expired.');
      return token;
    },
    onSuccess: () => {
      setResidentAddress('');
      setError(null);
    },
    onError: (err) => setError(errorText(err, 'Could not start delegated proxy mode.')),
  });

  const draftsKey = ['proxy-drafts', activeToken?.tokenId];
  const { data: drafts, isLoading } = useQuery({
    queryKey: draftsKey,
    queryFn: () => fetchProxyEncounterDrafts(activeToken!.tokenId),
    enabled: !!activeToken,
  });

  const cosignMutation = useMutation({
    mutationFn: async (draft: EncounterDraft) => {
      if (!activeToken) throw new Error('Delegated proxy mode has ended.');
      const cosignature = await createSupervisorCosignature({
        draft,
        token: activeToken,
        signMessage,
      });
      const updated = await submitSupervisorCosignature(cosignature);
      return { cosignature, updated };
    },
    onSuccess: ({ cosignature, updated }) => {
      logCosignature(cosignature);
      queryClient.setQueryData<EncounterDraft[]>(draftsKey, (current) =>
        current?.map((draft) => (draft.id === updated.id ? updated : draft)),
      );
      setError(null);
    },
    onError: (err) => setError(errorText(err, 'Could not co-sign the draft.')),
  });

  const card = { background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' };

  if (!activeToken) {
    return (
      <section aria-label="Resident supervision" className="rounded-[14px] p-5" style={card}>
        <div className="flex items-center gap-2 mb-1">
          <UserCheck className="w-4 h-4" style={{ color: '#00C896' }} />
          <h2 className="text-sm font-semibold text-text-1">Supervise a resident</h2>
        </div>
        <p className="text-xs text-text-3 mb-4">
          Review and co-sign consultation notes drafted by a resident under a temporary delegated
          proxy token.
        </p>
        <form
          className="flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            startMutation.mutate(residentAddress.trim());
          }}
        >
          <label htmlFor="resident-address" className="sr-only">
            Resident Stellar address
          </label>
          <input
            id="resident-address"
            value={residentAddress}
            onChange={(e) => setResidentAddress(e.target.value)}
            placeholder="Resident Stellar address (G…)"
            spellCheck={false}
            className="flex-1 rounded-[9px] px-3 py-2 text-xs font-mono text-text-1"
            style={{ background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.08)' }}
          />
          <button
            type="submit"
            disabled={!residentAddress.trim() || startMutation.isPending}
            className="btn-primary rounded-[9px] text-xs py-2 px-3.5 disabled:opacity-50"
          >
            {startMutation.isPending ? 'Starting…' : 'Enter proxy mode'}
          </button>
        </form>
        {error && (
          <p role="alert" className="text-xs text-red-400 mt-2">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section aria-label="Resident drafts" className="rounded-[14px] p-5" style={card}>
      <div className="flex items-center gap-2 mb-1">
        <FileSignature className="w-4 h-4" style={{ color: '#F59E0B' }} />
        <h2 className="text-sm font-semibold text-text-1">Drafts by {activeToken.residentName}</h2>
      </div>
      <p className="text-xs text-text-3 mb-4">
        Approving a draft signs its exact content with your wallet. Any later edit invalidates the
        co-signature.
      </p>

      {error && (
        <p role="alert" className="text-xs text-red-400 mb-3">
          {error}
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-text-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading drafts…
        </div>
      ) : !drafts?.length ? (
        <p className="text-xs text-text-2">No drafts are waiting for review.</p>
      ) : (
        <ul className="space-y-3">
          {drafts.map((draft) => {
            const badge = STATUS_BADGE[draft.status];
            const signing = cosignMutation.isPending && cosignMutation.variables?.id === draft.id;
            return (
              <li
                key={draft.id}
                className="rounded-[10px] p-3.5"
                style={{
                  background: 'var(--bg-inset)',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-xs font-semibold text-text-1">
                    {draft.patientName ?? short(draft.patientAddress)}
                    <span className="text-text-3 font-normal">
                      {' '}
                      · {new Date(draft.createdAt).toLocaleString()}
                    </span>
                  </p>
                  <span className={badge.className}>{badge.label}</span>
                </div>
                <p className="text-xs text-text-2 whitespace-pre-wrap leading-relaxed">
                  {draft.content}
                </p>
                {draft.status === 'pending_cosign' && (
                  <button
                    type="button"
                    onClick={() => cosignMutation.mutate(draft)}
                    disabled={cosignMutation.isPending}
                    className="btn-primary rounded-[8px] text-xs py-1.5 px-3 mt-3 disabled:opacity-50"
                    aria-label={`Approve and co-sign draft ${draft.id}`}
                  >
                    {signing ? 'Signing…' : 'Approve & co-sign'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {cosignatureLog.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold text-text-1 mb-2">Co-signature log</h3>
          <ul aria-label="Co-signature log" className="space-y-1.5">
            {cosignatureLog.map((entry) => (
              <li
                key={`${entry.draftId}-${entry.signedAt}`}
                className="flex items-center gap-2 text-2xs text-text-2 font-mono"
              >
                <CheckCircle2 className="w-3 h-3 shrink-0" style={{ color: '#00C896' }} />
                <span>{entry.draftId}</span>
                <span className="text-text-3">{new Date(entry.signedAt).toLocaleString()}</span>
                <span className="text-text-3 truncate" title={entry.contentHash}>
                  sha256 {entry.contentHash.slice(0, 12)}…
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
