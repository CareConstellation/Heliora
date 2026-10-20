'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { decryptFile } from '@/lib/crypto';
import { cidToString, fetchVerifiedCiphertext, probeGateways, readOnChainCid } from '@/lib/ipfs';
import { fetchRecordIpfsStorage, fetchRecordKeyMaterial } from '@/services/api.service';
import { useWalletStore } from '@/store/useWalletStore';
import type { IpfsPinStatus } from '@/types';

const PIN_BADGE: Record<IpfsPinStatus, { className: string; label: string }> = {
  pinned: { className: 'bg-green-50 text-green-700', label: 'Pinned' },
  queued: { className: 'bg-yellow-50 text-yellow-700', label: 'Pinning…' },
  failed: { className: 'bg-red-50 text-red-700', label: 'Pin failed' },
};

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

/**
 * IPFS storage details for a record. Shows the pinning status and per-gateway
 * latency, and offers a download that decrypts only after the bytes reproduce
 * the CID held by the on-chain Soroban registry.
 */
export default function RecordIpfsStatus({ recordId }: { recordId: string }) {
  const { publicKey } = useWalletStore();

  const storage = useQuery({
    queryKey: ['record-ipfs', recordId],
    queryFn: () => fetchRecordIpfsStorage(recordId),
    retry: false,
  });
  const cid = storage.data?.cid;

  const latency = useQuery({
    queryKey: ['ipfs-gateway-latency', cid],
    queryFn: () => probeGateways(cid!),
    enabled: !!cid,
    staleTime: 60_000,
  });

  const download = useMutation({
    mutationFn: async () => {
      if (!publicKey) throw new Error('Connect your wallet to download this record.');
      const onChainCid = await readOnChainCid(recordId, publicKey);
      if (cidToString(onChainCid) !== cid) {
        throw new Error('The stored CID does not match the on-chain pointer. Download blocked.');
      }
      const [ciphertext, keys] = await Promise.all([
        fetchVerifiedCiphertext(onChainCid),
        fetchRecordKeyMaterial(recordId),
      ]);
      const plaintext = await decryptFile(ciphertext, fromBase64(keys.key), fromBase64(keys.iv));
      const url = URL.createObjectURL(new Blob([plaintext], { type: keys.fileType }));
      const a = document.createElement('a');
      a.href = url;
      a.download = keys.fileName;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  if (!storage.data) return null;
  const badge = PIN_BADGE[storage.data.pinStatus];

  return (
    <div>
      <dt className="font-medium text-slate-500">IPFS Storage</dt>
      <dd className="mt-1 space-y-2 text-slate-900">
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.className}`}>
            {badge.label}
          </span>
          <span className="font-mono text-xs break-all" title={storage.data.cid}>
            {storage.data.cid}
          </span>
        </div>
        {storage.data.pinnedAt && (
          <p className="text-xs text-slate-500">
            Pinned {new Date(storage.data.pinnedAt).toLocaleString()}
          </p>
        )}

        <div>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500">Gateway latency</p>
            <button
              onClick={() => latency.refetch()}
              disabled={latency.isFetching}
              className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              {latency.isFetching ? 'Measuring…' : 'Re-test'}
            </button>
          </div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {latency.data?.map((g) => (
              <li key={g.gateway} className="flex justify-between">
                <span>{new URL(g.gateway).host}</span>
                <span className={g.status === 200 ? 'text-slate-700' : 'text-red-600'}>
                  {g.status === null
                    ? 'unreachable'
                    : g.status === 200
                      ? `${g.latencyMs} ms`
                      : `HTTP ${g.status} · ${g.latencyMs} ms`}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={() => download.mutate()}
          disabled={download.isPending}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          {download.isPending ? 'Verifying CID…' : 'Download & decrypt'}
        </button>
        {download.isError && (
          <p role="alert" className="text-xs text-red-600">
            {download.error.message}
          </p>
        )}
      </dd>
    </div>
  );
}
