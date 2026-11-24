/**
 * @jest-environment node
 *
 * Issue #223 — zero-knowledge clinician subspecialty credential proof.
 */
import fs from 'fs';
import path from 'path';
import {
  CLINICIAN_CREDENTIAL_CIRCUIT,
  buildClinicianCredentialInput,
  checkClinicianCredential,
  generateClinicianCredentialProof,
  licenseIdFromNumber,
  parseClinicianCredential,
  signClinicianCredential,
  specialtyCodeToField,
  verifyClinicianCredentialProof,
  type ClinicianCredential,
} from '@/lib/zkEligibility';
import { BN254_SCALAR_FIELD, ZkInputValidationError } from '@/lib/zkInputValidation';
import type { ClinicianCredentialProofToken } from '@/types';

jest.setTimeout(30000);

const mockProveInWorker = jest.fn();
jest.mock('@/lib/zkWorker', () => ({
  ...jest.requireActual('@/lib/zkWorker'),
  proveInWorker: (...args: unknown[]) => mockProveInWorker(...args),
}));
const mockVerify = jest.fn(async () => true);
jest.mock('snarkjs', () => ({ groth16: { verify: () => mockVerify() } }));

const BOARD_KEY = 'b0'.repeat(32);
const OTHER_BOARD_KEY = 'c1'.repeat(32);
const NOW = new Date('2026-11-24T12:00:00Z');
const PINS = { wasm: 'a', zkey: 'b', 'vkey.json': 'c' };
const LICENSE = 'CA-A123456';
const CARDIOLOGY = '207RC0000X'; // NUCC: Internal Medicine, Cardiovascular Disease

let credential: ClinicianCredential;

beforeAll(async () => {
  credential = await signClinicianCredential(BOARD_KEY, {
    licenseNumber: LICENSE,
    specialtyCode: CARDIOLOGY,
    expiryDate: '2028-06-30',
  });
});

beforeEach(() => {
  mockProveInWorker.mockReset();
  mockVerify.mockClear();
});

const clone = (c: ClinicianCredential): ClinicianCredential => JSON.parse(JSON.stringify(c));

describe('circuits/clinician_credential.circom', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, `../../circuits/${CLINICIAN_CREDENTIAL_CIRCUIT}.circom`),
    'utf8',
  );

  it('exposes only the subspecialty, date and board key as public signals', () => {
    expect(code).toMatch(
      /component main \{public \[specialtyCode, currentDate, issuerAx, issuerAy\]\} = ClinicianCredential\(\);/,
    );
    expect(code).not.toMatch(/signal output/);
    expect(code).not.toMatch(/public \[[^\]]*licenseId/);
  });

  it('verifies the board signature over (licenseId, specialtyCode, expiryDate) in-circuit', () => {
    expect(code).toContain('include "circomlib/circuits/eddsaposeidon.circom";');
    expect(code).toContain('component sig = EdDSAPoseidonVerifier();');
    expect(code).toContain('sig.enabled <== 1;');
    expect(code).toContain('msgHash.inputs[0] <== licenseId;');
    expect(code).toContain('msgHash.inputs[1] <== specialtyCode;');
    expect(code).toContain('msgHash.inputs[2] <== expiryDate;');
    expect(code).toContain('sig.M <== msgHash.out;');
  });

  it('range-checks dates before the expiry comparison', () => {
    expect(code).toContain('expiryBits = Num2Bits(32);');
    expect(code).toContain('currentBits = Num2Bits(32);');
    expect(code).toContain('component notExpired = GreaterEqThan(32);');
    expect(code).toContain('notExpired.out === 1;');
  });
});

