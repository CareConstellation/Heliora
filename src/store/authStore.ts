import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { z } from 'zod';
import { captureError } from '@/lib/sentry';
import type { ShieldVerificationStatus, UserRole } from '@/types';

export const AUTH_STORAGE_KEY = 'heliora-auth';
export const WALLET_STORAGE_KEY = 'wallet-store';
export const STORAGE_RECOVERY_EVENT = 'heliora:storage-recovery';

const userRoleSchema = z.enum(['PATIENT', 'DOCTOR', 'HOSPITAL', 'ADMIN']);

export const authStateSchema = z.object({
  walletAddress: z.string().nullable(),
  role: userRoleSchema.nullable(),
  roleSignature: z.string().nullable(),
});

const walletStateSchema = z.object({
  publicKey: z.string().nullable(),
  role: userRoleSchema.nullable(),
  network: z.string(),
  nativeBalance: z.number().nullable(),
  sequence: z.number().nullable(),
  lastBalanceUpdate: z.number().nullable(),
  walletType: z.enum(['freighter', 'ledger']).nullable(),
});

const persistedStateValidators = [
  { key: AUTH_STORAGE_KEY, schema: authStateSchema },
  { key: WALLET_STORAGE_KEY, schema: walletStateSchema },
];

let storageRecovered = false;

export function hasStorageRecovery(): boolean {
  return storageRecovered;
}

export function acknowledgeStorageRecovery(): void {
  storageRecovered = false;
}

function describeCorruptedPayload(raw: string | null): Record<string, unknown> {
  if (raw === null) return { type: 'missing' };

  try {
    const value: unknown = JSON.parse(raw);
    if (value !== null && typeof value === 'object') {
      const envelope = value as Record<string, unknown>;
      const state = envelope.state;
      return {
        type: Array.isArray(value) ? 'array' : 'object',
        keys: Object.keys(envelope),
        stateType: state === null ? 'null' : typeof state,
        stateKeys:
          state !== null && typeof state === 'object' ? Object.keys(state as object) : [],
        rawLength: raw.length,
      };
    }
    return { type: value === null ? 'null' : typeof value, rawLength: raw.length };
  } catch {
    return { type: 'invalid-json', rawLength: raw.length };
  }
}

function reportCorruptedStorage(key: string, raw: string | null, error: unknown, issues?: unknown) {
  storageRecovered = true;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      void error;
    }
  }

  captureError(error instanceof Error ? error : new Error(String(error)), {
    storageKey: key,
    corruptedState: describeCorruptedPayload(raw),
    ...(issues ? { validationIssues: issues } : {}),
    recoveryAction: 'reset-to-defaults',
  });

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(STORAGE_RECOVERY_EVENT, { detail: { storageKey: key } }));
  }
}

function readValidatedState(key: string, schema: z.ZodType): string | null {
  if (typeof window === 'undefined') return null;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const envelope: unknown = JSON.parse(raw);
    const state = (envelope as { state?: unknown } | null)?.state;
    const result = schema.safeParse(state);
    if (!result.success) {
      reportCorruptedStorage(
        key,
        raw,
        new Error('Hydrated store state failed schema validation'),
        result.error.issues,
      );
      return null;
    }
    return raw;
  } catch (error) {
    reportCorruptedStorage(key, raw, error);
    return null;
  }
}

export function repairCorruptedPersistedStorage(): boolean {
  if (typeof window === 'undefined') return false;

  let repaired = false;
  for (const { key, schema } of persistedStateValidators) {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      continue;
    }
    if (raw === null) continue;

    try {
      const envelope: unknown = JSON.parse(raw);
      const state = (envelope as { state?: unknown } | null)?.state;
      const result = schema.safeParse(state);
      if (!result.success) {
        reportCorruptedStorage(
          key,
          raw,
          new Error('Hydrated store state failed schema validation'),
          result.error.issues,
        );
        repaired = true;
      }
    } catch (error) {
      reportCorruptedStorage(key, raw, error);
      repaired = true;
    }
  }
  return repaired;
}

const validatedStorage: StateStorage = {
  getItem: (key) => readValidatedState(key, authStateSchema),
  setItem: (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      return;
    }
  },
  removeItem: (key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      return;
    }
  },
};

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
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => validatedStorage),
      partialize: (state) => ({
        walletAddress: state.walletAddress,
        role: state.role,
        roleSignature: state.roleSignature,
      }),
      merge: (persistedState, currentState) => {
        const result = authStateSchema.safeParse(persistedState);
        if (!result.success) return currentState;
        return { ...currentState, ...result.data };
      },
    },
  ),
);
