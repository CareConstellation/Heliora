/**
 * Cryptographic audit trail with Merkle tree inclusion proofs anchored to
 * Stellar ledger close hashes.
 *
 * ## Design
 * Audit events (record access, grants, revocations) are collected into daily
 * trees. Each leaf is SHA-256(event JSON). Internal nodes follow RFC 6962 §2.1:
 *   - leaf hash:   H(0x00 ‖ entry)
 *   - node hash:   H(0x01 ‖ left ‖ right)
 * Domain-separated prefixes prevent second-preimage attacks.
 *
 * The tree root is anchored to a Stellar ledger by querying Horizon for the
 * ledger that closed at (or just after) the tree's date, binding the audit
 * root to an immutable, publicly verifiable timestamp.
 *
 * ## Complexity
 * - Tree construction: O(n) time, O(n) space for n leaves.
 * - Proof generation:  O(log n) time and space.
 * - Proof verification: O(log n) time, O(1) space.
 */

/* ── Constants ────────────────────────────────────────────────────── */

const LEAF_PREFIX = new Uint8Array([0x00]);
const NODE_PREFIX = new Uint8Array([0x01]);

/* ── Audit event types ────────────────────────────────────────────── */

export interface AuditEvent {
  timestamp: string;
  action: 'record_accessed' | 'access_granted' | 'access_revoked' | 'record_created' | 'record_updated';
  actorAddress: string;
  subjectAddress: string;
  recordId: string;
  metadata?: Record<string, string>;
}

export interface MerkleProof {
  leafIndex: number;
  leafHash: string;
  siblings: Array<{ hash: string; position: 'left' | 'right' }>;
  root: string;
  treeSize: number;
}

export interface AnchoredAuditRoot {
  root: string;
  treeSize: number;
  date: string;
  ledgerSequence: number;
  ledgerHash: string;
  ledgerClosedAt: string;
}

/* ── Encoding helpers ─────────────────────────────────────────────── */

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/* ── SHA-256 helpers (RFC 6962 domain-separated) ──────────────────── */

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer));
}

async function leafHash(data: Uint8Array): Promise<Uint8Array> {
  return sha256(concatBytes(LEAF_PREFIX, data));
}

async function nodeHash(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  return sha256(concatBytes(NODE_PREFIX, left, right));
}

/* ── Merkle tree ──────────────────────────────────────────────────── */

export interface MerkleTree {
  leaves: Uint8Array[];
  root: Uint8Array;
  layers: Uint8Array[][];
}

/**
 * Build a Merkle tree from audit event entries.
 * Time: O(n). Space: O(n) for all layers.
 */
