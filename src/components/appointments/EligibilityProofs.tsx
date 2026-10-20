'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  MIN_CONSULTATION_AGE,
  generateEligibilityProof,
  parseCredential,
  verifyEligibilityProof,
} from '@/lib/zkEligibility';
import { fetchEligibilityCommitments } from '@/services/api.service';
import { useWalletStore } from '@/store/useWalletStore';
import type { EligibilityKind, EligibilityProofToken } from '@/types';

const LABELS: Record<EligibilityKind, string> = {
  age18: `Age ${MIN_CONSULTATION_AGE}+`,
  insurance: 'Active insurance',
};
const CREDENTIAL_TYPE: Record<EligibilityKind, 'age' | 'insurance'> = {
  age18: 'age',
  insurance: 'insurance',
};

interface Props {
  proofs: EligibilityProofToken[];
  onChange: (proofs: EligibilityProofToken[]) => void;
}

/**
 * Private eligibility checks for booking. The issuer credential file is read in
 * the browser, a Groth16 proof is generated, and the proof is verified against
 * the public verification key and this patient's registered commitment. Only the
 * proof token is kept; the credential itself is discarded.
 */
export default function EligibilityProofs({ proofs, onChange }: Props) {
  const { publicKey } = useWalletStore();
  const [busy, setBusy] = useState<EligibilityKind | null>(null);
  const [error, setError] = useState('');

  const commitments = useQuery({
    queryKey: ['eligibility-commitments', publicKey],
    queryFn: () => fetchEligibilityCommitments(publicKey!),
    enabled: !!publicKey,
  });

  async function prove(kind: EligibilityKind, file: File) {
    setBusy(kind);
    setError('');
    try {
      const credential = parseCredential(await file.text());
      if (credential.type !== CREDENTIAL_TYPE[kind])
        throw new Error(`That credential is not for ${LABELS[kind]}.`);
      const expected = commitments.data?.[kind];
      if (!expected)
        throw new Error(`No ${LABELS[kind]} credential is registered for your account.`);
      const token = await generateEligibilityProof(credential);
      if (!(await verifyEligibilityProof(token, expected))) {
        throw new Error('The proof did not verify against your registered credential.');
      }
      onChange([...proofs.filter((p) => p.kind !== kind), token]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the proof.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p className="block text-xs font-medium text-slate-600 mb-1">
        Private eligibility (optional)
      </p>
      <p className="text-xs text-text-3 mb-2">
        Prove eligibility with a zero-knowledge proof. Your date of birth and policy number never
        leave this device.
      </p>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(LABELS) as EligibilityKind[]).map((kind) => {
          const verified = proofs.some((p) => p.kind === kind);
          return (
            <label
              key={kind}
              className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium ${
                verified
                  ? 'border-green bg-green-50 text-green-700'
                  : 'border-border text-text-1 hover:bg-surface-hover'
              }`}
            >
              {busy === kind
                ? 'Generating proof…'
                : verified
                  ? `✓ ${LABELS[kind]} verified`
                  : `Prove ${LABELS[kind]}`}
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                disabled={busy !== null || !commitments.isSuccess}
                aria-label={`Load ${LABELS[kind]} credential`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void prove(kind, file);
                }}
              />
            </label>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
