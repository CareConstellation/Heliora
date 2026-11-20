'use client';

import { useEffect, useState } from 'react';
import { Database, Trash2 } from 'lucide-react';
import { clearCachedScans, getStorageQuota, type StorageQuotaSnapshot } from '@/lib/storageQuota';

export default function StorageQuotaMonitor() {
  const [quota, setQuota] = useState<StorageQuotaSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [cleared, setCleared] = useState(false);

  const refresh = () => getStorageQuota().then(setQuota).catch(() => undefined);
  useEffect(() => { refresh(); }, []);
  if (!quota || quota.percent < 80) return null;

  return (
    <div className="mb-4 rounded-[12px] px-4 py-3 flex items-center justify-between gap-3" style={{ background: 'rgba(234,179,8,.1)', border: '1px solid rgba(234,179,8,.25)' }}>
      <div className="flex items-center gap-2 text-xs text-text-1"><Database className="w-4 h-4 text-yellow-400" />Browser storage is {quota.percent}% full.</div>
      <button className="btn-secondary text-xs" onClick={() => setOpen(true)}>Manage storage</button>
      {open && <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Storage management">
        <div className="rounded-[14px] p-5 max-w-sm w-full" style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,.1)' }}>
          <h2 className="font-semibold text-text-1">Storage management</h2>
          <p className="text-xs text-text-2 mt-2">Clear cached scans and image assets without touching offline drafts or outbox items.</p>
          {cleared ? <p className="text-xs text-green-400 mt-4">Cached assets cleared.</p> : <button className="btn-primary mt-4 text-xs flex items-center gap-2" onClick={async () => { await clearCachedScans(); setCleared(true); refresh(); }}><Trash2 className="w-3.5 h-3.5" />Clear Cached Scans</button>}
          <button className="btn-secondary mt-3 text-xs" onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>}
    </div>
  );
}
