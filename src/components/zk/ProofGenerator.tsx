'use client';

import { useState } from 'react';
import {
  MIN_CONSULTATION_AGE,
  checkDeviceMemory,
  generateEligibilityProof,
  isWasmMemoryError,
  parseCredential,
  verifyEligibilityProof,
  ZkMemoryError,
  type EligibilityCredential,
  type ZkProofProgress,
} from '@/lib/zkEligibility';
import type { EligibilityCommitments, EligibilityProofToken } from '@/types';

const STAGE_LABELS: Record<ZkProofProgress['stage'], string> = {
  artifacts: 'Loading circuit artifacts…',
  integrity: 'Checking artifact integrity…',
  witness: 'Computing witness…',
  prove: 'Generating zero-knowledge proof…',
  done: 'Proof ready',
};

const LABELS = {
  age18: `Age ${MIN_CONSULTATION_AGE}+`,
  insurance: 'Active insurance',
} as const;

interface Props {
  commitments?: EligibilityCommitments | undefined;
  onProof?: (token: EligibilityProofToken) => void;
}

/**
 * Standalone proof generator. Reads an issuer credential in the browser, shows
 * the worker's progress stages as a percentage, and verifies the result against
 * the patient's registered commitment before handing it on.
 */
export default function ProofGenerator({ commitments, onProof }: Props) {
  const [progress, setProgress] = useState<ZkProofProgress | null>(null);
  const [proof, setProof] = useState<EligibilityProofToken | null>(null);
  const [error, setError] = useState('');
  const [memoryWarning] = useState<string | null>(() => {
    const memCheck = checkDeviceMemory();
    return !memCheck.hasSufficientMemory && memCheck.warning ? memCheck.warning : null;
  });

  async function generate(file: File) {
    setError('');
    setProof(null);
    setProgress({ stage: 'artifacts', percent: 0 });
    try {
      const credential: EligibilityCredential = parseCredential(await file.text());
      const kind = credential.type === 'age' ? 'age18' : 'insurance';
      const token = await generateEligibilityProof(credential, new Date(), undefined, {
        onProgress: setProgress,
      });
      const expected = commitments?.[kind];
      if (expected && !(await verifyEligibilityProof(token, expected))) {
        throw new Error('The proof did not verify against your registered credential.');
      }
      setProof(token);
      onProof?.(token);
    } catch (err) {
      if (isWasmMemoryError(err) || err instanceof ZkMemoryError) {
        setError(
          'Device memory is insufficient for generating zero-knowledge proofs. Please try on a desktop browser or device with at least 4GB of RAM.',
        );
      } else {
        setError(err instanceof Error ? err.message : 'Could not create the proof.');
      }
      setProgress(null);
    }
  }

  return (
    <div>
      {memoryWarning && (
        <div
          role="alert"
          className="mb-3 text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded p-2.5"
        >
          <span className="font-semibold">⚠️ Low Device Memory:</span> {memoryWarning}
        </div>
      )}
      <p className="block text-xs font-medium text-slate-600 mb-1">Generate an eligibility proof</p>
      <p className="text-xs text-text-3 mb-2">
        Proving runs in a background worker. Your date of birth and policy number never leave this
        device.
      </p>
      <label className="inline-block cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-1 hover:bg-surface-hover">
        {progress && progress.percent < 100 ? 'Generating…' : 'Load credential'}
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          disabled={!!progress && progress.percent < 100}
          aria-label="Load eligibility credential"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void generate(file);
          }}
        />
      </label>

      {progress && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-xs text-text-2">
            <span aria-live="polite">{STAGE_LABELS[progress.stage]}</span>
            <span aria-hidden="true">{progress.percent}%</span>
          </div>
          <div
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
            aria-label="Proof generation progress"
          >
            <div
              className="h-full rounded-full bg-blue-600 transition-[width] duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      {proof && (
        <p className="mt-2 text-xs text-green-700">
          ✓ {LABELS[proof.kind]} proof generated and verified locally.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
