/**
 * Unified Zustand Store Architecture with Slice Pattern (#124).
 *
 * Consolidates separate auth and wallet states into a unified root store using:
 * - Slice pattern for domain modularity
 * - Immer middleware for direct draft mutations without spread boilerplate
 * - Redux DevTools integration for state time-travel debugging
 * - Single source of truth for `role`, eliminating state duplication
 */

import { create, type StateCreator } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { UserRole, ShieldVerificationStatus } from '@/types';
import { useAuthStore } from './authStore';
import { useWalletStore } from './useWalletStore';

/* ── Auth Slice Definition ─────────────────────────────────────────── */

export interface AuthState {
  walletAddress: string | null;
  role: UserRole | null;
  isLoading: boolean;
  roleSignature: string | null;
  roleTrustLevel: 'verified' | 'unverified' | 'tampered';
  shieldStatus: ShieldVerificationStatus | null;
}

export interface AuthActions {
  setWalletAddress: (address: string | null) => void;
  setRole: (role: UserRole | null, signature?: string) => void;
  setIsLoading: (loading: boolean) => void;
  setRoleSignature: (signature: string | null) => void;
  setRoleTrustLevel: (level: 'verified' | 'unverified' | 'tampered') => void;
  setShieldStatus: (status: ShieldVerificationStatus | null) => void;
  clearAuth: () => void;
}

export type AuthSlice = AuthState & AuthActions;

/* ── Wallet Slice Definition ───────────────────────────────────────── */

export interface WalletState {
  publicKey: string | null;
  network: string;
  nativeBalance: number | null;
  sequence: number | null;
  lastBalanceUpdate: number | null;
  walletType: 'freighter' | 'ledger' | null;
}

export interface WalletActions {
  setWallet: (publicKey: string, role?: UserRole | null, walletType?: 'freighter' | 'ledger') => void;
  setBalance: (balance: number, sequence: number) => void;
  disconnect: () => void;
}

// Note: To eliminate redundant state duplication, `role` is stored once in AuthSlice.
// WalletSlice exposes `role` as an accessor pointing to the unified role.
export type WalletSlice = WalletState & WalletActions & { readonly role: UserRole | null };

/* ── Unified Root Store Type ───────────────────────────────────────── */

export type RootStore = AuthSlice & WalletSlice;

type StoreSlice<T> = StateCreator<
  RootStore,
  [['zustand/devtools', never], ['zustand/persist', unknown], ['zustand/immer', never]],
  [],
  T
>;

/* ── Auth Slice Creator ────────────────────────────────────────────── */

export const createAuthSlice: StoreSlice<AuthSlice> = (set) => ({
  walletAddress: null,
  role: null,
  isLoading: false,
  roleSignature: null,
  roleTrustLevel: 'unverified',
  shieldStatus: null,

  setWalletAddress: (address) =>
    set(
      (state) => {
        state.walletAddress = address;
      },
      false,
      'auth/setWalletAddress',
    ),

  setRole: (role, signature) =>
    set(
      (state) => {
        state.role = role;
        state.roleSignature = signature || null;
      },
      false,
      'auth/setRole',
    ),

  setIsLoading: (isLoading) =>
    set(
      (state) => {
        state.isLoading = isLoading;
      },
      false,
      'auth/setIsLoading',
    ),

  setRoleSignature: (signature) =>
    set(
      (state) => {
        state.roleSignature = signature;
      },
      false,
      'auth/setRoleSignature',
    ),

  setRoleTrustLevel: (level) =>
    set(
      (state) => {
        state.roleTrustLevel = level;
      },
      false,
      'auth/setRoleTrustLevel',
    ),

  setShieldStatus: (status) =>
    set(
      (state) => {
        state.shieldStatus = status;
      },
      false,
      'auth/setShieldStatus',
    ),

  clearAuth: () =>
    set(
      (state) => {
        state.walletAddress = null;
        state.role = null;
        state.isLoading = false;
        state.roleSignature = null;
        state.roleTrustLevel = 'unverified';
        state.shieldStatus = null;
      },
      false,
      'auth/clearAuth',
    ),
});

/* ── Wallet Slice Creator ──────────────────────────────────────────── */

export const createWalletSlice: StoreSlice<WalletSlice> = (set) => ({
  publicKey: null,
  network: process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet',
  nativeBalance: null,
  sequence: null,
  lastBalanceUpdate: null,
  walletType: null,

  setWallet: (publicKey, role, walletType = 'freighter') =>
    set(
      (state) => {
        state.publicKey = publicKey;
        state.walletType = walletType;
        if (role !== undefined) {
          state.role = role ?? null;
        }
      },
      false,
      'wallet/setWallet',
    ),

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

  disconnect: () =>
    set(
      (state) => {
        state.publicKey = null;
        state.role = null;
        state.nativeBalance = null;
        state.sequence = null;
        state.walletType = null;
      },
      false,
      'wallet/disconnect',
    ),
});

/* ── Action Creators (for decoupled dispatch) ──────────────────────── */

export const authActions = {
  setWalletAddress: (address: string | null) => useAppStore.getState().setWalletAddress(address),
  setRole: (role: UserRole | null, signature?: string) => useAppStore.getState().setRole(role, signature),
  setIsLoading: (loading: boolean) => useAppStore.getState().setIsLoading(loading),
  setRoleSignature: (sig: string | null) => useAppStore.getState().setRoleSignature(sig),
  setRoleTrustLevel: (level: 'verified' | 'unverified' | 'tampered') => useAppStore.getState().setRoleTrustLevel(level),
  setShieldStatus: (status: ShieldVerificationStatus | null) => useAppStore.getState().setShieldStatus(status),
  clearAuth: () => useAppStore.getState().clearAuth(),
};

export const walletActions = {
  setWallet: (publicKey: string, role?: UserRole | null, walletType?: 'freighter' | 'ledger') =>
    useAppStore.getState().setWallet(publicKey, role, walletType),
  setBalance: (balance: number, sequence: number) => useAppStore.getState().setBalance(balance, sequence),
  disconnect: () => useAppStore.getState().disconnect(),
};

/* ── Root App Store ────────────────────────────────────────────────── */

export const useAppStore = create<RootStore>()(
  devtools(
    persist(
      immer((...a) => ({
        ...createAuthSlice(...a),
        ...createWalletSlice(...a),
      })),
      {
        name: 'heliora-unified-store',
        partialize: (state) => ({
          walletAddress: state.walletAddress,
          role: state.role,
          roleSignature: state.roleSignature,
          publicKey: state.publicKey,
          network: state.network,
          nativeBalance: state.nativeBalance,
          sequence: state.sequence,
          lastBalanceUpdate: state.lastBalanceUpdate,
          walletType: state.walletType,
        }),
      },
    ),
    { name: 'HelioraRootStore' },
  ),
);

// Synchronize legacy individual stores with unified root store synchronously
useAuthStore.subscribe((authState) => {
  if (authState.role && useAppStore.getState().role !== authState.role) {
    useAppStore.setState({ role: authState.role });
  }
  if (authState.role && useWalletStore.getState().role !== authState.role) {
    useWalletStore.setState({ role: authState.role });
  }
});

useAppStore.subscribe((appState) => {
  if (appState.role && useAuthStore.getState().role !== appState.role) {
    useAuthStore.setState({ role: appState.role });
  }
  if (appState.role && useWalletStore.getState().role !== appState.role) {
    useWalletStore.setState({ role: appState.role });
  }
});
