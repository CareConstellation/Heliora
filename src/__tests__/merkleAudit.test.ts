import { AppendOnlyMerkleAuditLog, buildMerkleTree, generateProof, verifyProof, type AuditEvent } from '@/lib/merkleAudit';

const events: AuditEvent[] = [
  { timestamp: '2026-01-01T00:00:00Z', action: 'record_created', actorAddress: 'GAA', subjectAddress: 'GBB', recordId: 'R1' },
  { timestamp: '2026-01-01T01:00:00Z', action: 'record_accessed', actorAddress: 'GCC', subjectAddress: 'GBB', recordId: 'R1' },
  { timestamp: '2026-01-01T02:00:00Z', action: 'access_granted', actorAddress: 'GBB', subjectAddress: 'GDD', recordId: 'R1' },
];

describe('merkleAudit', () => {
  it('builds a binary Merkle tree with SHA-256 root', async () => {
    const tree = await buildMerkleTree(events);
    expect(tree.leaves).toHaveLength(3);
    expect(tree.root).toBeInstanceOf(Uint8Array);
    expect(tree.root).toHaveLength(32);
  });

  it('generates and verifies inclusion proofs', async () => {
    const tree = await buildMerkleTree(events);
    for (let i = 0; i < events.length; i++) {
      const proof = generateProof(tree, i);
      await expect(verifyProof(proof)).resolves.toBe(true);
    }
  });

  it('supports append-only audit log growth', async () => {
    const log = new AppendOnlyMerkleAuditLog();
    await log.append(events[0]!);
    const first = await log.buildTree();
    await log.append(events[1]!);
    const second = await log.buildTree();
    expect(log.size).toBe(2);
    expect(Array.from(first.root)).not.toEqual(Array.from(second.root));
    await expect(verifyProof(generateProof(second, 0))).resolves.toBe(true);
  });
});
