pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/switcher.circom";

/**
 * Zero-Knowledge Geographic Residency Verification (#220)
 *
 * Proves that a patient's residential ZIP code is an authorized member of an
 * approved state/regional healthcare jurisdiction Merkle tree (`authorizedRoot`),
 * without disclosing the patient's exact ZIP code or address to the verifier.
 *
 * Parameters:
 *   levels: Depth of the Merkle tree (depth 10 supports up to 1,024 approved ZIP codes)
 *
 * Signals:
 *   - zipCode (private): 5-digit residential ZIP code as an integer
 *   - salt (private): Random entropy blinding the patient's identity
 *   - siblings[levels] (private): Merkle audit path sister hashes
 *   - pathIndices[levels] (private): Binary path routing bits (0 = left, 1 = right)
 *   - authorizedRoot (public): Merkle root of the jurisdiction's approved ZIP codes
 *   - residencyCommitment (public): Poseidon(zipCode, salt) linking to patient profile
 */
template GeoResidency(levels) {
    // Private inputs
    signal input zipCode;
    signal input salt;
    signal input siblings[levels];
    signal input pathIndices[levels];

    // Public inputs
    signal input authorizedRoot;
    signal input residencyCommitment;

    // 1. Constrain zipCode to valid 5-digit range [0, 99999] (fits in 17 bits: 2^17 = 131,072)
    component zipBits = Num2Bits(17);
    zipBits.in <== zipCode;

    component zipMax = LessEqThan(17);
    zipMax.in[0] <== zipCode;
    zipMax.in[1] <== 99999;
    zipMax.out === 1;

    // 2. Validate patient residency commitment: Poseidon(zipCode, salt) === residencyCommitment
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== zipCode;
    commitmentHasher.inputs[1] <== salt;
    commitmentHasher.out === residencyCommitment;

    // 3. Compute leaf commitment: Poseidon(zipCode)
    component leafHasher = Poseidon(1);
    leafHasher.inputs[0] <== zipCode;
    signal leaf <== leafHasher.out;

    // 4. Verify Merkle membership of the leaf up to authorizedRoot
    component switchers[levels];
    component hashers[levels];

    signal currentHash[levels + 1];
    currentHash[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        // Constrain path index to binary {0, 1}
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        switchers[i] = Switcher();
        switchers[i].sel <== pathIndices[i];
        switchers[i].L <== currentHash[i];
        switchers[i].R <== siblings[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== switchers[i].outL;
        hashers[i].inputs[1] <== switchers[i].outR;

        currentHash[i + 1] <== hashers[i].out;
    }

    // Verify computed root matches authorized root
    currentHash[levels] === authorizedRoot;
}

component main {public [authorizedRoot, residencyCommitment]} = GeoResidency(10);
