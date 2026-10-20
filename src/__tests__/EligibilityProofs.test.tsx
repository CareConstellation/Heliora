import { TextDecoder, TextEncoder } from 'node:util';

Object.assign(globalThis, { TextEncoder, TextDecoder });

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import EligibilityProofs from '@/components/appointments/EligibilityProofs';
import type { EligibilityProofToken } from '@/types';

jest.mock('@/store/useWalletStore', () => ({ useWalletStore: () => ({ publicKey: 'GPATIENT' }) }));
jest.mock('@/services/api.service', () => ({
  fetchEligibilityCommitments: jest.fn(async () => ({ age18: '111', insurance: '222' })),
}));
jest.mock('@/lib/zkEligibility', () => ({
  ...jest.requireActual('@/lib/zkEligibility'),
  generateEligibilityProof: jest.fn(),
  verifyEligibilityProof: jest.fn(),
}));

const zk = jest.requireMock('@/lib/zkEligibility');
const token: EligibilityProofToken = {
  kind: 'age18',
  proof: { pi_a: ['1'], pi_b: [['2']], pi_c: ['3'], protocol: 'groth16', curve: 'bn128' },
  publicSignals: ['20081020', '111'],
};

function Harness({ onProofs }: { onProofs: (p: EligibilityProofToken[]) => void }) {
  const [proofs, setProofs] = useState<EligibilityProofToken[]>([]);
  return (
    <EligibilityProofs
      proofs={proofs}
      onChange={(p) => {
        setProofs(p);
        onProofs(p);
      }}
    />
  );
}

function setup() {
  const onProofs = jest.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness onProofs={onProofs} />
    </QueryClientProvider>,
  );
  return onProofs;
}

// jsdom's File lacks Blob.text() (available in all current browsers), so attach it.
const credentialFile = (json: object) =>
  Object.assign(new File([JSON.stringify(json)], 'credential.json', { type: 'application/json' }), {
    text: async () => JSON.stringify(json),
  });
const ageCredential = { type: 'age', birthDate: '1990-05-17', salt: '42', commitment: '111' };

describe('EligibilityProofs (#27)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('verifies the proof against the registered commitment and keeps only the proof token', async () => {
    zk.generateEligibilityProof.mockResolvedValueOnce(token);
    zk.verifyEligibilityProof.mockResolvedValueOnce(true);
    const onProofs = setup();

    const input = await screen.findByLabelText('Load Age 18+ credential');
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { files: [credentialFile(ageCredential)] } });

    await waitFor(() => expect(onProofs).toHaveBeenCalledWith([token]));
    expect(zk.verifyEligibilityProof).toHaveBeenCalledWith(token, '111');
    expect(JSON.stringify(onProofs.mock.calls)).not.toContain('1990-05-17');
    expect(screen.getByText('✓ Age 18+ verified')).toBeInTheDocument();
  });

  it('does not keep a proof that fails verification', async () => {
    zk.generateEligibilityProof.mockResolvedValueOnce(token);
    zk.verifyEligibilityProof.mockResolvedValueOnce(false);
    const onProofs = setup();

    const input = await screen.findByLabelText('Load Age 18+ credential');
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { files: [credentialFile(ageCredential)] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('did not verify');
    expect(onProofs).not.toHaveBeenCalled();
  });

  it('rejects a credential of the wrong kind before proving', async () => {
    setup();
    const input = await screen.findByLabelText('Load Active insurance credential');
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { files: [credentialFile(ageCredential)] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('not for Active insurance');
    expect(zk.generateEligibilityProof).not.toHaveBeenCalled();
  });
});
