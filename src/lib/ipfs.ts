/**
 * Content addressing for record ciphertexts stored on IPFS.
 *
 * CIDs are computed locally with the IPIP-0499 `unixfs-v1-2025` profile:
 * CIDv1, SHA2-256, fixed 1 MiB chunks, raw leaves, balanced DAG, at most 1024
 * links per node, links-first dag-pb encoding.
 * https://specs.ipfs.tech/ipips/ipip-0499/
 *
 * The same CID is checked three times:
 * 1. before upload (the local CID is the expected value),
 * 2. after upload (the pinning service must return the same CID),
 * 3. after download, against the record's on-chain Soroban pointer, before decryption.
 */

import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import { STELLAR_CONFIG } from '@/lib/stellar';

const CHUNK_BYTES = 1024 * 1024;
const MAX_LINKS = 1024;
const CODEC_RAW = 0x55;
const CODEC_DAG_PB = 0x70;
const MULTIHASH_SHA2_256 = 0x12;
const SHA2_256_BYTES = 32;
const UNIXFS_TYPE_FILE = 2;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

export const IPFS_CONFIG = {
  /** Public gateways tried in order for retrieval and latency probing. */
  gateways: (process.env.NEXT_PUBLIC_IPFS_GATEWAYS || 'https://ipfs.io,https://dweb.link')
    .split(',')
    .map((g) => g.trim().replace(/\/+$/, ''))
    .filter(Boolean),
  /** Soroban contract holding each record's CID pointer. */
  recordRegistryContractId: process.env.NEXT_PUBLIC_RECORD_REGISTRY_CONTRACT_ID ?? '',
};

export interface ContentId {
  /** Multibase base32 string form (`bafy…` / `bafk…`). */
  cid: string;
  /** Binary CIDv1, as stored on-chain. */
  bytes: Uint8Array;
}

/* ── Encoding primitives ─────────────────────────────────────────── */

function varint(value: number): number[] {
  const out: number[] = [];
  while (value >= 0x80) {
    out.push((value % 0x80) | 0x80);
    value = Math.floor(value / 0x80);
  }
  out.push(value);
  return out;
}

