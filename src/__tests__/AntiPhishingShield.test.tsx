import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Keypair } from '@stellar/stellar-sdk';
import AntiPhishingShield from '@/components/auth/AntiPhishingShield';
import {
  computeShieldFingerprint,
  createShieldStore,
  shieldAttestationMessage,
  shieldEnrollmentMessage,
} from '@/lib/antiPhishing';
import { createMemoryKeyProvider } from '@/lib/encryptedLocalStore';
import { sep53Digest } from '@/lib/stellar';
import { fetchShieldAttestation, registerShieldFingerprint } from '@/services/api.service';
import { useAuthStore } from '@/store/authStore';

jest.mock('@/hooks/useToast', () => ({ useToast: jest.fn() }));
jest.mock('@/services/api.service', () => ({
  fetchShieldAttestation: jest.fn(),
  registerShieldFingerprint: jest.fn(),
}));

const mockedFetch = fetchShieldAttestation as jest.MockedFunction<typeof fetchShieldAttestation>;
const mockedRegister = registerShieldFingerprint as jest.MockedFunction<
  typeof registerShieldFingerprint
>;

const USER = Keypair.random().publicKey();
const SERVER = Keypair.random();
const ORIGIN = window.location.origin;

async function serverAttests(icon: 'leaf' | 'sun', phrase: string) {
  const fingerprint = await computeShieldFingerprint(USER, { icon, phrase });
  const fields = {
    publicKey: USER,
    fingerprint,
    origin: ORIGIN,
    issuedAt: new Date().toISOString(),
  };
  const signature = SERVER.sign(sep53Digest(shieldAttestationMessage(fields))).toString('base64');
  mockedFetch.mockResolvedValue({ ...fields, signature });
}

let store: ReturnType<typeof createShieldStore>;
const signMessage = jest.fn(async () => 'wallet-signature');

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  process.env.NEXT_PUBLIC_AUTH_SIGNING_KEY = SERVER.publicKey();
  store = createShieldStore(createMemoryKeyProvider());
  useAuthStore.setState({ shieldStatus: null });
});

describe('AntiPhishingShield', () => {
  it('offers setup when no shield exists, then saves, registers and verifies it', async () => {
    mockedFetch.mockResolvedValue(null);
    mockedRegister.mockImplementation(async () => {
      await serverAttests('leaf', 'blue heron');
      return { registered: true };
    });

    render(<AntiPhishingShield publicKey={USER} store={store} signMessage={signMessage} />);

    expect(await screen.findByText('Set up your security shield')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save security shield' });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'leaf' }));
    fireEvent.change(screen.getByLabelText('Security phrase'), {
      target: { value: 'blue heron' },
    });
    fireEvent.click(save);

    expect(await screen.findByTestId('shield-phrase')).toHaveTextContent('blue heron');
    expect(await screen.findByText(/Verified: Heliora confirmed/)).toBeInTheDocument();

    const fingerprint = await computeShieldFingerprint(USER, {
      icon: 'leaf',
      phrase: 'blue heron',
    });
    const enrollment = mockedRegister.mock.calls[0]![0];
    expect(enrollment).toMatchObject({ publicKey: USER, fingerprint, origin: ORIGIN });
    expect(signMessage).toHaveBeenCalledWith(
      shieldEnrollmentMessage(USER, fingerprint, ORIGIN, enrollment.issuedAt),
      USER,
    );
    expect(useAuthStore.getState().shieldStatus).toBe('verified');
    await expect(store.load(USER)).resolves.toMatchObject({ icon: 'leaf', phrase: 'blue heron' });
  });

  it('shows the stored shield as verified when the attestation matches', async () => {
    await store.save(USER, { icon: 'leaf', phrase: 'blue heron', createdAt: 'x' });
    await serverAttests('leaf', 'blue heron');

    render(<AntiPhishingShield publicKey={USER} store={store} signMessage={signMessage} />);

    expect(await screen.findByTestId('shield-phrase')).toHaveTextContent('blue heron');
    expect(await screen.findByText(/Verified/)).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledWith(USER, ORIGIN);
  });

  it('warns when the shield does not match the server attestation', async () => {
    await store.save(USER, { icon: 'leaf', phrase: 'blue heron', createdAt: 'x' });
    await serverAttests('sun', 'blue heron');

    render(<AntiPhishingShield publicKey={USER} store={store} signMessage={signMessage} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'does not match the one Heliora has on record',
    );
    await waitFor(() => expect(useAuthStore.getState().shieldStatus).toBe('mismatch'));
  });

  it('keeps the local shield but reports it when registration fails', async () => {
    mockedFetch.mockResolvedValue(null);
    mockedRegister.mockRejectedValue({ message: 'Network Error', status: 500 });

    render(<AntiPhishingShield publicKey={USER} store={store} signMessage={signMessage} />);

    fireEvent.click(await screen.findByRole('radio', { name: 'sun' }));
    fireEvent.change(screen.getByLabelText('Security phrase'), { target: { value: 'tide pool' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save security shield' }));

    expect(
      await screen.findByText(/could not be registered with Heliora: Network Error/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('shield-phrase')).toHaveTextContent('tide pool');
    expect(screen.getByRole('button', { name: 'Register shield' })).toBeInTheDocument();
  });

  it('marks the check as not configured without a server signing key', async () => {
    delete process.env.NEXT_PUBLIC_AUTH_SIGNING_KEY;
    await store.save(USER, { icon: 'leaf', phrase: 'blue heron', createdAt: 'x' });

    render(<AntiPhishingShield publicKey={USER} store={store} signMessage={signMessage} />);

    expect(await screen.findByText(/cross-check is not configured/)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
