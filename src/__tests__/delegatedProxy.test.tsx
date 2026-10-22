import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Keypair } from '@stellar/stellar-sdk';
import { useRouter } from 'next/navigation';
import {
  cosignatureMessage,
  createSupervisorCosignature,
  hashDraftContent,
  isProxyTokenActive,
  proxyBannerLabel,
  verifySupervisorCosignature,
} from '@/lib/delegatedProxy';
import { sep53Digest } from '@/lib/stellar';
import {
  fetchProxyEncounterDrafts,
  requestDelegatedProxyToken,
  revokeDelegatedProxyToken,
  submitSupervisorCosignature,
} from '@/services/api.service';
import { useProxyStore } from '@/store/proxyStore';
import { useWalletStore } from '@/store/useWalletStore';
import { Header } from '@/components/navigation/Header';
import ResidentSupervision from '@/components/doctor/ResidentSupervision';
import type { DelegatedProxyToken, EncounterDraft } from '@/types';

jest.mock('@/hooks/useToast', () => ({ useToast: jest.fn() }));
jest.mock('@/services/api.service', () => ({
  requestDelegatedProxyToken: jest.fn(),
  revokeDelegatedProxyToken: jest.fn(),
  fetchProxyEncounterDrafts: jest.fn(),
  submitSupervisorCosignature: jest.fn(),
}));

const mocked = {
  request: requestDelegatedProxyToken as jest.MockedFunction<typeof requestDelegatedProxyToken>,
  revoke: revokeDelegatedProxyToken as jest.MockedFunction<typeof revokeDelegatedProxyToken>,
  drafts: fetchProxyEncounterDrafts as jest.MockedFunction<typeof fetchProxyEncounterDrafts>,
  cosign: submitSupervisorCosignature as jest.MockedFunction<typeof submitSupervisorCosignature>,
};

const SUPERVISOR = Keypair.random();
const RESIDENT = Keypair.random().publicKey();
const NOW = Date.parse('2026-10-22T12:00:00.000Z');

function token(overrides: Partial<DelegatedProxyToken> = {}): DelegatedProxyToken {
  return {
    tokenId: 'proxy-1',
    supervisorAddress: SUPERVISOR.publicKey(),
    supervisorName: 'Dr. Ada Attending',
    residentAddress: RESIDENT,
    residentName: 'Jane Doe',
    scopes: ['encounter:read', 'encounter:cosign'],
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    ...overrides,
  };
}

function draft(overrides: Partial<EncounterDraft> = {}): EncounterDraft {
  return {
    id: 'draft-1',
    appointmentId: 'appt-1',
    patientAddress: Keypair.random().publicKey(),
    patientName: 'John Patient',
    residentAddress: RESIDENT,
    residentName: 'Jane Doe',
    content: 'Assessment: viral URI.\nPlan: fluids, rest.',
    status: 'pending_cosign',
    createdAt: '2026-10-22T11:00:00.000Z',
    updatedAt: '2026-10-22T11:00:00.000Z',
    ...overrides,
  };
}

/** SEP-53 signer backed by a local keypair, standing in for Freighter. */
const keypairSigner = jest.fn(async (message: string) =>
  SUPERVISOR.sign(sep53Digest(message)).toString('base64'),
);

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  useProxyStore.setState({ activeToken: null, cosignatureLog: [] });
  useWalletStore.setState({ publicKey: SUPERVISOR.publicKey(), role: 'DOCTOR' });
  mocked.revoke.mockResolvedValue(undefined);
});

describe('delegated proxy helpers', () => {
  it('formats the header banner label', () => {
    expect(proxyBannerLabel({ residentName: 'Jane Doe' })).toBe(
      'Viewing in Delegated Resident Mode (Dr. Jane Doe)',
    );
    expect(proxyBannerLabel({ residentName: 'Dr. Jane Doe' })).toBe(
      'Viewing in Delegated Resident Mode (Dr. Jane Doe)',
    );
  });

  it('honours the token validity window', () => {
    const t = token({
      issuedAt: new Date(NOW - 1000).toISOString(),
      expiresAt: new Date(NOW + 1000).toISOString(),
    });
    expect(isProxyTokenActive(t, NOW)).toBe(true);
    expect(isProxyTokenActive(t, NOW + 1000)).toBe(false);
    expect(isProxyTokenActive({ ...t, expiresAt: 'garbage' }, NOW)).toBe(false);
  });

  it('co-signs the exact draft content and verifies it', async () => {
    const d = draft();
    const cosignature = await createSupervisorCosignature({
      draft: d,
      token: token(),
      signMessage: keypairSigner,
    });

    expect(cosignature).toMatchObject({
      draftId: 'draft-1',
      proxyTokenId: 'proxy-1',
      supervisorAddress: SUPERVISOR.publicKey(),
      residentAddress: RESIDENT,
      contentHash: await hashDraftContent(d.content),
    });
    const { signature, ...fields } = cosignature;
    expect(keypairSigner).toHaveBeenCalledWith(cosignatureMessage(fields), SUPERVISOR.publicKey());
    expect(signature).toBeTruthy();

    await expect(verifySupervisorCosignature(cosignature, d.content)).resolves.toBe(true);
    await expect(verifySupervisorCosignature(cosignature, `${d.content} (edited)`)).resolves.toBe(
      false,
    );
    await expect(
      verifySupervisorCosignature({ ...cosignature, draftId: 'draft-2' }, d.content),
    ).resolves.toBe(false);
  });

  it('refuses to co-sign outside the token’s authority', async () => {
    const cases: Array<[DelegatedProxyToken, EncounterDraft, RegExp]> = [
      [token({ expiresAt: new Date(Date.now() - 1).toISOString() }), draft(), /expired/],
      [token({ scopes: ['encounter:read'] }), draft(), /does not allow co-signing/],
      [token(), draft({ residentAddress: Keypair.random().publicKey() }), /different resident/],
      [token(), draft({ status: 'cosigned' }), /not awaiting/],
    ];
    for (const [t, d, message] of cases) {
      await expect(
        createSupervisorCosignature({ draft: d, token: t, signMessage: keypairSigner }),
      ).rejects.toThrow(message);
    }
    expect(keypairSigner).not.toHaveBeenCalled();
  });
});

