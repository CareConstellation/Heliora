/**
 * @jest-environment node
 */
import {
  provePlonk,
  verifyPlonkProof,
  verifyEligibilityProof,
  ZkMemoryError,
} from '@/lib/zkEligibility';
import type { EligibilityProofToken } from '@/types';

// Mock snarkjs
jest.mock('snarkjs', () => ({
  plonk: {
    fullProve: jest.fn(),
    verify: jest.fn(),
  },
  groth16: {
    fullProve: jest.fn(),
    verify: jest.fn(),
  },
}));

describe('PLONK Proof Support Alongside Groth16 (#219)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('provePlonk', () => {
    it('executes snarkjs.plonk.fullProve with sanitized inputs', async () => {
      const snarkjs = await import('snarkjs');
      const mockedFullProve = snarkjs.plonk.fullProve as jest.MockedFunction<
        typeof snarkjs.plonk.fullProve
      >;
      mockedFullProve.mockResolvedValueOnce({
        proof: { pi_a: ['1', '2'], protocol: 'plonk' },
        publicSignals: ['18', '123456'],
      });

      const wasm = new Uint8Array([0, 97, 115, 109]);
      const zkey = new Uint8Array([1, 2, 3]);
      const input = { birthDate: '20000101', salt: '123' };

      const result = await provePlonk(wasm, zkey, input);
      expect(mockedFullProve).toHaveBeenCalledTimes(1);
      expect(result.publicSignals).toEqual(['18', '123456']);
      expect((result.proof as any).protocol).toBe('plonk');
    });

    it('catches WASM out-of-memory errors and throws ZkMemoryError', async () => {
      const snarkjs = await import('snarkjs');
      const mockedFullProve = snarkjs.plonk.fullProve as jest.MockedFunction<
        typeof snarkjs.plonk.fullProve
      >;
      mockedFullProve.mockRejectedValueOnce(
        new RangeError('WebAssembly.Memory(): could not allocate memory'),
      );

      const wasm = new Uint8Array([0, 97, 115, 109]);
      const zkey = new Uint8Array([1, 2, 3]);

      await expect(provePlonk(wasm, zkey, { a: '1' })).rejects.toThrow(ZkMemoryError);
    });
  });

  describe('verifyPlonkProof', () => {
    it('verifies valid PLONK proof via snarkjs.plonk.verify', async () => {
      const snarkjs = await import('snarkjs');
      const mockedVerify = snarkjs.plonk.verify as jest.MockedFunction<
        typeof snarkjs.plonk.verify
      >;
      mockedVerify.mockResolvedValueOnce(true);

      const vkey = { protocol: 'plonk', nPublic: 1 };
      const publicSignals = ['100'];
      const proof = { protocol: 'plonk' };

      const valid = await verifyPlonkProof(vkey, publicSignals, proof);
      expect(valid).toBe(true);
      expect(mockedVerify).toHaveBeenCalledWith(vkey, publicSignals, proof);
    });

    it('rejects non-canonical public signals before calling verifier', async () => {
      const snarkjs = await import('snarkjs');
      const mockedVerify = snarkjs.plonk.verify as jest.MockedFunction<
        typeof snarkjs.plonk.verify
      >;

      const vkey = { protocol: 'plonk' };
      const invalidSignals = ['-10']; // negative is non-canonical
      const proof = {};

      const valid = await verifyPlonkProof(vkey, invalidSignals, proof);
      expect(valid).toBe(false);
      expect(mockedVerify).not.toHaveBeenCalled();
    });
  });

  describe('verifyEligibilityProof with PLONK', () => {
    it('dispatches to snarkjs.plonk.verify when token protocol is plonk', async () => {
      const snarkjs = await import('snarkjs');
      const mockedPlonkVerify = snarkjs.plonk.verify as jest.MockedFunction<
        typeof snarkjs.plonk.verify
      >;
      const mockedGroth16Verify = snarkjs.groth16.verify as jest.MockedFunction<
        typeof snarkjs.groth16.verify
      >;
      mockedPlonkVerify.mockResolvedValueOnce(true);

      const token: EligibilityProofToken = {
        kind: 'age18',
        proof: { protocol: 'plonk' },
        publicSignals: ['20000101', '12345'],
        protocol: 'plonk',
      };

      const vkey = { protocol: 'plonk' };
      const valid = await verifyEligibilityProof(
        token,
        '12345',
        new Date('2026-01-01'),
        vkey,
        { provingSystem: 'plonk' },
      );

      expect(valid).toBe(true);
      expect(mockedPlonkVerify).toHaveBeenCalledWith(vkey, token.publicSignals, token.proof);
      expect(mockedGroth16Verify).not.toHaveBeenCalled();
    });
  });
});
