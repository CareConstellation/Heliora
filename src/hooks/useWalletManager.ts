'use client';

import { useState, useCallback, useEffect } from 'react';
import { getWalletManager, type WalletManager } from '@/lib/wallet/WalletManager';
import type { WalletType } from '@/lib/wallet/adapters';

interface WalletState {
  publicKey: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: Error | null;
  availableWallets: Array<{ id: WalletType; name: string; icon: string }>;
}

export function useWalletManager() {
  const [walletManager] = useState<WalletManager>(() => getWalletManager());
  const [state, setState] = useState<WalletState>({
    publicKey: walletManager.getConnectedPublicKey(),
    isConnected: walletManager.isConnected(),
    isLoading: false,
    error: null,
    availableWallets: [],
  });

  // Initialize available wallets
  useEffect(() => {
    const fetchAvailableWallets = async () => {
      try {
        const wallets = await walletManager.getAvailableWallets();
        setState(prev => ({ ...prev, availableWallets: wallets }));
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setState(prev => ({ ...prev, error: err }));
      }
    };

    fetchAvailableWallets();
  }, [walletManager]);

  const connect = useCallback(
    async (walletType: WalletType) => {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      try {
        const { publicKey } = await walletManager.connect(walletType);
        setState(prev => ({
          ...prev,
          publicKey,
          isConnected: true,
        }));
        return publicKey;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setState(prev => ({ ...prev, error: err }));
        return null;
      } finally {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    },
    [walletManager],
  );

  const disconnect = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      await walletManager.disconnect();
      setState(prev => ({
        ...prev,
        publicKey: null,
        isConnected: false,
      }));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      setState(prev => ({ ...prev, error: err }));
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [walletManager]);

  const signTransaction = useCallback(
    async (xdr: string): Promise<string | null> => {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      try {
        const signed = await walletManager.signTransaction(xdr);
        return signed;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setState(prev => ({ ...prev, error: err }));
        return null;
      } finally {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    },
    [walletManager],
  );

  const signAuthEntry = useCallback(
    async (base64: string): Promise<string | null> => {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      try {
        const signed = await walletManager.signAuthEntry(base64);
        return signed;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setState(prev => ({ ...prev, error: err }));
        return null;
      } finally {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    },
    [walletManager],
  );

  return {
    ...state,
    connect,
    disconnect,
    signTransaction,
    signAuthEntry,
  };
}
