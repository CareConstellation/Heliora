/**
 * @jest-environment node
 */
import {
  artifactPins,
  encodeGroth16Proof,
  generateDeductibleProof,
  generateEligibilityProof,
  meetsDeductible,
  parseDeductibleCredential,
  verifyArtifactIntegrity,
  verifyDeductibleProof,
} from '@/lib/zkEligibility';
import { sha256Hex } from '@/lib/zkWorker';

const mockFullProve = jest.fn(async () => ({
  proof: { pi_a: ['1', '2', '1'], pi_b: [['1', '2'], ['3', '4']], pi_c: ['5', '6', '1'] },
  publicSignals: ['100', '42'],
}));
const mockVerify = jest.fn(async () => true);

jest.mock('snarkjs', () => ({
  groth16: {
    fullProve: () => mockFullProve(),
    verify: () => mockVerify(),
  },
}));

const encoder = new TextEncoder();
const artifactBytes = (url: string) => encoder.encode(`artifact:${url}`);

beforeEach(() => {
  mockFullProve.mockClear();
  mockVerify.mockClear();
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const bytes = artifactBytes(String(input));
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
      json: async () => ({}),
    } as Response;
  }) as unknown as typeof fetch;
});

describe('artifact integrity (#210)', () => {
  it('accepts a matching digest and rejects a mismatch', async () => {
    const bytes = encoder.encode('wasm-bytes');
    const digest = await sha256Hex(bytes);

    await expect(verifyArtifactIntegrity(bytes, digest, 'wasm')).resolves.toBeUndefined();
    await expect(verifyArtifactIntegrity(bytes, 'a'.repeat(64), 'wasm')).rejects.toThrow(
      /SHA-256 mismatch/,
    );
    await expect(verifyArtifactIntegrity(bytes, '', 'wasm')).rejects.toThrow(/Refusing to prove/);
  });

  it('refuses to prove for a circuit without pinned digests', () => {
    expect(() => artifactPins('age_eligibility')).toThrow(/No verified artifacts/);
  });

  it('downloads nothing if the pinned digest for the wasm is wrong', async () => {
    const wasmUrl = '/zk/age_eligibility.wasm';
    const zkeyUrl = '/zk/age_eligibility.zkey';
    const vkeyUrl = '/zk/age_eligibility.vkey.json';

    await expect(
      generateEligibilityProof(
        { type: 'age', birthDate: '1990-05-17', salt: '12', commitment: '34' },
        new Date('2026-11-23T00:00:00Z'),
        '/zk',
        {
          expectedSha256: {
            wasm: 'b'.repeat(64),
            zkey: await sha256Hex(artifactBytes(zkeyUrl)),
            'vkey.json': await sha256Hex(artifactBytes(vkeyUrl)),
          },
        },
      ),
    ).rejects.toThrow(/digest mismatch/);
    expect(mockFullProve).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(wasmUrl);
  });

  it('proves when every pinned digest matches', async () => {
    const wasmUrl = '/zk/age_eligibility.wasm';
    const zkeyUrl = '/zk/age_eligibility.zkey';
    const vkeyUrl = '/zk/age_eligibility.vkey.json';

    const token = await generateEligibilityProof(
      { type: 'age', birthDate: '1990-05-17', salt: '12', commitment: '34' },
      new Date('2026-11-23T00:00:00Z'),
      '/zk',
      {
        expectedSha256: {
          wasm: await sha256Hex(artifactBytes(wasmUrl)),
          zkey: await sha256Hex(artifactBytes(zkeyUrl)),
          'vkey.json': await sha256Hex(artifactBytes(vkeyUrl)),
        },
      },
    );

    expect(token.kind).toBe('age18');
    expect(mockFullProve).toHaveBeenCalledTimes(1);
  });
});

describe('on-chain proof encoding (#208)', () => {
  it('packs G1 points big-endian and swaps Fp2 into imaginary-first order', () => {
    const encoded = encodeGroth16Proof({
      pi_a: ['1', '2', '1'],
      pi_b: [
        ['1', '2'],
        ['3', '4'],
      ],
      pi_c: ['5', '6', '1'],
    });

    expect(encoded.a).toHaveLength(64);
    expect(encoded.b).toHaveLength(128);
    expect(encoded.c).toHaveLength(64);

    const lastByte = (bytes: Uint8Array, word: number) => bytes[word * 32 + 31];
    expect(lastByte(encoded.a, 0)).toBe(1);
    expect(lastByte(encoded.a, 1)).toBe(2);
    // G2: c1 || c0 for both coordinates.
    expect([0, 1, 2, 3].map((word) => lastByte(encoded.b, word))).toEqual([2, 1, 4, 3]);
    expect(lastByte(encoded.c, 1)).toBe(6);
  });

  it('rejects malformed proofs', () => {
    expect(() => encodeGroth16Proof({})).toThrow(/Malformed Groth16 proof/);
  });
});

describe('deductible credential (#209)', () => {
  const credential = {
    type: 'deductible' as const,
    policyNumber: 'HMO-4471-0093-XY',
    spend: 50_000,
    deductible: 25_000,
    salt: '12',
    commitment: '34',
  };

  it('parses a well-formed deductible credential', () => {
    expect(parseDeductibleCredential(JSON.stringify(credential))).toEqual(credential);
  });

  it.each<[string, Record<string, unknown>]>([
    ['a negative spend', { spend: -1 }],
    ['a fractional spend', { spend: 1.5 }],
    ['a spend above 2^32', { spend: 2 ** 32 }],
    ['a missing commitment', { commitment: '' }],
    ['the wrong type', { type: 'insurance' }],
  ])('rejects %s', (_label, patch) => {
    expect(() =>
      parseDeductibleCredential(JSON.stringify({ ...credential, ...patch })),
    ).toThrow();
  });

  it('handles the threshold edges: equal, above, below', () => {
    expect(meetsDeductible(25_000, 25_000)).toBe(true);
    expect(meetsDeductible(25_001, 25_000)).toBe(true);
    expect(meetsDeductible(24_999, 25_000)).toBe(false);
  });

  it('refuses to prove when the deductible has not been met', async () => {
    await expect(
      generateDeductibleProof({ ...credential, spend: 24_999 }, '/zk', {
        expectedSha256: { wasm: 'x', zkey: 'x', 'vkey.json': 'x' },
      }),
    ).rejects.toThrow(/deductible has been met/);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockFullProve).not.toHaveBeenCalled();
  });

  it('binds the proof to the expected deductible and commitment', async () => {
    const token = {
      kind: 'deductible' as const,
      proof: {},
      publicSignals: ['25000', '34'],
    };

    await expect(verifyDeductibleProof(token, '34', 25_000, {})).resolves.toBe(true);
    await expect(verifyDeductibleProof(token, '35', 25_000, {})).resolves.toBe(false);
    await expect(verifyDeductibleProof(token, '34', 24_000, {})).resolves.toBe(false);
    await expect(verifyDeductibleProof(token, '34', 26_000, {})).resolves.toBe(false);
    await expect(
      verifyDeductibleProof({ ...token, publicSignals: ['25000'] }, '34', 25_000, {}),
    ).resolves.toBe(false);
  });
});
