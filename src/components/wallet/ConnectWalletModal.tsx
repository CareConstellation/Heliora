'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWalletStore } from '@/store/useWalletStore';
import { ledgerHardwareWallet } from '@/lib/ledgerHardwareWallet';
import type { UserRole } from '@/types';
import api from '@/services/api.service';

interface Props {
  onClose: () => void;
}

type WalletOption = 'freighter' | 'albedo' | 'ledger';

function useFocusTrap(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () => el.querySelectorAll<HTMLElement>(focusableSelector);
    const first = () => focusables()[0];
    const last = () => {
      const f = focusables();
      return f[f.length - 1];
    };

    first()?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const f = focusables();
      if (f.length === 0) return;

      if (e.shiftKey) {
        if (document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1]?.focus();
        }
      } else {
        if (document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0]?.focus();
        }
      }
    }

    el.addEventListener('keydown', handleKeyDown);
    return () => {
      el.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [ref, onClose]);
}

export default function ConnectWalletModal({ onClose }: Props) {
  const { setWallet, network } = useWalletStore();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<WalletOption | null>(null);
  const [ledgerAccounts, setLedgerAccounts] = useState<Array<{ publicKey: string; path: string }> | null>(null);
  const [ledgerSupported, setLedgerSupported] = useState(true);
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, onClose);

  useEffect(() => {
    ledgerHardwareWallet.checkWebUSBSupport().then(setLedgerSupported);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  async function connectFreighter() {
    if (!window.freighter) {
      setError('Freighter extension not installed. Please install it from freighter.app');
      return;
    }
    setLoading('freighter');
    setError(null);
    try {
      const walletNetwork = await window.freighter.getNetwork();
      if (walletNetwork.toLowerCase() !== network.toLowerCase()) {
        setError(`Network mismatch. Switch Freighter to ${network}.`);
        return;
      }
      const publicKey = await window.freighter.getPublicKey();
      const { data } = await api.get<{ role: UserRole }>(`/users/${publicKey}/role`);
      setWallet(publicKey, data.role);
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes('rejected') ? 'Connection rejected by user.' : 'Failed to connect Freighter.',
      );
    } finally {
      setLoading(null);
    }
  }

  async function connectAlbedo() {
    if (!window.albedo) {
      setError('Albedo not available. Please visit albedo.link');
      return;
    }
    setLoading('albedo');
    setError(null);
    try {
      const { pubkey } = await window.albedo.publicKey({});
      const { data } = await api.get<{ role: UserRole }>(`/users/${pubkey}/role`);
      setWallet(pubkey, data.role);
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes('rejected') ? 'Connection rejected by user.' : 'Failed to connect Albedo.',
      );
    } finally {
      setLoading(null);
    }
  }

  async function connectLedger() {
    setLoading('ledger');
    setError(null);
    try {
      const accounts = await ledgerHardwareWallet.listAccounts();
      if (accounts.length === 0) {
        setError('No accounts found on Ledger device');
        return;
      }
      setLedgerAccounts(accounts);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to connect Ledger device');
      setLoading(null);
    }
  }

  async function selectLedgerAccount(publicKey: string) {
    try {
      const { data } = await api.get<{ role: UserRole }>(`/users/${publicKey}/role`);
      setWallet(publicKey, data.role, 'ledger');
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError('Failed to fetch user role. Ensure your address is registered.');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-wallet-title"
      onKeyDown={handleKeyDown}
    >
      <div ref={modalRef} className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 id="connect-wallet-title" className="text-lg font-semibold text-slate-900">
            Connect Wallet
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {error && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>
        )}

        {ledgerAccounts ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-600 mb-2">Select a Ledger account:</p>
            {ledgerAccounts.map((account, idx) => (
              <button
                key={account.publicKey}
                onClick={() => selectLedgerAccount(account.publicKey)}
                disabled={!!loading}
                className="w-full rounded-lg border border-slate-200 px-4 py-3 text-left text-sm hover:bg-slate-50 disabled:opacity-50 transition"
              >
                <div className="font-mono text-xs text-slate-600 truncate">
                  {account.publicKey}
                </div>
                <div className="text-xs text-slate-400 mt-1">{account.path}</div>
              </button>
            ))}
            <button
              onClick={() => {
                setLedgerAccounts(null);
                setLoading(null);
              }}
              className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              ← Back
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <button
              onClick={connectFreighter}
              disabled={!!loading}
              className="flex items-center justify-center gap-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              {loading === 'freighter' ? 'Connecting…' : '🔑 Freighter'}
            </button>
            <button
              onClick={connectAlbedo}
              disabled={!!loading}
              className="flex items-center justify-center gap-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              {loading === 'albedo' ? 'Connecting…' : '🌐 Albedo'}
            </button>
            {ledgerSupported && (
              <button
                onClick={connectLedger}
                disabled={!!loading}
                className="flex items-center justify-center gap-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
              >
                {loading === 'ledger' ? 'Connecting…' : '💳 Ledger Hardware Wallet'}
              </button>
            )}
          </div>
        )}

        <p className="mt-4 text-xs text-slate-400 text-center">Network: {network}</p>
      </div>
    </div>
  );
}
