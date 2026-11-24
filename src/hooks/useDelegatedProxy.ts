'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  decryptReferredRecord,
  encryptForReferralOwner,
  generateReferralReencryptionKey,
  proxyBannerLabel,
  proxyTransformReferralCiphertext,
  type PreCiphertext,
  type PreReencryptedCiphertext,
  type PreReencryptionKey,
} from '@/lib/delegatedProxy';
import { revokeDelegatedProxyToken } from '@/services/api.service';
import { useProxyStore } from '@/store/proxyStore';

/**
 * Active delegated proxy session, if any. Leaves proxy mode automatically when
 * the token expires; `exit` also revokes the token on the server.
 */
export function useDelegatedProxy() {
  const router = useRouter();
  const token = useProxyStore((s) => s.activeToken);
  const exitProxyMode = useProxyStore((s) => s.exitProxyMode);

  const exit = useCallback(() => {
    if (!token) return;
    exitProxyMode();
    // Best effort: the token expires on its own if the revocation does not reach the server.
    revokeDelegatedProxyToken(token.tokenId).catch(() => undefined);
    router.push('/dashboard/doctor');
  }, [token, exitProxyMode, router]);

  useEffect(() => {
    if (!token) return;
    const remaining = Date.parse(token.expiresAt) - Date.now();
    const timer = setTimeout(exitProxyMode, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [token, exitProxyMode]);

  return {
    token,
    active: token !== null,
    label: token ? proxyBannerLabel(token) : null,
    exit,
  };
}

export function useReferralProxyReencryption() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        return await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Referral proxy re-encryption failed');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const encrypt = useCallback(
    (plaintext: Uint8Array, ownerPublicKey: JsonWebKey) =>
      run<PreCiphertext>(() => encryptForReferralOwner(plaintext, ownerPublicKey)),
    [run],
  );

  const generateKey = useCallback(
    (params: {
      ownerAddress: string;
      ownerKeyPair: CryptoKeyPair;
      specialistAddress: string;
      specialistPublicKey: JsonWebKey;
      ownerCapsule: PreCiphertext['ownerCapsule'];
    }) => run<PreReencryptionKey>(() => generateReferralReencryptionKey(params)),
    [run],
  );

  const transform = useCallback(
    (ciphertext: PreCiphertext, reencryptionKey: PreReencryptionKey) =>
      run<PreReencryptedCiphertext>(async () =>
        proxyTransformReferralCiphertext(ciphertext, reencryptionKey),
      ),
    [run],
  );

  const decrypt = useCallback(
    (ciphertext: PreReencryptedCiphertext, specialistKeyPair: CryptoKeyPair) =>
      run<Uint8Array>(() => decryptReferredRecord(ciphertext, specialistKeyPair)),
    [run],
  );

  return { busy, error, encrypt, generateKey, transform, decrypt };
}
