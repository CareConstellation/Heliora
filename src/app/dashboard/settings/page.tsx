'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import SecuritySettingsModal from '@/components/auth/SecuritySettingsModal';
import { useWalletStore } from '@/store/useWalletStore';

export default function SettingsPage() {
  const { publicKey } = useWalletStore();
  const [open, setOpen] = useState(true);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-lg font-semibold text-text-1 mb-1">Settings</h1>
      <p className="text-xs text-text-3 mb-6">Manage account and security preferences.</p>
      <div
        className="rounded-[14px] p-5"
        style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-text-1">Hardware security keys</h2>
            <p className="text-xs text-text-3 mt-0.5">
              Verify FIDO2 hardware authenticators with direct attestation.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-primary rounded-[9px] text-xs py-2 px-3.5"
          >
            Manage keys
          </button>
        </div>
      </div>
      <SecuritySettingsModal
        open={open}
        onClose={() => setOpen(false)}
        userId={publicKey || 'heliora-user'}
        userName={publicKey ? `${publicKey.slice(0, 8)}@heliora.local` : 'patient@heliora.local'}
        userDisplayName="Heliora User"
      />
    </div>
  );
}
