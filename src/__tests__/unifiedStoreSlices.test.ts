/**
 * Tests for Unified Zustand Slice Architecture (#124)
 */

import { act } from '@testing-library/react';
import { useAppStore, authActions, walletActions } from '@/store';
import { useAuthStore } from '@/store/authStore';
import { useWalletStore } from '@/store/useWalletStore';

describe('Unified Zustand Slice Architecture (#124)', () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({
        walletAddress: null,
        role: null,
        isLoading: false,
        roleSignature: null,
        roleTrustLevel: 'unverified',
        shieldStatus: null,
        publicKey: null,
        network: 'testnet',
        nativeBalance: null,
        sequence: null,
        lastBalanceUpdate: null,
        walletType: null,
      });
    });
  });

  describe('Slice consolidation under src/store/index.ts', () => {
    it('initializes unified store with both auth and wallet slice state', () => {
      const state = useAppStore.getState();
      expect(state.walletAddress).toBeNull();
      expect(state.role).toBeNull();
      expect(state.publicKey).toBeNull();
      expect(state.network).toBe('testnet');
    });

    it('mutates nested draft state cleanly using Immer middleware without spread boilerplate', () => {
      act(() => {
        useAppStore.getState().setWallet('GPUBLIC_IMMER', 'DOCTOR', 'ledger');
        useAppStore.getState().setBalance(150.5, 42);
      });

      const state = useAppStore.getState();
      expect(state.publicKey).toBe('GPUBLIC_IMMER');
      expect(state.walletType).toBe('ledger');
      expect(state.nativeBalance).toBe(150.5);
      expect(state.sequence).toBe(42);
      expect(state.lastBalanceUpdate).toBeGreaterThan(0);
      expect(state.role).toBe('DOCTOR');
    });
  });

  describe('Eliminating redundant state duplication', () => {
    it('maintains a single unified role across auth and wallet states', () => {
      act(() => {
        useWalletStore.getState().setWallet('GPUBLIC_ADDR', 'HOSPITAL');
      });

      // Role is synchronized across wallet and auth
      expect(useWalletStore.getState().role).toBe('HOSPITAL');
      expect(useAuthStore.getState().role).toBe('HOSPITAL');
      expect(useAppStore.getState().role).toBe('HOSPITAL');

      // Modifying auth role propagates without redundant duplication
      act(() => {
        useAuthStore.getState().setRole('ADMIN');
      });

      expect(useWalletStore.getState().role).toBe('ADMIN');
      expect(useAuthStore.getState().role).toBe('ADMIN');
    });
  });

  describe('Strongly-typed action creators', () => {
    it('dispatches authActions correctly', () => {
      act(() => {
        authActions.setWalletAddress('GADDR_ACTION');
        authActions.setRole('PATIENT');
        authActions.setIsLoading(true);
        authActions.setRoleTrustLevel('verified');
      });

      const state = useAppStore.getState();
      expect(state.walletAddress).toBe('GADDR_ACTION');
      expect(state.role).toBe('PATIENT');
      expect(state.isLoading).toBe(true);
      expect(state.roleTrustLevel).toBe('verified');
    });

    it('dispatches walletActions correctly', () => {
      act(() => {
        walletActions.setWallet('GWALLET_ACTION', 'DOCTOR', 'freighter');
        walletActions.setBalance(500, 100);
      });

      const state = useAppStore.getState();
      expect(state.publicKey).toBe('GWALLET_ACTION');
      expect(state.role).toBe('DOCTOR');
      expect(state.nativeBalance).toBe(500);

      act(() => {
        walletActions.disconnect();
      });

      const cleared = useAppStore.getState();
      expect(cleared.publicKey).toBeNull();
      expect(cleared.role).toBeNull();
      expect(cleared.nativeBalance).toBeNull();
    });
  });
});
