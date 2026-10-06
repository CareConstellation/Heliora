import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserRole } from '@/types';

interface AuthState {
  walletAddress: string | null;
  role: UserRole | null;
  isLoading: boolean;
  setWalletAddress: (address: string | null) => void;
  setRole: (role: UserRole | null) => void;
  setIsLoading: (loading: boolean) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      walletAddress: null,
      role: null,
      isLoading: false,
      setWalletAddress: (address) => set({ walletAddress: address }),
      setRole: (role) => set({ role }),
      setIsLoading: (isLoading) => set({ isLoading }),
      clearAuth: () => set({ walletAddress: null, role: null, isLoading: false }),
    }),
    {
      name: 'heliora-auth',
      // Only persist address and role, not loading state
      partialize: (state) => ({
        walletAddress: state.walletAddress,
        role: state.role,
      }),
    },
  ),
);
