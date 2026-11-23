jest.mock('@/lib/stellar', () => ({
  invokeSorobanContract: jest.fn(),
}));
jest.mock('@/lib/sorobanRbac', () => ({
  invalidateRoleCache: jest.fn(),
}));

import { Keypair, StrKey } from '@stellar/stellar-sdk';

const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));
const ADMIN = Keypair.random().publicKey();
const APPLICANT = Keypair.random().publicKey();

describe('roleVerification', () => {
  let mod: typeof import('@/lib/roleVerification');
  let stellarMock: { invokeSorobanContract: jest.Mock };
  let rbacMock: { invalidateRoleCache: jest.Mock };

  beforeAll(() => {
    process.env.NEXT_PUBLIC_ACCESS_CONTROL_CONTRACT_ID = CONTRACT;
    // The module reads the contract id at import time, so load it (and the mocks it
    // sees) from one isolated registry.
    jest.isolateModules(() => {
      mod = require('@/lib/roleVerification');
      stellarMock = require('@/lib/stellar');
      rbacMock = require('@/lib/sorobanRbac');
    });
  });

  it('defines unique standardized rejection reasons with applicant messages', () => {
    const codes = mod.REJECTION_REASONS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('OTHER');
    mod.REJECTION_REASONS.forEach((r) => expect(r.applicantMessage.length).toBeGreaterThan(10));
  });

  it('requires a reason, and a note for OTHER', () => {
    expect(mod.validateRejection('')).toMatch(/choose a rejection reason/i);
    expect(mod.validateRejection(null)).toMatch(/choose/i);
    expect(mod.validateRejection('NOPE' as never)).toMatch(/unknown/i);
    expect(mod.validateRejection('LICENSE_EXPIRED')).toBeNull();
    expect(mod.validateRejection('OTHER', 'short')).toMatch(/at least/i);
    expect(mod.validateRejection('OTHER', 'Credential issued by an unaccredited body')).toBeNull();
    expect(mod.validateRejection('LICENSE_EXPIRED', 'x'.repeat(501))).toMatch(/limited/i);
  });

  it('builds rejection payloads with trimmed optional notes', () => {
    expect(mod.buildRejectionPayload(ADMIN, 'NAME_MISMATCH', '  ')).toEqual({
      decision: 'rejected',
      reasonCode: 'NAME_MISMATCH',
      reviewerAddress: ADMIN,
    });
    expect(mod.buildRejectionPayload(ADMIN, 'OTHER', ' details ')).toMatchObject({
      note: 'details',
    });
  });

  it('computes license expiry in days', () => {
    const now = new Date('2026-01-10T00:00:00Z');
    expect(mod.daysUntilLicenseExpiry({ licenseExpiresAt: '2026-01-20T00:00:00Z' }, now)).toBe(10);
    expect(mod.daysUntilLicenseExpiry({ licenseExpiresAt: '2026-01-05T00:00:00Z' }, now)).toBe(-5);
    expect(mod.daysUntilLicenseExpiry({}, now)).toBeNull();
    expect(mod.daysUntilLicenseExpiry({ licenseExpiresAt: 'garbage' }, now)).toBeNull();
  });

  it('accepts only real PDFs by magic bytes', async () => {
    await expect(
      mod.isPdfBlob(new Blob(['%PDF-1.7 ...'], { type: 'application/pdf' })),
    ).resolves.toBe(true);
    await expect(mod.isPdfBlob(new Blob(['<html>'], { type: 'application/pdf' }))).resolves.toBe(
      false,
    );
    await expect(mod.isPdfBlob(new Blob(['%P']))).resolves.toBe(false);
  });

  it('signs an on-chain grant_role and invalidates the applicant role cache', async () => {
    const { invokeSorobanContract } = stellarMock;
    const { invalidateRoleCache } = rbacMock;
    invokeSorobanContract.mockResolvedValue('txhash');
    const signer = jest.fn();

    await expect(mod.grantRoleOnChain(ADMIN, APPLICANT, 'DOCTOR', signer)).resolves.toBe('txhash');

    const [source, operation, passedSigner, spanName] = invokeSorobanContract.mock.calls[0];
    expect(source).toBe(ADMIN);
    expect(passedSigner).toBe(signer);
    expect(spanName).toBe('soroban.grant_role');
    const invoke = operation.body().invokeHostFunctionOp().hostFunction().invokeContract();
    expect(invoke.functionName().toString()).toBe('grant_role');
    expect(invoke.args()).toHaveLength(3);
    expect(invalidateRoleCache).toHaveBeenCalledWith(APPLICANT);
  });
});

describe('roleVerification without contract id', () => {
  it('refuses to build a grant without a configured contract', () => {
    delete process.env.NEXT_PUBLIC_ACCESS_CONTROL_CONTRACT_ID;
    jest.isolateModules(() => {
      const mod = require('@/lib/roleVerification');
      expect(() => mod.buildGrantRoleOperation('G', 'G', 'DOCTOR')).toThrow(/not configured/);
    });
  });
});
