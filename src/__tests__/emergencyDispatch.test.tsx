jest.mock('@stellar/freighter-api', () => ({
  signMessage: jest.fn(),
  signTransaction: jest.fn(),
  isConnected: jest.fn(),
  getAddress: jest.fn(),
  getNetwork: jest.fn(),
  requestAccess: jest.fn(),
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Keypair } from '@stellar/stellar-sdk';
import EmergencyDispatchModal from '@/components/consultation/EmergencyDispatchModal';
import {
  buildEmergencyDispatchPayload,
  canonicalJson,
  createEmergencyProfileStore,
  dispatchEmergencyWebhook,
  EMERGENCY_CONFIRM_MIN_DELAY_MS,
  EMERGENCY_CONFIRM_WINDOW_MS,
  emergencyGateRemainingMs,
  formatEmergencyAddress,
  INITIAL_EMERGENCY_GATE,
  loadPatientEmergencyProfile,
  pressEmergencyGate,
  signEmergencyDispatch,
  verifyEmergencyDispatch,
  type EmergencyGateState,
  type EmergencyProfile,
} from '@/lib/breakGlassMultiSigProtocol';
import { createMemoryKeyProvider } from '@/lib/encryptedLocalStore';
import { sep53Digest, type MessageSigner } from '@/lib/stellar';

/** Minimal fetch Response (jsdom has no global Response). */
const res = (status: number, body: unknown = null) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const keypairSigner =
  (kp: Keypair): MessageSigner =>
  async (message) =>
    kp.sign(sep53Digest(message)).toString('base64');

const PROFILE: EmergencyProfile = {
  address: {
    line1: '221B Baker Street',
    line2: 'Flat 2',
    city: 'London',
    postalCode: 'NW1 6XE',
    country: 'UK',
    accessNotes: 'Buzzer broken, knock',
  },
  phone: '+44 20 7946 0000',
  updatedAt: '2026-11-01T10:00:00.000Z',
};

const confirmedGate = (): EmergencyGateState => {
  const armed = pressEmergencyGate(INITIAL_EMERGENCY_GATE, 1_000).state;
  return pressEmergencyGate(armed, 1_000 + EMERGENCY_CONFIRM_MIN_DELAY_MS + 100).state;
};

/* ── Confirmation safety gate ───────────────────────────────────── */

describe('emergency confirmation gate (#268)', () => {
  it('first click only arms; nothing is confirmed', () => {
    const r = pressEmergencyGate(INITIAL_EMERGENCY_GATE, 0);
    expect(r.action).toBe('armed');
    expect(r.state.status).toBe('armed');
  });

  it('a second click after the minimum delay confirms', () => {
    const armed = pressEmergencyGate(INITIAL_EMERGENCY_GATE, 0).state;
    const r = pressEmergencyGate(armed, EMERGENCY_CONFIRM_MIN_DELAY_MS);
    expect(r.action).toBe('confirmed');
    expect(r.state).toEqual({ status: 'confirmed', armedAt: 0, confirmedAt: EMERGENCY_CONFIRM_MIN_DELAY_MS });
  });

  it('ignores an accidental double-click (second click too fast)', () => {
    const armed = pressEmergencyGate(INITIAL_EMERGENCY_GATE, 0).state;
    const r = pressEmergencyGate(armed, 150);
    expect(r).toMatchObject({ action: 'ignored', reason: 'too-fast' });
    expect(r.state.status).toBe('armed');
  });

  it('re-arms instead of confirming when the window has expired', () => {
    const armed = pressEmergencyGate(INITIAL_EMERGENCY_GATE, 0).state;
    const r = pressEmergencyGate(armed, EMERGENCY_CONFIRM_WINDOW_MS + 1);
    expect(r).toMatchObject({ action: 're-armed', reason: 'expired' });
    expect(r.state).toEqual({ status: 'armed', armedAt: EMERGENCY_CONFIRM_WINDOW_MS + 1 });
  });

  it('never confirms twice', () => {
    const r = pressEmergencyGate(confirmedGate(), 99_999);
    expect(r).toMatchObject({ action: 'ignored', reason: 'already-confirmed' });
  });

  it('reports remaining confirmation time', () => {
    const armed = pressEmergencyGate(INITIAL_EMERGENCY_GATE, 0).state;
    expect(emergencyGateRemainingMs(armed, 4_000)).toBe(EMERGENCY_CONFIRM_WINDOW_MS - 4_000);
    expect(emergencyGateRemainingMs(armed, EMERGENCY_CONFIRM_WINDOW_MS + 5)).toBe(0);
    expect(emergencyGateRemainingMs(INITIAL_EMERGENCY_GATE, 0)).toBe(0);
  });
});

/* ── Encrypted profile ──────────────────────────────────────────── */

describe('encrypted emergency profile (#268)', () => {
  beforeEach(() => localStorage.clear());

  it('stores the address sealed and decrypts it for the right patient only', async () => {
    const store = createEmergencyProfileStore({ keyProvider: createMemoryKeyProvider() });
    await store.save('GPATIENT', PROFILE);

    const raw = localStorage.getItem('heliora-emergency-profile:GPATIENT')!;
    expect(raw).not.toContain('Baker Street');

    await expect(loadPatientEmergencyProfile('GPATIENT', store)).resolves.toEqual({ profile: PROFILE });
    await expect(loadPatientEmergencyProfile('GOTHER', store)).resolves.toEqual({ profile: null });

    // A ciphertext moved to another patient's slot must not decrypt.
    localStorage.setItem('heliora-emergency-profile:GOTHER', raw);
    const swapped = await loadPatientEmergencyProfile('GOTHER', store);
    expect(swapped.profile).toBeNull();
    expect(swapped.error).toMatch(/could not be decrypted/i);
  });

  it('formats a dispatcher-readable address', () => {
    expect(formatEmergencyAddress(PROFILE.address)).toBe('221B Baker Street, Flat 2, London, NW1 6XE, UK');
  });
});

/* ── Payload, signature, webhook ────────────────────────────────── */

describe('signed emergency dispatch (#268)', () => {
  const initiator = Keypair.random();
  const base = {
    appointmentId: 'appt-1',
    patientAddress: 'GPATIENT',
    initiatedBy: initiator.publicKey(),
    initiatorRole: 'DOCTOR' as const,
    reason: 'Difficulty breathing',
    location: { formatted: formatEmergencyAddress(PROFILE.address), address: PROFILE.address, source: 'encrypted-profile' as const },
    now: new Date('2026-11-25T12:00:00.000Z'),
    dispatchId: 'emg_test',
  };

  it('refuses to build a payload without a confirmed gate', () => {
    expect(() => buildEmergencyDispatchPayload({ ...base, gate: INITIAL_EMERGENCY_GATE })).toThrow(/two-step/i);
    const armed = pressEmergencyGate(INITIAL_EMERGENCY_GATE, 0).state;
    expect(() => buildEmergencyDispatchPayload({ ...base, gate: armed })).toThrow(/two-step/i);
  });

  it('requires a reason', () => {
    expect(() => buildEmergencyDispatchPayload({ ...base, reason: '  ', gate: confirmedGate() })).toThrow(/reason/i);
  });

  it('canonical JSON is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      canonicalJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
    );
  });

  it('is signed by the initiator and verifiable; tampering breaks verification', async () => {
    const payload = buildEmergencyDispatchPayload({ ...base, gate: confirmedGate() });
    const signed = await signEmergencyDispatch(payload, keypairSigner(initiator));
    expect(verifyEmergencyDispatch(signed)).toBe(true);

    const moved = { ...signed, payload: { ...signed.payload, location: null } };
    expect(verifyEmergencyDispatch(moved)).toBe(false);

    const forged = await signEmergencyDispatch(payload, keypairSigner(Keypair.random()));
    expect(verifyEmergencyDispatch(forged)).toBe(false);
  });

  it('posts the signed payload with signature and idempotency headers', async () => {
    const signed = await signEmergencyDispatch(
      buildEmergencyDispatchPayload({ ...base, gate: confirmedGate() }),
      keypairSigner(initiator),
    );
    const fetchImpl = jest.fn(async () => res(202, { accepted: true }));
    const receipt = await dispatchEmergencyWebhook(signed, { endpoint: 'https://dispatch.test/hook', fetchImpl });

    expect(receipt).toEqual({ dispatchId: 'emg_test', status: 202, attempts: 1, body: { accepted: true } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://dispatch.test/hook');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('emg_test');
    expect(headers['X-Heliora-Signer']).toBe(initiator.publicKey());
    expect(headers['X-Heliora-Signature']).toBe(signed.signature);
    expect(JSON.parse(init.body as string)).toEqual(signed);
  });

  it('retries transient 5xx / network failures with the same idempotency key', async () => {
    const signed = await signEmergencyDispatch(
      buildEmergencyDispatchPayload({ ...base, gate: confirmedGate() }),
      keypairSigner(initiator),
    );
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200, {}));
    const receipt = await dispatchEmergencyWebhook(signed, { fetchImpl, retryDelayMs: 0 });
    expect(receipt.attempts).toBe(3);
    const keys = fetchImpl.mock.calls.map((c) => (c[1] as RequestInit).headers as Record<string, string>);
    expect(new Set(keys.map((h) => h['Idempotency-Key']))).toEqual(new Set(['emg_test']));
  });

  it('does not retry a 4xx rejection', async () => {
    const signed = await signEmergencyDispatch(
      buildEmergencyDispatchPayload({ ...base, gate: confirmedGate() }),
      keypairSigner(initiator),
    );
    const fetchImpl = jest.fn(async () => res(401));
    await expect(dispatchEmergencyWebhook(signed, { fetchImpl, retryDelayMs: 0 })).rejects.toThrow(/401/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

/* ── Modal ──────────────────────────────────────────────────────── */

describe('EmergencyDispatchModal (#268)', () => {
  const initiator = Keypair.random();
  let clock = 0;
  const now = () => clock;

  async function setup(withProfile = true) {
    localStorage.clear();
    const profileStore = createEmergencyProfileStore({ keyProvider: createMemoryKeyProvider() });
    if (withProfile) await profileStore.save('GPATIENT', PROFILE);
    const fetchImpl = jest.fn(async () => res(202, {}));
    const signMessage = jest.fn(keypairSigner(initiator));
    const onDispatched = jest.fn();
    render(
      <EmergencyDispatchModal
        appointmentId="appt-1"
        patientAddress="GPATIENT"
        initiatorAddress={initiator.publicKey()}
        initiatorRole="DOCTOR"
        onClose={jest.fn()}
        onDispatched={onDispatched}
        profileStore={profileStore}
        signMessage={signMessage}
        dispatchOptions={{ fetchImpl, retryDelayMs: 0 }}
        now={now}
      />,
    );
    return { fetchImpl, signMessage, onDispatched };
  }

  const mainButton = () =>
    screen.getByRole('button', { name: /request emergency services|tap again to confirm|notifying/i });

  beforeEach(() => {
    clock = 1_000;
  });

  it('shows the decrypted emergency address', async () => {
    await setup();
    expect(await screen.findByTestId('emergency-address')).toHaveTextContent('221B Baker Street, Flat 2, London');
    expect(screen.getByTestId('emergency-address')).toHaveTextContent('Buzzer broken');
  });

  it('a single click arms but never dispatches', async () => {
    const { fetchImpl, signMessage } = await setup();
    await screen.findByTestId('emergency-address');
    fireEvent.click(mainButton());
    expect(mainButton()).toHaveTextContent(/tap again to confirm/i);
    expect(signMessage).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('an accidental double-click does not dispatch', async () => {
    const { fetchImpl } = await setup();
    await screen.findByTestId('emergency-address');
    fireEvent.click(mainButton());
    clock += 100;
    fireEvent.click(mainButton());
    await act(async () => {});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('dispatches a signed webhook on a deliberate second click', async () => {
    const { fetchImpl, signMessage, onDispatched } = await setup();
    await screen.findByTestId('emergency-address');
    fireEvent.click(mainButton());
    clock += EMERGENCY_CONFIRM_MIN_DELAY_MS + 50;
    fireEvent.click(mainButton());

    await waitFor(() => expect(onDispatched).toHaveBeenCalled());
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(verifyEmergencyDispatch(body)).toBe(true);
    expect(body.payload.location.source).toBe('encrypted-profile');
    expect(body.payload.callbackPhone).toBe(PROFILE.phone);
    expect(await screen.findByRole('status')).toHaveTextContent(/emergency services notified/i);
  });

  it('asks for the address verbally when none is on file', async () => {
    await setup(false);
    expect(await screen.findByRole('alert')).toHaveTextContent(/no emergency address is on file/i);
    expect(screen.getByLabelText('Street address')).toBeInTheDocument();
  });

  it('requires a fresh two-step confirmation after a failed dispatch', async () => {
    localStorage.clear();
    const profileStore = createEmergencyProfileStore({ keyProvider: createMemoryKeyProvider() });
    await profileStore.save('GPATIENT', PROFILE);
    const fetchImpl = jest.fn(async () => res(400));
    render(
      <EmergencyDispatchModal
        appointmentId="appt-1"
        patientAddress="GPATIENT"
        initiatorAddress={initiator.publicKey()}
        initiatorRole="DOCTOR"
        onClose={jest.fn()}
        profileStore={profileStore}
        signMessage={keypairSigner(initiator)}
        dispatchOptions={{ fetchImpl, retryDelayMs: 0 }}
        now={now}
      />,
    );
    await screen.findByTestId('emergency-address');
    fireEvent.click(mainButton());
    clock += 1_000;
    fireEvent.click(mainButton());
    expect(await screen.findByText(/dispatch failed/i)).toHaveTextContent(/call 911 directly/i);

    clock += 1_000;
    fireEvent.click(mainButton()); // only re-arms
    await act(async () => {});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(mainButton()).toHaveTextContent(/tap again to confirm/i);
  });
});
