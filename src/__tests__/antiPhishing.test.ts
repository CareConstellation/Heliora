import { Keypair } from '@stellar/stellar-sdk';
import {
  ATTESTATION_MAX_AGE_MS,
  checkOfficialDomain,
  computeShieldFingerprint,
  createShieldStore,
  isShieldCompromised,
  shieldAttestationMessage,
  validateShield,
  verifyShieldAttestation,
} from '@/lib/antiPhishing';
import { createMemoryKeyProvider, createEncryptedLocalStore } from '@/lib/encryptedLocalStore';
import { sep53Digest } from '@/lib/stellar';
import type { ShieldAttestation } from '@/types';

jest.mock('@/hooks/useToast', () => ({ useToast: jest.fn() }));

const USER = Keypair.random().publicKey();
const OTHER_USER = Keypair.random().publicKey();
const SERVER = Keypair.random();
const ORIGIN = 'https://app.heliora.io';
const NOW = Date.parse('2026-10-22T12:00:00.000Z');

function signAttestation(
  fields: Omit<ShieldAttestation, 'signature'>,
  signer: Keypair = SERVER,
): ShieldAttestation {
  const signature = signer.sign(sep53Digest(shieldAttestationMessage(fields))).toString('base64');
  return { ...fields, signature };
}

async function attestationFor(overrides: Partial<Omit<ShieldAttestation, 'signature'>> = {}) {
  const fingerprint = await computeShieldFingerprint(USER, { icon: 'leaf', phrase: 'blue heron' });
  return {
    fingerprint,
    attestation: signAttestation({
      publicKey: USER,
      fingerprint,
      origin: ORIGIN,
      issuedAt: new Date(NOW - 1000).toISOString(),
      ...overrides,
    }),
  };
}

const verify = (attestation: ShieldAttestation, expectedFingerprint: string) =>
  verifyShieldAttestation({
    attestation,
    publicKey: USER,
    expectedFingerprint,
    origin: ORIGIN,
    serverSigningKey: SERVER.publicKey(),
    now: NOW,
  });

describe('validateShield', () => {
  it('accepts a known icon and a phrase within bounds', () => {
    expect(validateShield('leaf', '  blue heron  ')).toBeNull();
  });

  it('rejects unknown icons and phrases that are too short or too long', () => {
    expect(validateShield('skull', 'blue heron')).toMatch(/icon/);
    expect(validateShield('leaf', ' ab ')).toMatch(/at least/);
    expect(validateShield('leaf', 'x'.repeat(49))).toMatch(/at most/);
  });
});

