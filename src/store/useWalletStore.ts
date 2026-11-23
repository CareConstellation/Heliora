import { create } from 'zustand';
import { persist, devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { UserRole } from '@/types';
import { useAuthStore } from './authStore';

export interface WalletState {
  publicKey: string | null;
  role: UserRole | null;
  network: string;
  nativeBalance: number | null;
  sequence: number | null;
  lastBalanceUpdate: number | null;
  walletType: 'freighter' | 'ledger' | null;
  setWallet: (publicKey: string, role?: UserRole | null, walletType?: 'freighter' | 'ledger') => void;
  setBalance: (balance: number, sequence: number) => void;
  disconnect: () => void;
}

export const useWalletStore = create<WalletState>()(
  devtools(
    persist(
      immer((set) => ({
        publicKey: null,
        role: null,
        network: process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet',
        nativeBalance: null,
        sequence: null,
        lastBalanceUpdate: null,
        walletType: null,

        setWallet: (publicKey, role = null, walletType = 'freighter') => {
          set(
            (state) => {
              state.publicKey = publicKey;
              state.walletType = walletType;
              state.role = role;
              if (role !== undefined) {
                useAuthStore.getState().setRole(role);
              }
            },
            false,
            'wallet/setWallet',
          );
        },

        setBalance: (balance, sequence) =>
          set(
            (state) => {
              state.nativeBalance = balance;
              state.sequence = sequence;
              state.lastBalanceUpdate = Date.now();
            },
            false,
            'wallet/setBalance',
          ),

        disconnect: () => {
          set(
            (state) => {
              state.publicKey = null;
              state.role = null;
              state.nativeBalance = null;
              state.sequence = null;
              state.walletType = null;
              useAuthStore.getState().setRole(null);
            },
            false,
            'wallet/disconnect',
          );
        },
      })),
      {
        name: 'wallet-store',
        partialize: (state) => ({
          publicKey: state.publicKey,
          network: state.network,
          nativeBalance: state.nativeBalance,
          sequence: state.sequence,
          lastBalanceUpdate: state.lastBalanceUpdate,
          walletType: state.walletType,
        }),
      },
    ),
    { name: 'WalletStore' },
  ),
);
