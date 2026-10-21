import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserRole } from '@/types';

interface WalletState {
  publicKey: string | null;
  role: UserRole | null;
  network: string;
  nativeBalance: number | null;
  sequence: number | null;
  lastBalanceUpdate: number | null;
  walletType: 'freighter' | 'ledger' | null;
  setWallet: (publicKey: string, role: UserRole, walletType?: 'freighter' | 'ledger') => void;
  setBalance: (balance: number, sequence: number) => void;
  disconnect: () => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      publicKey: null,
      role: null,
      network: process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet',
      nativeBalance: null,
      sequence: null,
      lastBalanceUpdate: null,
      walletType: null,
      setWallet: (publicKey, role, walletType = 'freighter') =>
        set({ publicKey, role, walletType }),
      setBalance: (balance, sequence) =>
        set({ nativeBalance: balance, sequence, lastBalanceUpdate: Date.now() }),
      disconnect: () =>
        set({
          publicKey: null,
          role: null,
          nativeBalance: null,
          sequence: null,
          walletType: null,
        }),
    }),
    { name: 'wallet-store' },
  ),
);
