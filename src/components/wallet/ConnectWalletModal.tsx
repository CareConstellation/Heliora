'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWalletStore } from '@/store/useWalletStore';
import { useWalletManager } from '@/hooks/useWalletManager';
import { ledgerHardwareWallet } from '@/lib/ledgerHardwareWallet';
import { FriendbotFaucet } from '@/lib/wallet/FriendbotFaucet';
import type { UserRole } from '@/types';
import type { WalletType } from '@/lib/wallet/adapters';
import api from '@/services/api.service';

interface Props {
  onClose: () => void;
  autoFundTestnet?: boolean;
}

type WalletOption = 'freighter' | 'albedo' | 'ledger' | 'xbull' | 'lobstr' | 'walletconnect';

function useFocusTrap(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () => el.querySelectorAll<HTMLElement>(focusableSelector);
    const first = () => focusables()[0];

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

export default function ConnectWalletModal({ onClose, autoFundTestnet = false }: Props) {
  const { setWallet, network } = useWalletStore();
  const { connect, availableWallets, isLoading, error: managerError } = useWalletManager();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<WalletOption | null>(null);
  const [ledgerAccounts, setLedgerAccounts] = useState<Array<{ publicKey: string; path: string }> | null>(null);
  const [ledgerSupported, setLedgerSupported] = useState(true);
  const [fundingStatus, setFundingStatus] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, onClose);

  useEffect(() => {
    void ledgerHardwareWallet.checkWebUSBSupport().then(setLedgerSupported);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  async function handleWalletConnect(walletType: WalletType) {
    setLoading(walletType as WalletOption);
    setError(null);
    setFundingStatus(null);

    try {
      const publicKey = await connect(walletType);
      if (!publicKey) {
        setError('Failed to connect wallet');
        return;
      }

      // Auto-fund testnet if enabled
      if (autoFundTestnet && network === 'testnet') {
        setFundingStatus('Funding account...');
        try {
          await FriendbotFaucet.fundAccountIfNeeded(publicKey, 2);
          setFundingStatus('Account funded successfully');
        } catch (fundError) {
          // Log but don't block on funding error
          console.warn('Failed to fund account:', fundError);
        }
      }

      const { data } = await api.get<{ role: UserRole }>(`/users/${publicKey}/role`);
      setWallet(publicKey, data.role, walletType === 'ledger' ? 'ledger' : 'freighter');
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes('rejected') ? 'Connection rejected by user.' : `Failed to connect wallet: ${msg}`,
      );
    } finally {
      setLoading(null);
      setFundingStatus(null);
    }
  }

  async function connectFreighter() {
    await handleWalletConnect('freighter');
  }

  async function connectAlbedo() {
    await handleWalletConnect('albedo');
  }

  async function connectXbull() {
    await handleWalletConnect('xbull');
  }

  async function connectLobstr() {
    await handleWalletConnect('lobstr');
  }

  async function connectWalletConnect() {
    await handleWalletConnect('walletconnect');
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
    } catch {
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

        {(error || managerError) && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">
            {error || managerError?.message}
          </p>
        )}

        {fundingStatus && (
          <p className="mb-4 text-sm text-blue-600 bg-blue-50 rounded-md px-3 py-2">
            {fundingStatus}
          </p>
        )}

        {ledgerAccounts ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-600 mb-2">Select a Ledger account:</p>
            {ledgerAccounts.map((account) => (
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
            <button
              onClick={connectXbull}
              disabled={!!loading}
              className="flex items-center justify-center gap-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              {loading === 'xbull' ? 'Connecting…' : '💧 xBull'}
            </button>
            <button
              onClick={connectLobstr}
              disabled={!!loading}
              className="flex items-center justify-center gap-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              {loading === 'lobstr' ? 'Connecting…' : '🔐 LOBSTR'}
            </button>
            <button
              onClick={connectWalletConnect}
              disabled={!!loading}
              className="flex items-center justify-center gap-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              {loading === 'walletconnect' ? 'Connecting…' : '📱 WalletConnect'}
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

        <p className="mt-4 text-xs text-slate-400 text-center">
          Network: {network} {autoFundTestnet && network === 'testnet' && '(Auto-fund enabled)'}
        </p>
      </div>
    </div>
  );
}