describe('proxy store', () => {
  it('refuses an expired token and clears the log on exit', () => {
    const { enterProxyMode } = useProxyStore.getState();
    expect(enterProxyMode(token({ expiresAt: new Date(Date.now() - 1).toISOString() }))).toBe(
      false,
    );
    expect(useProxyStore.getState().activeToken).toBeNull();

    expect(enterProxyMode(token())).toBe(true);
    act(() => useProxyStore.getState().exitProxyMode());
    expect(useProxyStore.getState()).toMatchObject({ activeToken: null, cosignatureLog: [] });
  });
});

describe('navigation header', () => {
  it('shows the delegated mode banner and exits proxy mode in one click', () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push, replace: jest.fn() });
    useProxyStore.getState().enterProxyMode(token());

    render(<Header />);

    expect(screen.getByRole('status', { name: 'Delegated proxy mode' })).toHaveTextContent(
      'Viewing in Delegated Resident Mode (Dr. Jane Doe)',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Exit Proxy Mode' }));

    expect(useProxyStore.getState().activeToken).toBeNull();
    expect(mocked.revoke).toHaveBeenCalledWith('proxy-1');
    expect(push).toHaveBeenCalledWith('/dashboard/doctor');
    expect(screen.queryByText(/Delegated Resident Mode/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exit Proxy Mode' })).not.toBeInTheDocument();
  });

  it('leaves proxy mode automatically when the token expires', () => {
    jest.useFakeTimers();
    try {
      useProxyStore
        .getState()
        .enterProxyMode(token({ expiresAt: new Date(Date.now() + 5_000).toISOString() }));
      render(<Header />);
      expect(screen.getByText(/Delegated Resident Mode/)).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(5_000);
      });
      expect(screen.queryByText(/Delegated Resident Mode/)).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('ResidentSupervision', () => {
  const renderPanel = () =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ResidentSupervision signMessage={keypairSigner} />
      </QueryClientProvider>,
    );

  it('starts proxy mode for a resident, co-signs a draft and logs the co-signature', async () => {
    mocked.request.mockResolvedValue(token());
    mocked.drafts.mockResolvedValue([draft()]);
    mocked.cosign.mockImplementation(async (c) => draft({ id: c.draftId, status: 'cosigned' }));

    renderPanel();

    fireEvent.change(screen.getByLabelText('Resident Stellar address'), {
      target: { value: RESIDENT },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enter proxy mode' }));

    expect(await screen.findByText('Drafts by Jane Doe')).toBeInTheDocument();
    expect(mocked.request).toHaveBeenCalledWith(SUPERVISOR.publicKey(), RESIDENT);
    expect(mocked.drafts).toHaveBeenCalledWith('proxy-1');

    fireEvent.click(
      await screen.findByRole('button', { name: 'Approve and co-sign draft draft-1' }),
    );

    await waitFor(() => expect(mocked.cosign).toHaveBeenCalledTimes(1));
    const submitted = mocked.cosign.mock.calls[0]![0];
    await expect(verifySupervisorCosignature(submitted, draft().content)).resolves.toBe(true);

    expect(await screen.findByText('co-signed')).toBeInTheDocument();
    const log = screen.getByRole('list', { name: 'Co-signature log' });
    expect(within(log).getByText('draft-1')).toBeInTheDocument();
    expect(useProxyStore.getState().cosignatureLog).toEqual([submitted]);
  });

  it('rejects an invalid resident address without calling the API', async () => {
    renderPanel();

    fireEvent.change(screen.getByLabelText('Resident Stellar address'), {
      target: { value: 'GNOTAKEY' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enter proxy mode' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Stellar address');
    expect(mocked.request).not.toHaveBeenCalled();
  });

  it('refuses a token issued for another resident', async () => {
    mocked.request.mockResolvedValue(token({ residentAddress: Keypair.random().publicKey() }));
    renderPanel();

    fireEvent.change(screen.getByLabelText('Resident Stellar address'), {
      target: { value: RESIDENT },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enter proxy mode' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('different accounts');
    expect(useProxyStore.getState().activeToken).toBeNull();
  });
});
