'use client';

import { useMemo, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { WebAuthnManager, type StoredCredential } from '@/lib/auth/WebAuthnManager';

interface SecuritySettingsModalProps {
  open: boolean;
  onClose: () => void;
  userId?: string;
  userName?: string;
  userDisplayName?: string;
}

function shortId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
}

export default function SecuritySettingsModal({
  open,
  onClose,
  userId = 'heliora-user',
  userName = 'patient@heliora.local',
  userDisplayName = 'Heliora User',
}: SecuritySettingsModalProps) {
  const [credentials, setCredentials] = useState<StoredCredential[]>(
    () => WebAuthnManager.getStoredCredentials(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const hasHardwareKey = useMemo(
    () => credentials.some((c) => c.attestation.verified && c.attestation.hardwareBacked),
    [credentials],
  );

  if (!open) return null;

  async function registerHardwareKey() {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await WebAuthnManager.registerCredential({
        userId,
        userName,
        userDisplayName,
        attestation: 'direct',
        authenticatorAttachment: 'cross-platform',
      });
      const next = WebAuthnManager.storeCredential(result);
      setCredentials(next);
      setSuccess(
        `Verified ${result.attestation?.authenticatorName || 'hardware key'} registered.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register hardware key.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Security settings"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close security settings"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-2xl rounded-[14px] p-5"
        style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-text-1">Security settings</h2>
            <p className="text-xs text-text-3 mt-0.5">
              Register a FIDO2 hardware security key with direct attestation verification.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-text-3 hover:text-text-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            type="button"
            onClick={registerHardwareKey}
            disabled={busy}
            className="btn-primary rounded-[9px] text-xs py-2 px-3.5 disabled:opacity-50"
          >
            {busy ? 'Verifying key…' : 'Register hardware key'}
          </button>
          {hasHardwareKey && (
            <span className="badge-green inline-flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> Verified hardware key
            </span>
          )}
        </div>

        {error && (
          <p role="alert" className="text-xs text-red-500 mb-3">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="text-xs text-green-500 mb-3">
            {success}
          </p>
        )}

        <div className="space-y-2">
          {credentials.length === 0 ? (
            <p className="text-xs text-text-3">No verified hardware keys registered.</p>
          ) : (
            credentials.map((credential) => (
              <div
                key={credential.id}
                className="rounded-[10px] px-3 py-2.5 flex items-center justify-between gap-3"
                style={{ background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.05)' }}
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-text-1 truncate">
                    {credential.attestation.authenticatorName || 'Hardware security key'}
                  </p>
                  <p className="text-2xs text-text-3 font-mono truncate">
                    {credential.attestation.vendor || 'Verified vendor'} · AAGUID{' '}
                    {credential.attestation.aaguid} · {shortId(credential.id)}
                  </p>
                </div>
                {credential.attestation.verified && credential.attestation.hardwareBacked && (
                  <span className="badge-green shrink-0 inline-flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Verified hardware key
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