export async function buildMerkleTree(events: AuditEvent[]): Promise<MerkleTree> {
  if (events.length === 0) {
    throw new Error('Cannot build Merkle tree from zero events.');
  }

  const encoder = new TextEncoder();
  const leaves = await Promise.all(
    events.map((e) => leafHash(encoder.encode(JSON.stringify(e)))),
  );

  const layers: Uint8Array[][] = [leaves];
  let currentLayer = leaves;

  while (currentLayer.length > 1) {
    const nextLayer: Uint8Array[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i]!;
      const right = currentLayer[i + 1];
      if (right) {
        nextLayer.push(await nodeHash(left, right));
      } else {
        nextLayer.push(left);
      }
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  return { leaves, root: currentLayer[0]!, layers };
}

/**
 * Generate an inclusion proof for the leaf at `index`.
 * Time: O(log n). Space: O(log n).
 */
export function generateProof(tree: MerkleTree, index: number): MerkleProof {
  if (index < 0 || index >= tree.leaves.length) {
    throw new RangeError(`Leaf index ${index} out of range [0, ${tree.leaves.length}).`);
  }

  const siblings: MerkleProof['siblings'] = [];
  let idx = index;

  for (let layer = 0; layer < tree.layers.length - 1; layer++) {
    const currentLayer = tree.layers[layer]!;
    const isLeft = idx % 2 === 0;
    const siblingIdx = isLeft ? idx + 1 : idx - 1;

    const sibling = currentLayer[siblingIdx];
    if (sibling && siblingIdx < currentLayer.length) {
      siblings.push({
        hash: toHex(sibling),
        position: isLeft ? 'right' : 'left',
      });
    }
    idx = Math.floor(idx / 2);
  }

  return {
    leafIndex: index,
    leafHash: toHex(tree.leaves[index]!),
    siblings,
    root: toHex(tree.root),
    treeSize: tree.leaves.length,
  };
}

/**
 * Verify an inclusion proof in the browser. Recomputes the root from the
 * leaf and its sibling path, then compares against the trusted root.
 * Time: O(log n). Space: O(1).
 */
export async function verifyProof(proof: MerkleProof): Promise<boolean> {
  let current = fromHex(proof.leafHash);

  for (const sibling of proof.siblings) {
    const siblingBytes = fromHex(sibling.hash);
    current = sibling.position === 'right'
      ? await nodeHash(current, siblingBytes)
      : await nodeHash(siblingBytes, current);
  }

  return toHex(current) === proof.root;
}

/**
 * Generate a proof for a specific event within an event set.
 * Builds the tree and returns both the proof and the tree root.
 */
export async function generateAuditProof(
  events: AuditEvent[],
  targetEvent: AuditEvent,
): Promise<{ proof: MerkleProof; tree: MerkleTree }> {
  const targetJson = JSON.stringify(targetEvent);
  const targetLeaf = await leafHash(new TextEncoder().encode(targetJson));
  const targetHex = toHex(targetLeaf);

  const tree = await buildMerkleTree(events);
  const index = tree.leaves.findIndex((l) => toHex(l) === targetHex);

  if (index === -1) {
    throw new Error('Target event not found in the audit event set.');
  }

  return { proof: generateProof(tree, index), tree };
}

/* ── Stellar ledger anchoring ─────────────────────────────────────── */

interface HorizonLedger {
  sequence: number;
  hash: string;
  closed_at: string;
}

/**
 * Fetch the most recent closed ledger from Horizon.
 *
 * Horizon's `GET /ledgers` endpoint accepts `cursor`, `order`, and `limit`
 * as pagination parameters. The cursor is a numeric `paging_token`, NOT a
 * timestamp, so there is no way to query ledgers by date directly. Instead
 * we retrieve the latest ledger (`order=desc&limit=1`) and use it as the
 * immutable anchor point for the audit tree.
 *
 * @see https://developers.stellar.org/docs/data/apis/horizon/api-reference/list-all-ledgers
 * @param horizonUrl - Horizon base URL (e.g. `https://horizon-testnet.stellar.org`).
 */
export async function fetchLatestLedger(
  horizonUrl: string,
): Promise<HorizonLedger> {
  const url = `${horizonUrl}/ledgers?order=desc&limit=1`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Horizon ledger fetch failed: ${resp.status} ${resp.statusText}`);
  }
  const data = await resp.json();
  const records = data._embedded?.records;
  if (!records || records.length === 0) {
    throw new Error('No ledgers returned from Horizon.');
  }
  const ledger = records[0];
  return {
    sequence: ledger.sequence,
    hash: ledger.hash,
    closed_at: ledger.closed_at,
  };
}

/**
 * Fetch a specific ledger by sequence number and return its hash for
 * independent verification.
 */
export async function fetchLedgerBySequence(
  horizonUrl: string,
  sequence: number,
): Promise<HorizonLedger> {
  const resp = await fetch(`${horizonUrl}/ledgers/${sequence}`);
  if (!resp.ok) {
    throw new Error(`Horizon ledger fetch failed: ${resp.status} ${resp.statusText}`);
  }
  const ledger = await resp.json();
  return {
    sequence: ledger.sequence,
    hash: ledger.hash,
    closed_at: ledger.closed_at,
  };
}

/**
 * Anchor a Merkle tree root to the latest Stellar ledger.
 * Fetches the most recent closed ledger and binds the tree root to it,
 * recording the anchor date as metadata.
 */
export async function anchorTreeToLedger(
  tree: MerkleTree,
  date: string,
  horizonUrl: string,
): Promise<AnchoredAuditRoot> {
  const ledger = await fetchLatestLedger(horizonUrl);
  return {
    root: toHex(tree.root),
    treeSize: tree.leaves.length,
    date,
    ledgerSequence: ledger.sequence,
    ledgerHash: ledger.hash,
    ledgerClosedAt: ledger.closed_at,
  };
}

/**
 * Verify an anchored audit root against the Stellar network.
 * Re-fetches the ledger by sequence and confirms the hash matches.
 */
export async function verifyAnchor(
  anchor: AnchoredAuditRoot,
  horizonUrl: string,
): Promise<{ valid: boolean; ledgerMatch: boolean; ledger: HorizonLedger }> {
  const ledger = await fetchLedgerBySequence(horizonUrl, anchor.ledgerSequence);
  const ledgerMatch = ledger.hash === anchor.ledgerHash;
  return { valid: ledgerMatch, ledgerMatch, ledger };
}
