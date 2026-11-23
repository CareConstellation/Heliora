'use client';

import { useEffect, useState } from 'react';
import { StrKey } from '@stellar/stellar-sdk';
import { isFederatedAddress, resolveWalletAddress, type FederationResolution } from '@/lib/stellar';
import { federationErrorMessage } from '@/lib/federationInput';

export interface FederatedResolutionState {
  loading: boolean;
  resolution: FederationResolution | null;
  error: string | null;
}

const initial: FederatedResolutionState = { loading: false, resolution: null, error: null };

export function useFederatedResolution(value: string, delay = 250): FederatedResolutionState {
  const [state, setState] = useState<FederatedResolutionState>(initial);
  const input = value.trim();
  const federated = isFederatedAddress(input);

  useEffect(() => {
    let active = true;
    setState(initial);
    if (!input) return;

    if (!federated) {
      if (StrKey.isValidEd25519PublicKey(input)) {
        setState({
          loading: false,
          error: null,
          resolution: {
            address: input,
            publicKey: input,
            memoType: null,
            memo: null,
          },
        });
      }
      return;
    }

    setState({ loading: true, resolution: null, error: null });
    const timer = setTimeout(() => {
      resolveWalletAddress(input)
        .then((resolution) => {
          if (active) setState({ loading: false, resolution, error: null });
        })
        .catch((err: unknown) => {
          if (active)
            setState({ loading: false, resolution: null, error: federationErrorMessage(err) });
        });
    }, delay);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [input, federated, delay]);

  return state;
}

export default function FederationHint({
  value,
  className = 'mt-1 text-2xs text-text-3',
}: {
  value: string;
  className?: string;
}) {
  const state = useFederatedResolution(value);
  if (!isFederatedAddress(value.trim())) return null;
  if (state.loading) return <p className={className}>Looking up federated address…</p>;
  if (state.error) return <p className={`${className} text-red-400`}>{state.error}</p>;
  if (!state.resolution) return null;

  const { publicKey, memoType } = state.resolution;
  return (
    <p className={className}>
      Resolves to{' '}
      <span className="font-mono">{`${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`}</span>
      {memoType ? ` · ${memoType} memo required` : ''}
    </p>
  );
}
