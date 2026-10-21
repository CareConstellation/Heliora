'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWalletStore } from '@/store/useWalletStore';
import { walletBalanceRefresher } from '@/lib/walletBalanceRefresher';
import ConnectWalletModal from '@/components/wallet/ConnectWalletModal';

function truncate(key: string) {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export default function Navbar() {
  const { publicKey, role, nativeBalance, disconnect, setBalance } = useWalletStore();
  const [showModal, setShowModal] = useState(false);
  const [showLowBalanceWarning, setShowLowBalanceWarning] = useState(false);

  useEffect(() => {
    if (!publicKey) return;

    walletBalanceRefresher.startPolling(publicKey, (details) => {
      setBalance(details.nativeBalance, details.sequence);

      const balanceInfo = walletBalanceRefresher.checkBalanceSufficiency(
        details.nativeBalance,
      );
      if (balanceInfo.isLowBalance) {
        setShowLowBalanceWarning(true);
      } else {
        setShowLowBalanceWarning(false);
      }
    });

    return () => {
      walletBalanceRefresher.stopPolling(publicKey);
    };
  }, [publicKey, setBalance]);

  const dashboardHref = role === 'DOCTOR' ? '/dashboard/doctor' : '/dashboard/patient';

  return (
    <>
      <nav className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="font-bold text-green text-lg">
            Heliora
          </Link>

          <div className="flex items-center gap-3">
            {publicKey ? (
              <>
                <Link href={dashboardHref} className="text-sm text-slate-600 hover:text-slate-900">
                  Dashboard
                </Link>

                {nativeBalance !== null && (
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-mono font-semibold ${
                      showLowBalanceWarning
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                    title="XLM Balance"
                  >
                    {nativeBalance.toFixed(2)} XLM
                  </span>
                )}

                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-mono text-slate-700">
                  {truncate(publicKey)}
                </span>
                <button onClick={disconnect} className="text-sm text-red-500 hover:text-red-700">
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowModal(true)}
                className="rounded-md bg-green px-3.5 py-1.5 text-sm font-semibold text-[#030D09] hover:bg-green-600"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </nav>

      {showModal && <ConnectWalletModal onClose={() => setShowModal(false)} />}

      {showLowBalanceWarning && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-yellow-50 border border-yellow-200 rounded-lg shadow-md px-4 py-3 max-w-sm">
          <p className="text-sm font-medium text-yellow-800">
            ⚠️ Low balance warning: Your XLM balance is below the minimum reserve requirement
            (1.5 XLM). Transactions may fail.
          </p>
        </div>
      )}
    </>
  );
}