describe('clinician credential issuance and checks', () => {
  it('accepts a valid, unexpired board credential', async () => {
    await expect(checkClinicianCredential(credential, NOW)).resolves.toEqual({ valid: true });
    await expect(
      checkClinicianCredential(credential, NOW, {
        specialtyCode: CARDIOLOGY,
        issuerPublicKey: credential.issuerPublicKey,
      }),
    ).resolves.toEqual({ valid: true });
  });

  it('is valid through the expiry date and expired the day after', async () => {
    const lastDay = new Date('2028-06-30T23:59:59Z');
    const dayAfter = new Date('2028-07-01T00:00:00Z');
    await expect(checkClinicianCredential(credential, lastDay)).resolves.toEqual({ valid: true });
    await expect(checkClinicianCredential(credential, dayAfter)).resolves.toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it('rejects an expired license even with a genuine signature', async () => {
    const expired = await signClinicianCredential(BOARD_KEY, {
      licenseNumber: LICENSE,
      specialtyCode: CARDIOLOGY,
      expiryDate: '2025-12-31',
    });
    await expect(checkClinicianCredential(expired, NOW)).resolves.toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it.each<[string, (c: ClinicianCredential) => void]>([
    ['license number', (c) => (c.licenseNumber = 'CA-A123457')],
    ['subspecialty', (c) => (c.specialtyCode = '207RG0300X')],
    ['extended expiry date', (c) => (c.expiryDate = '2030-06-30')],
    ['signature S', (c) => (c.signature.S = (BigInt(c.signature.S) + 1n).toString())],
    ['signature R8', (c) => (c.signature.R8 = [c.signature.R8[1], c.signature.R8[0]])],
  ])('detects a tampered %s', async (_label, tamper) => {
    const tampered = clone(credential);
    tamper(tampered);
    await expect(checkClinicianCredential(tampered, NOW)).resolves.toEqual({
      valid: false,
      reason: 'invalid-signature',
    });
  });

  it('detects a credential re-labelled with another board key', async () => {
    const other = await signClinicianCredential(OTHER_BOARD_KEY, {
      licenseNumber: LICENSE,
      specialtyCode: CARDIOLOGY,
      expiryDate: '2028-06-30',
    });
    const forged = { ...clone(credential), issuerPublicKey: other.issuerPublicKey };
    await expect(checkClinicianCredential(forged, NOW)).resolves.toMatchObject({
      reason: 'invalid-signature',
    });
    await expect(
      checkClinicianCredential(other, NOW, { issuerPublicKey: credential.issuerPublicKey }),
    ).resolves.toEqual({ valid: false, reason: 'wrong-issuer' });
  });

  it('rejects a credential for a different subspecialty than requested', async () => {
    await expect(
      checkClinicianCredential(credential, NOW, { specialtyCode: '207RG0300X' }),
    ).resolves.toEqual({ valid: false, reason: 'wrong-specialty' });
  });

  it('round-trips through parseClinicianCredential and rejects malformed files', () => {
    expect(parseClinicianCredential(JSON.stringify(credential))).toEqual(credential);
    const bad = clone(credential);
    bad.signature.S = (BigInt(bad.signature.S) + BN254_SCALAR_FIELD).toString();
    expect(() => parseClinicianCredential(JSON.stringify(bad))).toThrow(/Unrecognised/);
    expect(() =>
      parseClinicianCredential(JSON.stringify({ ...credential, expiryDate: '30/06/2028' })),
    ).toThrow(/Unrecognised/);
  });
});

describe('witness input', () => {
  it('keeps the license number out of the witness in plain text', async () => {
    const input = await buildClinicianCredentialInput(credential, NOW);
    expect(JSON.stringify(input)).not.toContain(LICENSE);
    expect(input).toEqual({
      specialtyCode: specialtyCodeToField(CARDIOLOGY).toString(),
      currentDate: '20261124',
      issuerAx: credential.issuerPublicKey[0],
      issuerAy: credential.issuerPublicKey[1],
      licenseId: (await licenseIdFromNumber(LICENSE)).toString(),
      expiryDate: '20280630',
      sigR8x: credential.signature.R8[0],
      sigR8y: credential.signature.R8[1],
      sigS: credential.signature.S,
    });
  });

  it('refuses out-of-field signature values', async () => {
    const bad = clone(credential);
    bad.signature.R8[0] = BN254_SCALAR_FIELD.toString();
    await expect(buildClinicianCredentialInput(bad, NOW)).rejects.toBeInstanceOf(
      ZkInputValidationError,
    );
  });
});

describe('proof generation and verification', () => {
  const publicSignals = () => [
    specialtyCodeToField(CARDIOLOGY).toString(),
    '20261124',
    credential.issuerPublicKey[0],
    credential.issuerPublicKey[1],
  ];

  it('proves a valid credential with the clinician_credential circuit', async () => {
    mockProveInWorker.mockResolvedValue({ proof: { pi_a: [] }, publicSignals: publicSignals() });
    const token = await generateClinicianCredentialProof(credential, NOW, '/zk', {
      expectedSha256: PINS,
    });
    expect(token).toEqual({
      kind: 'clinicianCredential',
      proof: { pi_a: [] },
      publicSignals: publicSignals(),
    });
    const job = mockProveInWorker.mock.calls[0][0];
    expect(job.circuit).toBe('clinician_credential');
    expect(job.wasmUrl).toBe('/zk/clinician_credential.wasm');
    expect(job.expectedSha256).toEqual(PINS);
  });

  it.each([
    ['expired', { expiryDate: '2025-01-01' }, /expired/],
    ['tampered', { licenseNumber: 'CA-ZZZ' }, /not signed by the certifying board/],
  ])('refuses to prove an %s credential', async (_label, patch, message) => {
    await expect(
      generateClinicianCredentialProof({ ...clone(credential), ...patch }, NOW, '/zk', {
        expectedSha256: PINS,
      }),
    ).rejects.toThrow(message);
    expect(mockProveInWorker).not.toHaveBeenCalled();
  });

  it('maps circuit assertion failures to a user-facing error', async () => {
    mockProveInWorker.mockRejectedValue(new Error('Error: Assert Failed. line: 42'));
    await expect(
      generateClinicianCredentialProof(credential, NOW, '/zk', { expectedSha256: PINS }),
    ).rejects.toThrow('This credential does not prove a current board certification.');
  });

  const token = (): ClinicianCredentialProofToken => ({
    kind: 'clinicianCredential',
    proof: {},
    publicSignals: publicSignals(),
  });
  const expected = () => ({
    specialtyCode: CARDIOLOGY,
    issuerPublicKey: credential.issuerPublicKey,
  });

  it('verifies a proof for the expected subspecialty and board', async () => {
    await expect(verifyClinicianCredentialProof(token(), expected(), NOW, {})).resolves.toBe(true);
    expect(mockVerify).toHaveBeenCalledTimes(1);
  });

  it('rejects a proof for another subspecialty, board, stale date or aliased signal', async () => {
    await expect(
      verifyClinicianCredentialProof(
        token(),
        { ...expected(), specialtyCode: '207RG0300X' },
        NOW,
        {},
      ),
    ).resolves.toBe(false);
    await expect(
      verifyClinicianCredentialProof(
        token(),
        { ...expected(), issuerPublicKey: ['1', '2'] },
        NOW,
        {},
      ),
    ).resolves.toBe(false);
    await expect(
      verifyClinicianCredentialProof(token(), expected(), new Date('2026-11-25T00:00:00Z'), {}),
    ).resolves.toBe(false);
    const aliased = token();
    aliased.publicSignals[1] = (20261124n + BN254_SCALAR_FIELD).toString();
    await expect(verifyClinicianCredentialProof(aliased, expected(), NOW, {})).resolves.toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
  });
});