function concat(parts: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Protobuf length-delimited field: tag ‖ varint(length) ‖ bytes. */
const lengthDelimited = (tag: number, bytes: Uint8Array) =>
  concat([[tag], varint(bytes.length), bytes]);

/** Binary CID → string: RFC 4648 base32, lowercase, unpadded, with the multibase `b` prefix. */
export function cidToString(bytes: Uint8Array): string {
  let out = 'b';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

async function cidV1(
  codec: number,
  block: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', block));
  return concat([[0x01], varint(codec), [MULTIHASH_SHA2_256, SHA2_256_BYTES], digest]);
}

interface DagNode {
  cid: Uint8Array;
  /** Cumulative DAG size (dag-pb `Tsize`): this block plus all descendants. */
  dagSize: number;
  /** Plaintext bytes represented (UnixFS `blocksizes` entry). */
  fileSize: number;
}

/**
 * Encodes one UnixFS file node: dag-pb links first (`Hash`, empty `Name`, `Tsize`),
 * then `Data` = UnixFS { Type: File, filesize, blocksizes[] }.
 */
async function fileNode(children: DagNode[]): Promise<DagNode> {
  const fileSize = children.reduce((n, c) => n + c.fileSize, 0);
  const unixfs = concat([
    [0x08, UNIXFS_TYPE_FILE],
    [0x18, ...varint(fileSize)],
    ...children.map((c) => [0x20, ...varint(c.fileSize)]),
  ]);
  const links = children.map((c) =>
    lengthDelimited(
      0x12,
      concat([lengthDelimited(0x0a, c.cid), [0x12, 0x00], [0x18, ...varint(c.dagSize)]]),
    ),
  );
  const block = concat([...links, lengthDelimited(0x0a, unixfs)]);
  return {
    cid: await cidV1(CODEC_DAG_PB, block),
    dagSize: block.length + children.reduce((n, c) => n + c.dagSize, 0),
    fileSize,
  };
}

/**
 * Computes the `unixfs-v1-2025` CIDv1 of a byte array. A file of one chunk
 * (≤ 1 MiB) is a single raw block whose CID wraps its SHA-256 digest directly.
 *
 * Time O(n) (one SHA-256 pass over the data plus O(n / 1 MiB) small nodes);
 * space O(n / 1 MiB) for the leaf descriptors, since chunks are subarray views.
 */
export async function computeCid(data: Uint8Array<ArrayBuffer>): Promise<ContentId> {
  let level: DagNode[] = [];
  for (let offset = 0; offset < data.length || level.length === 0; offset += CHUNK_BYTES) {
    const chunk = data.subarray(offset, offset + CHUNK_BYTES);
    level.push({
      cid: await cidV1(CODEC_RAW, chunk),
      dagSize: chunk.length,
      fileSize: chunk.length,
    });
  }
  while (level.length > 1) {
    const next: DagNode[] = [];
    for (let i = 0; i < level.length; i += MAX_LINKS)
      next.push(await fileNode(level.slice(i, i + MAX_LINKS)));
    level = next;
  }
  const { cid } = level[0]!;
  return { cid: cidToString(cid), bytes: cid };
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/* ── Gateways ─────────────────────────────────────────────────────── */

export interface GatewayLatency {
  gateway: string;
  /** Time to response headers in ms, or null when no response arrived (network error or timeout). */
  latencyMs: number | null;
  /** HTTP status of the response, or null when no response arrived (e.g. 429 when rate-limited). */
  status: number | null;
}

/** Measures time-to-headers for `HEAD /ipfs/<cid>` on every configured gateway, in parallel. */
export function probeGateways(
  cid: string,
  gateways = IPFS_CONFIG.gateways,
): Promise<GatewayLatency[]> {
  return Promise.all(
    gateways.map(async (gateway) => {
      const started = performance.now();
      try {
        const res = await fetch(`${gateway}/ipfs/${cid}`, {
          method: 'HEAD',
          signal: AbortSignal.timeout(10_000),
        });
        return { gateway, latencyMs: Math.round(performance.now() - started), status: res.status };
      } catch {
        return { gateway, latencyMs: null, status: null };
      }
    }),
  );
}

/**
 * Downloads a ciphertext from the first gateway that serves it and returns it
 * only if its recomputed CID equals `expected` (the on-chain pointer).
 * A gateway serving altered bytes is skipped, not trusted.
 */
export async function fetchVerifiedCiphertext(
  expected: Uint8Array,
  gateways = IPFS_CONFIG.gateways,
): Promise<ArrayBuffer> {
  const cid = cidToString(expected);
  for (const gateway of gateways) {
    try {
      const res = await fetch(`${gateway}/ipfs/${cid}`, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) continue;
      const body = await res.arrayBuffer();
      if (sameBytes((await computeCid(new Uint8Array(body))).bytes, expected)) return body;
    } catch {
      // try the next gateway
    }
  }
  throw new Error('No gateway returned content matching the on-chain CID.');
}

/* ── On-chain pointer ─────────────────────────────────────────────── */

/**
 * Reads the record's CID pointer from the registry contract with a read-only
 * simulation of `get_record_cid(record_id: String) -> Option<Bytes>`. Nothing is
 * signed or submitted. `source` must be an existing account (the connected wallet).
 */
export async function readOnChainCid(recordId: string, source: string): Promise<Uint8Array> {
  if (!STELLAR_CONFIG.sorobanRpcUrl || !IPFS_CONFIG.recordRegistryContractId) {
    throw new Error('Record registry contract is not configured.');
  }
  const server = new rpc.Server(STELLAR_CONFIG.sorobanRpcUrl);
  const tx = new TransactionBuilder(await server.getAccount(source), {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_CONFIG.passphrase,
  })
    .addOperation(
      new Contract(IPFS_CONFIG.recordRegistryContractId).call(
        'get_record_cid',
        nativeToScVal(recordId, { type: 'string' }),
      ),
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result)
    throw new Error('Could not read the on-chain CID pointer.');
  const value: unknown = scValToNative(sim.result.retval);
  if (!(value instanceof Uint8Array)) throw new Error('This record has no on-chain CID pointer.');
  return new Uint8Array(value);
}
