/**
 * @jest-environment node
 */
import {
  buildZipCodeMerkleTree,
  computeResidencyCommitment,
  computeZipCodeLeaf,
  parseCredential,
  verifyGeoResidencyProof,
  verifyZipCodeMerkleProof,
  GEO_RESIDENCY_TREE_DEPTH,
} from '@/lib/zkEligibility';
import type { GeoResidencyProofToken } from '@/types';

describe('Zero-Knowledge Geographic Residency Verification (#220)', () => {
  const sampleZipCodes = [90210, 94102, 94103, 94107, 98101, 10001, 10002];

  describe('computeZipCodeLeaf and computeResidencyCommitment', () => {
    it('computes deterministic Poseidon leaf from valid 5-digit ZIP codes', () => {
      const leaf1 = computeZipCodeLeaf(90210);
      const leaf2 = computeZipCodeLeaf(90210);
      const leafOther = computeZipCodeLeaf(10001);

      expect(leaf1).toBe(leaf2);
      expect(typeof leaf1).toBe('bigint');
      expect(leaf1).not.toBe(leafOther);
    });

    it('rejects invalid ZIP codes outside [0, 99999]', () => {
      expect(() => computeZipCodeLeaf(-1)).toThrow('Invalid ZIP code');
      expect(() => computeZipCodeLeaf(100000)).toThrow('Invalid ZIP code');
    });

    it('computes deterministic patient residency commitment', () => {
      const salt = '12345678901234567890';
      const comm1 = computeResidencyCommitment(90210, salt);
      const comm2 = computeResidencyCommitment(90210, salt);
      const commDiff = computeResidencyCommitment(90210, '99999999999999999999');

      expect(comm1).toBe(comm2);
      expect(comm1).not.toBe(commDiff);
    });
  });

  describe('buildZipCodeMerkleTree and verifyZipCodeMerkleProof', () => {
    it('constructs a valid Merkle tree and generates verifiable proofs', () => {
      const depth = 4; // 2^4 = 16 leaves for quick test
      const { root, getProof } = buildZipCodeMerkleTree(sampleZipCodes, depth);

      expect(typeof root).toBe('bigint');

      // Verify proof for 90210
      const proof90210 = getProof(90210);
      expect(proof90210.root).toBe(root);
      expect(proof90210.siblings).toHaveLength(depth);
      expect(proof90210.pathIndices).toHaveLength(depth);

      const leaf90210 = computeZipCodeLeaf(90210);
      const isValid = verifyZipCodeMerkleProof(
        leaf90210,
        proof90210.siblings,
        proof90210.pathIndices,
        root,
      );
      expect(isValid).toBe(true);

      // Verify proof for 98101
      const proof98101 = getProof(98101);
      const leaf98101 = computeZipCodeLeaf(98101);
      expect(
        verifyZipCodeMerkleProof(leaf98101, proof98101.siblings, proof98101.pathIndices, root),
      ).toBe(true);
    });

    it('rejects tampered sibling or wrong leaf in Merkle verification', () => {
      const depth = 4;
      const { root, getProof } = buildZipCodeMerkleTree(sampleZipCodes, depth);
      const proof = getProof(90210);
      const leaf90210 = computeZipCodeLeaf(90210);

      // Tampered sibling
      const tamperedSiblings = [...proof.siblings];
      tamperedSiblings[0] = (tamperedSiblings[0] ?? 0n) + 1n;
      expect(
        verifyZipCodeMerkleProof(leaf90210, tamperedSiblings, proof.pathIndices, root),
      ).toBe(false);

      // Wrong leaf
      const foreignLeaf = computeZipCodeLeaf(30301); // not in tree
      expect(
        verifyZipCodeMerkleProof(foreignLeaf, proof.siblings, proof.pathIndices, root),
      ).toBe(false);

      // Wrong root
      expect(
        verifyZipCodeMerkleProof(leaf90210, proof.siblings, proof.pathIndices, 99999999n),
      ).toBe(false);
    });

    it('throws when requesting proof for a non-member ZIP code', () => {
      const { getProof } = buildZipCodeMerkleTree(sampleZipCodes, 4);
      expect(() => getProof(12345)).toThrow('not in the authorized jurisdiction tree');
    });

    it('supports standard GEO_RESIDENCY_TREE_DEPTH = 10', () => {
      const { root, getProof } = buildZipCodeMerkleTree([90210, 94102]);
      const proof = getProof(90210);
      expect(proof.siblings).toHaveLength(GEO_RESIDENCY_TREE_DEPTH);
      expect(proof.pathIndices).toHaveLength(GEO_RESIDENCY_TREE_DEPTH);
      const leaf = computeZipCodeLeaf(90210);
      expect(verifyZipCodeMerkleProof(leaf, proof.siblings, proof.pathIndices, root)).toBe(true);
    });
  });

  describe('parseCredential with geoResidency', () => {
    it('parses valid geoResidency credential JSON', () => {
      const json = JSON.stringify({
        type: 'geoResidency',
        zipCode: 90210,
        salt: '12345678901234567890',
        commitment: '98765432109876543210',
      });

      const cred = parseCredential(json);
      expect(cred.type).toBe('geoResidency');
      if (cred.type === 'geoResidency') {
        expect(cred.zipCode).toBe(90210);
        expect(cred.salt).toBe('12345678901234567890');
        expect(cred.commitment).toBe('98765432109876543210');
      }
    });

    it('rejects malformed geoResidency credential JSON', () => {
      const json = JSON.stringify({
        type: 'geoResidency',
        zipCode: 1000000, // invalid range
        salt: '123',
        commitment: '456',
      });
      expect(() => parseCredential(json)).toThrow('Unrecognised eligibility credential');
    });
  });

  describe('verifyGeoResidencyProof', () => {
    it('returns false when public signals do not match expected root or commitment', async () => {
      const fakeToken: GeoResidencyProofToken = {
        kind: 'geoResidency',
        proof: {},
        publicSignals: ['11111111', '22222222'],
      };

      const result = await verifyGeoResidencyProof(fakeToken, '99999999', '22222222');
      expect(result).toBe(false);
    });

    it('returns false when public signals are non-canonical', async () => {
      const fakeToken: GeoResidencyProofToken = {
        kind: 'geoResidency',
        proof: {},
        publicSignals: ['-5', '22222222'],
      };

      const result = await verifyGeoResidencyProof(fakeToken, '-5', '22222222');
      expect(result).toBe(false);
    });
  });
});
