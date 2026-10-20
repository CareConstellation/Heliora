/**
 * @jest-environment node
 */
import { Account, StrKey, rpc, xdr } from '@stellar/stellar-sdk';

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return { ...actual, rpc: { ...actual.rpc, Server: jest.fn() } };
});

process.env.NEXT_PUBLIC_RECORD_REGISTRY_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
process.env.NEXT_PUBLIC_IPFS_GATEWAYS = 'https://gw-a.example, https://gw-b.example/';

// Loaded after the env vars above, because IPFS_CONFIG reads them at import time.
const {
  cidToString,
  computeCid,
  fetchVerifiedCiphertext,
  IPFS_CONFIG,
  probeGateways,
  readOnChainCid,
} = require('@/lib/ipfs') as typeof import('@/lib/ipfs');

jest.mock('@/hooks/useToast', () => ({ useToast: jest.fn() }));

const MiB = 1024 * 1024;

/** Same deterministic content used to compute the reference CIDs with ipfs-unixfs-importer 17.1.1. */
function sample(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 4096) bytes[i] = ((i / 4096) * 7 + 3) & 255;
  return bytes;
}

describe('computeCid: IPIP-0499 unixfs-v1-2025 (#28)', () => {
  // Expected values come from the reference JS importer (cidVersion 1, rawLeaves, 1 MiB chunks, balanced, 1024 links).
  it.each([
    [1, 'bafkreiaij7wqrolyv5gx2glkordkq22yacpgg23bdwyweenwlknk37zjyu'],
    [1000, 'bafkreih4gkiupefhskszkjigi4q46gjazuo4svnm643nkkmxdo4b2pyj6m'],
    [MiB - 1, 'bafkreidexbioouz3sm4boewmmypegxr4xs7kzbrvxu735t65vudkbahj6a'],
    [MiB, 'bafkreihdyixrzwige2m6wnoiat3unc7ys6mh5whya5y76pyrgr774a7tfu'],
    [MiB + 1, 'bafybeig4aqfv4wnr22upqb2lqlphaoyyjqpiqcpstsitimh674tsvh37v4'],
    [3 * MiB + 17, 'bafybeifw4whjbc6euc37hjyoeatuwzofxvr34ewdnsp4nlpgoentv5zgyy'],
  ])('matches the reference implementation for %i bytes', async (size, expected) => {
    const { cid, bytes } = await computeCid(sample(size));
    expect(cid).toBe(expected);
    expect(cidToString(bytes)).toBe(expected);
  });

  it('encodes a single-chunk file as a raw CIDv1 wrapping its SHA-256 digest', async () => {
    const data = sample(1000);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    const { bytes } = await computeCid(data);
    expect([...bytes.subarray(0, 4)]).toEqual([0x01, 0x55, 0x12, 0x20]); // CIDv1, raw, sha2-256, 32 bytes
    expect(bytes.subarray(4)).toEqual(digest);
  });

  it('uses dag-pb for multi-chunk files', async () => {
    const { bytes } = await computeCid(sample(MiB + 1));
    expect([...bytes.subarray(0, 4)]).toEqual([0x01, 0x70, 0x12, 0x20]);
  });
});

describe('gateways', () => {
  const ciphertext = sample(5000);
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('parses the configured gateway list', () => {
    expect(IPFS_CONFIG.gateways).toEqual(['https://gw-a.example', 'https://gw-b.example']);
  });

  it('returns ciphertext only when it reproduces the on-chain CID, skipping a tampered gateway', async () => {
    const { bytes, cid } = await computeCid(ciphertext);
    const tampered = ciphertext.slice();
    tampered[0] = tampered[0]! ^ 1;
    fetchMock
      .mockResolvedValueOnce(new Response(tampered))
      .mockResolvedValueOnce(new Response(ciphertext));

    const body = await fetchVerifiedCiphertext(bytes);

    expect(new Uint8Array(body)).toEqual(ciphertext);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://gw-a.example/ipfs/${cid}`,
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://gw-b.example/ipfs/${cid}`,
      expect.anything(),
    );
  });

  it('refuses to return content when no gateway serves matching bytes', async () => {
    const { bytes } = await computeCid(ciphertext);
    fetchMock
      .mockResolvedValueOnce(new Response('evil'))
      .mockResolvedValueOnce(new Response(null, { status: 504 }));

    await expect(fetchVerifiedCiphertext(bytes)).rejects.toThrow('matching the on-chain CID');
  });

  it('measures time-to-headers and HTTP status per gateway, and reports network failures as null', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockRejectedValueOnce(new Error('timeout'));

    const results = await probeGateways('bafkreiexample');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gw-a.example/ipfs/bafkreiexample',
      expect.objectContaining({ method: 'HEAD' }),
    );
    expect(results[0]).toEqual({
      gateway: 'https://gw-a.example',
      latencyMs: expect.any(Number),
      status: 429,
    });
    expect(results[1]).toEqual({ gateway: 'https://gw-b.example', latencyMs: null, status: null });
  });
});

describe('readOnChainCid', () => {
  const SOURCE = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';

  function mockServer(retval: xdr.ScVal) {
    // A parsed success response: isSimulationSuccess() keys off `transactionData`.
    const simulateTransaction = jest
      .fn()
      .mockResolvedValue({ result: { auth: [], retval }, _parsed: true, transactionData: {} });
    (rpc.Server as unknown as jest.Mock).mockImplementation(() => ({
      getAccount: jest.fn().mockResolvedValue(new Account(SOURCE, '1')),
      simulateTransaction,
    }));
    return simulateTransaction;
  }

  it('simulates get_record_cid(record_id) without signing and returns the CID bytes', async () => {
    const { bytes } = await computeCid(sample(10));
    const simulate = mockServer(xdr.ScVal.scvBytes(Buffer.from(bytes)));

    await expect(readOnChainCid('rec-1', SOURCE)).resolves.toEqual(bytes);

    const op = simulate.mock.calls[0][0].operations[0];
    expect(op.func.invokeContract().functionName().toString()).toBe('get_record_cid');
    expect(op.func.invokeContract().args()[0].str().toString()).toBe('rec-1');
  });

  it('rejects records without an on-chain pointer', async () => {
    mockServer(xdr.ScVal.scvVoid());
    await expect(readOnChainCid('rec-2', SOURCE)).rejects.toThrow('no on-chain CID pointer');
  });
});
