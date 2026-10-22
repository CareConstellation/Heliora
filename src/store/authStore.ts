import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ShieldVerificationStatus, UserRole } from '@/types';

interface AuthState {
  walletAddress: string | null;
  role: UserRole | null;
  isLoading: boolean;
  roleSignature: string | null;
  roleTrustLevel: 'verified' | 'unverified' | 'tampered';
  /** Result of the last anti-phishing shield check. Never persisted: it is re-checked on every login. */
  shieldStatus: ShieldVerificationStatus | null;
  setWalletAddress: (address: string | null) => void;
  setRole: (role: UserRole | null, signature?: string) => void;
  setIsLoading: (loading: boolean) => void;
  setRoleSignature: (signature: string | null) => void;
  setRoleTrustLevel: (level: 'verified' | 'unverified' | 'tampered') => void;
  setShieldStatus: (status: ShieldVerificationStatus | null) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      walletAddress: null,
      role: null,
      isLoading: false,
      roleSignature: null,
      roleTrustLevel: 'unverified',
      shieldStatus: null,
      setWalletAddress: (address) => set({ walletAddress: address }),
      setRole: (role, signature) => set({ role, roleSignature: signature || null }),
      setIsLoading: (isLoading) => set({ isLoading }),
      setRoleSignature: (signature) => set({ roleSignature: signature }),
      setRoleTrustLevel: (level) => set({ roleTrustLevel: level }),
      setShieldStatus: (shieldStatus) => set({ shieldStatus }),
      clearAuth: () =>
        set({
          walletAddress: null,
          role: null,
          isLoading: false,
          roleSignature: null,
          roleTrustLevel: 'unverified',
          shieldStatus: null,
        }),
    }),
    {
      name: 'heliora-auth',
      partialize: (state) => ({
        walletAddress: state.walletAddress,
        role: state.role,
        roleSignature: state.roleSignature,
      }),
    },
  ),
);
