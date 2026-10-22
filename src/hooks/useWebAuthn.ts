'use client';

import { useState, useCallback } from 'react';
import {
  WebAuthnManager,
  type RegistrationOptions,
  type RegistrationResult,
  type AuthenticationResult,
} from '@/lib/auth/WebAuthnManager';

interface UseWebAuthnState {
  isAvailable: boolean;
  isLoading: boolean;
  error: Error | null;
}

export function useWebAuthn() {
  const [state, setState] = useState<UseWebAuthnState>({
    isAvailable: WebAuthnManager.isAvailable(),
    isLoading: false,
    error: null,
  });

  const register = useCallback(
    async (options: RegistrationOptions): Promise<RegistrationResult | null> => {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      try {
        const result = await WebAuthnManager.registerCredential(options);
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setState(prev => ({ ...prev, error: err }));
        return null;
      } finally {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    },
    [],
  );

  const authenticate = useCallback(async (credentialIds?: ArrayBufferLike[]): Promise<AuthenticationResult | null> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      const result = await WebAuthnManager.authenticateCredential(credentialIds);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      setState(prev => ({ ...prev, error: err }));
      return null;
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  return {
    ...state,
    register,
    authenticate,
  };
}
