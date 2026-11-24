import { WebAuthnManager } from '@/lib/auth/WebAuthnManager';
import { verifyRegistrationAttestation } from '@/lib/auth/attestation';

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function encodeCbor(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    if (value.length < 24) return Uint8Array.of(0x40 | value.length, ...value);
    return Uint8Array.of(0x58, value.length, ...value);
  }
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length < 24) return Uint8Array.of(0x60 | bytes.length, ...bytes);
    return Uint8Array.of(0x78, bytes.length, ...bytes);
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    const head = entries.length < 24 ? [0xa0 | entries.length] : [0xb8, entries.length];
    const parts: number[] = [...head];
    for (const [k, v] of entries) {
      parts.push(...encodeCbor(k));
      parts.push(...encodeCbor(v));
    }
    return Uint8Array.from(parts);
  }
  throw new Error('unsupported cbor type');
}

function makeAttestationObject(aaguid: Uint8Array, fmt = 'packed'): string {
  const authData = new Uint8Array(37 + 55);
  authData[32] = 0x40; // attested credential data flag
  authData.set(aaguid, 37);
  const obj = encodeCbor({ fmt, authData, attStmt: {} });
  return b64(obj);
}

describe('WebAuthnManager / FIDO2 attestation (#250)', () => {
  it('checks WebAuthn availability', () => {
    expect(typeof WebAuthnManager.isAvailable()).toBe('boolean');
  });

  it('verifies direct attestation for hardware AAGUID', async () => {
    const aaguid = Uint8Array.from(Buffer.from('cb69481e8ff7403993ec0a2729a154a8', 'hex'));
    const result = await verifyRegistrationAttestation(makeAttestationObject(aaguid));
    expect(result.verified).toBe(true);
    expect(result.hardwareBacked).toBe(true);
    expect(result.authenticatorName).toContain('YubiKey');
  });

  it('rejects software authenticators', async () => {
    const aaguid = new Uint8Array(16); // all-zero software/synced authenticator
    const result = await verifyRegistrationAttestation(makeAttestationObject(aaguid));
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/Software authenticators/i);
  });

  it('rejects attestation format none', async () => {
    const aaguid = Uint8Array.from(Buffer.from('cb69481e8ff7403993ec0a2729a154a8', 'hex'));
    const result = await verifyRegistrationAttestation(makeAttestationObject(aaguid, 'none'));
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/direct attestation required/i);
  });

  it('registerCredential enforces direct attestation and rejects software key', async () => {
    const aaguid = new Uint8Array(16);
    const attestationObject = makeAttestationObject(aaguid);
    Object.defineProperty(window, 'PublicKeyCredential', { value: function PublicKeyCredential() {}, configurable: true });
    Object.defineProperty(navigator, 'credentials', {
      value: {
        create: jest.fn().mockResolvedValue({
          id: 'cred-id',
          rawId: new Uint8Array([1, 2, 3]).buffer,
          type: 'public-key',
          response: {
            clientDataJSON: new Uint8Array([123]).buffer,
            attestationObject: Buffer.from(attestationObject, 'base64').buffer,
          },
        }),
      },
      configurable: true,
    });

    await expect(
      WebAuthnManager.registerCredential({
        userId: 'u1',
        userName: 'user',
        userDisplayName: 'User',
      }),
    ).rejects.toThrow(/Software authenticators|not accepted|registration failed/i);
  });
});
