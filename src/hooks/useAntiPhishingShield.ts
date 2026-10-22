'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StrKey } from '@stellar/stellar-sdk';
import {
  computeShieldFingerprint,
  createShieldStore,
  getAttestationSigningKey,
  shieldEnrollmentMessage,
  validateShield,
  verifyShieldAttestation,
  type AntiPhishingShield,
} from '@/lib/antiPhishing';
import type { EncryptedLocalStore } from '@/lib/encryptedLocalStore';
import { freighterMessageSigner, type MessageSigner } from '@/lib/stellar';
import { fetchShieldAttestation, registerShieldFingerprint } from '@/services/api.service';
import { useAuthStore } from '@/store/authStore';
import type { ShieldIcon, ShieldVerificationStatus } from '@/types';

let defaultStore: EncryptedLocalStore<AntiPhishingShield> | null = null;
const getDefaultStore = () => (defaultStore ??= createShieldStore());

export interface UseAntiPhishingShieldOptions {
  store?: EncryptedLocalStore<AntiPhishingShield>;
  signMessage?: MessageSigner;
}

export interface AntiPhishingShieldState {
  loading: boolean;
  /** The decrypted local shield, or `null` when none is set up for this account. */
  shield: AntiPhishingShield | null;
  status: ShieldVerificationStatus | null;
  error: string | null;
  enrolling: boolean;
  enroll: (icon: ShieldIcon, phrase: string) => Promise<boolean>;
  remove: () => void;
  refresh: () => Promise<void>;
}

const errorText = (err: unknown, fallback: string) =>
  err instanceof Error && err.message
    ? err.message
    : typeof err === 'object' && err && 'message' in err && typeof err.message === 'string'
      ? err.message
      : fallback;

/**
 * Loads the anti-phishing shield for `publicKey` and checks it against the
 * server attestation. The result is mirrored into `useAuthStore().shieldStatus`.
 */
export function useAntiPhishingShield(
  publicKey: string | null,
  options: UseAntiPhishingShieldOptions = {},
): AntiPhishingShieldState {
  const store = options.store ?? getDefaultStore();
  const signMessage = options.signMessage ?? freighterMessageSigner;
  const setShieldStatus = useAuthStore((s) => s.setShieldStatus);

  const [loading, setLoading] = useState(false);
  const [shield, setShield] = useState<AntiPhishingShield | null>(null);
  const [status, setStatus] = useState<ShieldVerificationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  // Ignores results of a check that was started for a previously entered key.
  const requestId = useRef(0);

  const validKey = publicKey && StrKey.isValidEd25519PublicKey(publicKey) ? publicKey : null;

  const applyStatus = useCallback(
    (next: ShieldVerificationStatus | null) => {
      setStatus(next);
      setShieldStatus(next);
    },
    [setShieldStatus],
  );

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    const current = () => id === requestId.current;
    setError(null);

    if (!validKey) {
      setShield(null);
      applyStatus(null);
      return;
    }

    setLoading(true);
    try {
      let local: AntiPhishingShield | null;
      try {
        local = await store.load(validKey);
      } catch (err) {
        if (!current()) return;
        setShield(null);
        applyStatus('mismatch');
        setError(errorText(err, 'Your saved security shield could not be read.'));
        return;
      }
      if (!current()) return;
      setShield(local);
      if (!local) {
        applyStatus(null);
        return;
      }

      const signingKey = getAttestationSigningKey();
      if (!signingKey) {
        applyStatus('not-configured');
        return;
      }

      const origin = window.location.origin;
      const [fingerprint, attestation] = await Promise.all([
        computeShieldFingerprint(validKey, local),
        fetchShieldAttestation(validKey, origin).catch(() => undefined),
      ]);
      if (!current()) return;

      if (attestation === undefined) applyStatus('unavailable');
      else if (attestation === null) applyStatus('not-enrolled');
      else
        applyStatus(
          verifyShieldAttestation({
            attestation,
            publicKey: validKey,
            expectedFingerprint: fingerprint,
            origin,
            serverSigningKey: signingKey,
          }),
        );
    } finally {
      if (current()) setLoading(false);
    }
  }, [validKey, store, applyStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enroll = useCallback(
    async (icon: ShieldIcon, phrase: string) => {
      if (!validKey) return false;
      const invalid = validateShield(icon, phrase);
      if (invalid) {
        setError(invalid);
        return false;
      }

      setEnrolling(true);
      setError(null);
      const next: AntiPhishingShield = {
        icon,
        phrase: phrase.trim(),
        createdAt: new Date().toISOString(),
      };
      try {
        // Saved locally first: the shield is what protects the user, the
        // server registration only adds the cross-check.
        await store.save(validKey, next);
        setShield(next);

        const origin = window.location.origin;
        const fingerprint = await computeShieldFingerprint(validKey, next);
        const issuedAt = new Date().toISOString();
        const signature = await signMessage(
          shieldEnrollmentMessage(validKey, fingerprint, origin, issuedAt),
          validKey,
        );
        await registerShieldFingerprint({
          publicKey: validKey,
          fingerprint,
          origin,
          issuedAt,
          signature,
        });
        await refresh();
        return true;
      } catch (err) {
        applyStatus('not-enrolled');
        setError(
          `Your shield is saved on this device, but it could not be registered with Heliora: ${errorText(
            err,
            'unknown error',
          )}`,
        );
        return false;
      } finally {
        setEnrolling(false);
      }
    },
    [validKey, store, signMessage, refresh, applyStatus],
  );

  const remove = useCallback(() => {
    if (!validKey) return;
    store.clear(validKey);
    setShield(null);
    setError(null);
    applyStatus(null);
  }, [validKey, store, applyStatus]);

  return { loading, shield, status, error, enrolling, enroll, remove, refresh };
}
