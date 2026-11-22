import { act } from '@testing-library/react';
import { captureError } from '@/lib/sentry';
import {
  AUTH_STORAGE_KEY,
  acknowledgeStorageRecovery,
  authStateSchema,
  repairCorruptedPersistedStorage,
  useAuthStore,
} from '@/store/authStore';

jest.mock('@/lib/sentry', () => ({
  captureError: jest.fn(),
  captureMessage: jest.fn(),
  initSentry: jest.fn(),
  setSentryUser: jest.fn(),
  clearSentryUser: jest.fn(),
}));

const mockedCaptureError = captureError as jest.Mock;

function validPayload() {
  return JSON.stringify({
    state: { walletAddress: 'GVALID', role: 'PATIENT', roleSignature: 'sig' },
    version: 0,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
  acknowledgeStorageRecovery();
  useAuthStore.setState({
    walletAddress: null,
    role: null,
    isLoading: false,
    roleSignature: null,
    roleTrustLevel: 'unverified',
    shieldStatus: null,
  });
});

describe('useAuthStore', () => {
  it('initializes with null wallet address and role', () => {
    const { walletAddress, role } = useAuthStore.getState();
    expect(walletAddress).toBeNull();
    expect(role).toBeNull();
  });

  it('sets wallet address', () => {
    act(() => {
      useAuthStore.getState().setWalletAddress('GTEST1234');
    });
    expect(useAuthStore.getState().walletAddress).toBe('GTEST1234');
  });

  it('sets role', () => {
    act(() => {
      useAuthStore.getState().setRole('PATIENT');
    });
    expect(useAuthStore.getState().role).toBe('PATIENT');
  });

  it('sets role to DOCTOR', () => {
    act(() => {
      useAuthStore.getState().setRole('DOCTOR');
    });
    expect(useAuthStore.getState().role).toBe('DOCTOR');
  });

  it('sets isLoading flag', () => {
    act(() => {
      useAuthStore.getState().setIsLoading(true);
    });
    expect(useAuthStore.getState().isLoading).toBe(true);
  });

  it('clears auth state', () => {
    act(() => {
      useAuthStore.getState().setWalletAddress('GTEST1234');
      useAuthStore.getState().setRole('PATIENT');
    });
    act(() => {
      useAuthStore.getState().clearAuth();
    });
    const { walletAddress, role, isLoading } = useAuthStore.getState();
    expect(walletAddress).toBeNull();
    expect(role).toBeNull();
    expect(isLoading).toBe(false);
  });

  it('does not affect other fields when setting wallet address', () => {
    act(() => {
      useAuthStore.getState().setRole('HOSPITAL');
      useAuthStore.getState().setWalletAddress('GHOSPITAL');
    });
    expect(useAuthStore.getState().role).toBe('HOSPITAL');
    expect(useAuthStore.getState().walletAddress).toBe('GHOSPITAL');
  });
});

describe('auth hydration validation', () => {
  it('accepts a well-formed persisted auth state', () => {
    const result = authStateSchema.safeParse({
      walletAddress: 'GVALID',
      role: 'ADMIN',
      roleSignature: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown roles and malformed field types', () => {
    expect(
      authStateSchema.safeParse({ walletAddress: 'G', role: 'SUPERUSER', roleSignature: null })
        .success,
    ).toBe(false);
    expect(
      authStateSchema.safeParse({ walletAddress: 42, role: 'PATIENT', roleSignature: null }).success,
    ).toBe(false);
  });

  it('resets a corrupted auth key to defaults on rehydrate and reports to Sentry', async () => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, '{not valid json');

    await useAuthStore.persist.rehydrate();

    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(mockedCaptureError).toHaveBeenCalledTimes(1);
    expect(mockedCaptureError.mock.calls[0][1]).toMatchObject({
      storageKey: AUTH_STORAGE_KEY,
      recoveryAction: 'reset-to-defaults',
      corruptedState: { type: 'invalid-json' },
    });
    expect(useAuthStore.getState().walletAddress).toBeNull();
    expect(useAuthStore.getState().role).toBeNull();
  });

  it('resets a schema-invalid auth key on rehydrate', async () => {
    window.localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ state: { walletAddress: 'G', role: 'SUPERADMIN', roleSignature: null } }),
    );

    await useAuthStore.persist.rehydrate();

    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(mockedCaptureError).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().role).toBeNull();
  });

  it('hydrates a valid auth payload and ignores tampered transient fields', async () => {
    window.localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        state: {
          walletAddress: 'GVALID',
          role: 'DOCTOR',
          roleSignature: 'sig',
          shieldStatus: { verified: true },
          roleTrustLevel: 'verified',
        },
        version: 0,
      }),
    );

    await useAuthStore.persist.rehydrate();

    expect(useAuthStore.getState().walletAddress).toBe('GVALID');
    expect(useAuthStore.getState().role).toBe('DOCTOR');
    expect(useAuthStore.getState().roleTrustLevel).toBe('unverified');
    expect(useAuthStore.getState().shieldStatus).toBeNull();
    expect(mockedCaptureError).not.toHaveBeenCalled();
  });

  it('leaves valid storage untouched during a repair sweep', () => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, validPayload());

    expect(repairCorruptedPersistedStorage()).toBe(false);
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBe(validPayload());
    expect(mockedCaptureError).not.toHaveBeenCalled();
  });

  it('clears corrupted keys found by the repair sweep and logs their structure', () => {
    window.localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ state: { walletAddress: null, role: 123, roleSignature: null } }),
    );

    expect(repairCorruptedPersistedStorage()).toBe(true);
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(mockedCaptureError).toHaveBeenCalledTimes(1);
    expect(mockedCaptureError.mock.calls[0][1].corruptedState).toMatchObject({
      type: 'object',
      stateKeys: ['walletAddress', 'role', 'roleSignature'],
    });
  });
});