describe('computeShieldFingerprint', () => {
  it('is deterministic and ignores surrounding whitespace', async () => {
    const a = await computeShieldFingerprint(USER, { icon: 'leaf', phrase: 'blue heron' });
    const b = await computeShieldFingerprint(USER, { icon: 'leaf', phrase: ' blue heron ' });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it('is salted with the account and changes with the icon or phrase', async () => {
    const base = await computeShieldFingerprint(USER, { icon: 'leaf', phrase: 'blue heron' });
    await expect(
      computeShieldFingerprint(OTHER_USER, { icon: 'leaf', phrase: 'blue heron' }),
    ).resolves.not.toBe(base);
    await expect(
      computeShieldFingerprint(USER, { icon: 'sun', phrase: 'blue heron' }),
    ).resolves.not.toBe(base);
    await expect(
      computeShieldFingerprint(USER, { icon: 'leaf', phrase: 'red heron' }),
    ).resolves.not.toBe(base);
  });
});

describe('verifyShieldAttestation', () => {
  it('verifies a fresh, correctly signed attestation for this origin', async () => {
    const { attestation, fingerprint } = await attestationFor();
    expect(verify(attestation, fingerprint)).toBe('verified');
  });

  it('reports a mismatch when the server holds a different shield', async () => {
    const { attestation } = await attestationFor();
    const local = await computeShieldFingerprint(USER, { icon: 'sun', phrase: 'blue heron' });
    expect(verify(attestation, local)).toBe('mismatch');
  });

  it('rejects attestations not signed by the Heliora signing key', async () => {
    const { fingerprint } = await attestationFor();
    const forged = signAttestation(
      { publicKey: USER, fingerprint, origin: ORIGIN, issuedAt: new Date(NOW).toISOString() },
      Keypair.random(),
    );
    expect(verify(forged, fingerprint)).toBe('invalid-signature');
  });

  it('rejects attestations whose fields were altered after signing', async () => {
    const { attestation, fingerprint } = await attestationFor();
    expect(verify({ ...attestation, origin: 'https://evil.example' }, fingerprint)).toBe(
      'invalid-signature',
    );
  });

  it('rejects attestations issued for another account', async () => {
    const { attestation, fingerprint } = await attestationFor({ publicKey: OTHER_USER });
    expect(verify(attestation, fingerprint)).toBe('invalid-signature');
  });

  it('rejects attestations issued for another origin', async () => {
    const { attestation, fingerprint } = await attestationFor({ origin: 'https://he1iora.io' });
    expect(verify(attestation, fingerprint)).toBe('wrong-origin');
  });

  it('rejects expired and future-dated attestations', async () => {
    const old = await attestationFor({
      issuedAt: new Date(NOW - ATTESTATION_MAX_AGE_MS - 1).toISOString(),
    });
    expect(verify(old.attestation, old.fingerprint)).toBe('stale');

    const future = await attestationFor({ issuedAt: new Date(NOW + 60_000).toISOString() });
    expect(verify(future.attestation, future.fingerprint)).toBe('stale');
  });
});

describe('isShieldCompromised', () => {
  it('flags only statuses that point at phishing or tampering', () => {
    expect(isShieldCompromised('mismatch')).toBe(true);
    expect(isShieldCompromised('invalid-signature')).toBe(true);
    expect(isShieldCompromised('verified')).toBe(false);
    expect(isShieldCompromised('unavailable')).toBe(false);
    expect(isShieldCompromised(null)).toBe(false);
  });
});

describe('checkOfficialDomain', () => {
  const official = ['app.heliora.io'];

  it('accepts an exact official hostname over HTTPS', () => {
    expect(
      checkOfficialDomain({ hostname: 'app.heliora.io', protocol: 'https:' }, official),
    ).toEqual({ status: 'official', hostname: 'app.heliora.io' });
  });

  it('rejects look-alike and suffix domains', () => {
    for (const hostname of ['app.he1iora.io', 'app.heliora.io.evil.com', 'heliora.io']) {
      expect(checkOfficialDomain({ hostname, protocol: 'https:' }, official).status).toBe(
        'unofficial',
      );
    }
  });

  it('flags an official hostname served without HTTPS', () => {
    expect(
      checkOfficialDomain({ hostname: 'app.heliora.io', protocol: 'http:' }, official).status,
    ).toBe('insecure');
  });

  it('treats localhost as development and an empty list as unconfigured', () => {
    expect(checkOfficialDomain({ hostname: 'localhost', protocol: 'http:' }, official).status).toBe(
      'development',
    );
    expect(checkOfficialDomain({ hostname: 'app.heliora.io', protocol: 'https:' }, []).status).toBe(
      'unconfigured',
    );
  });
});

describe('encrypted shield store', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips a shield without storing the phrase in clear text', async () => {
    const store = createShieldStore(createMemoryKeyProvider());
    const shield = { icon: 'leaf' as const, phrase: 'blue heron', createdAt: 'now' };

    await store.save(USER, shield);

    expect(window.localStorage.getItem(`heliora-shield:${USER}`)).not.toContain('blue heron');
    await expect(store.load(USER)).resolves.toEqual(shield);
    await expect(store.load(OTHER_USER)).resolves.toBeNull();
  });

  it('refuses a ciphertext copied into another account slot', async () => {
    const store = createShieldStore(createMemoryKeyProvider());
    await store.save(USER, { icon: 'leaf', phrase: 'blue heron', createdAt: 'now' });
    window.localStorage.setItem(
      `heliora-shield:${OTHER_USER}`,
      window.localStorage.getItem(`heliora-shield:${USER}`)!,
    );

    await expect(store.load(OTHER_USER)).rejects.toThrow(/could not be decrypted/);
  });

  it('refuses a modified ciphertext', async () => {
    const store = createEncryptedLocalStore<{ a: number }>({
      namespace: 'test',
      keyProvider: createMemoryKeyProvider(),
    });
    await store.save(USER, { a: 1 });
    const envelope = JSON.parse(window.localStorage.getItem(`test:${USER}`)!);
    const bytes = Buffer.from(envelope.ct, 'base64');
    bytes[0] = bytes[0]! ^ 0xff;
    envelope.ct = bytes.toString('base64');
    window.localStorage.setItem(`test:${USER}`, JSON.stringify(envelope));

    await expect(store.load(USER)).rejects.toThrow(/could not be decrypted/);
  });

  it('clears the slot', async () => {
    const store = createShieldStore(createMemoryKeyProvider());
    await store.save(USER, { icon: 'leaf', phrase: 'blue heron', createdAt: 'now' });
    store.clear(USER);
    await expect(store.load(USER)).resolves.toBeNull();
  });
});
