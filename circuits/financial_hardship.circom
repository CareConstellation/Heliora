pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Proves a household's annual income is at or below 200% of the public
// poverty guideline for its size, and emits the subsidised fee tier it
// qualifies for, without revealing income, household size or tax returns.
//
// An income verifier (benefits office, tax authority, social worker) attests
// `commitment = Poseidon(householdIncome, householdSize, salt)`, so the holder
// cannot pick a smaller income than the one that was verified.
//
// Poverty guideline for a household of n people:
//     threshold = guidelineBase + guidelinePerPerson * (n - 1)
// (the HHS formula). Amounts are whole dollars per year.
//
// Public output `subsidizedTier`:
//     3  income <= 100% of guideline  (full fee waiver)
//     2  income <= 150% of guideline
//     1  income <= 200% of guideline
// Households above 200% cannot produce a proof.
template FinancialHardship() {
    // ---------------- Private Inputs ----------------
    signal input householdIncome;     // whole dollars / year
    signal input householdSize;       // number of people, 1..63
    signal input salt;                // issued with the attestation

    // ---------------- Public Inputs ----------------
    signal input guidelineBase;       // guideline for a 1-person household
    signal input guidelinePerPerson;  // increment per additional person
    signal input commitment;          // Poseidon(householdIncome, householdSize, salt)

    // ---------------- Public Output ----------------
    signal output subsidizedTier;

    // Range checks so the comparators below are sound (no field wrap-around).
    component incomeBits = Num2Bits(32);
    incomeBits.in <== householdIncome;
    component baseBits = Num2Bits(32);
    baseBits.in <== guidelineBase;
    component perPersonBits = Num2Bits(32);
    perPersonBits.in <== guidelinePerPerson;
    component sizeBits = Num2Bits(6);
    sizeBits.in <== householdSize;

    // householdSize >= 1
    component emptyHousehold = IsZero();
    emptyHousehold.in <== householdSize;
    emptyHousehold.out === 0;

    // threshold < 2^32 + 2^32 * 62 < 2^38
    signal additional;
    additional <== guidelinePerPerson * (householdSize - 1);
    signal threshold;
    threshold <== guidelineBase + additional;

    // Compare income*100 against threshold*{100,150,200} (all < 2^46).
    component le100 = LessEqThan(48);
    le100.in[0] <== householdIncome * 100;
    le100.in[1] <== threshold * 100;

    component le150 = LessEqThan(48);
    le150.in[0] <== householdIncome * 100;
    le150.in[1] <== threshold * 150;

    component le200 = LessEqThan(48);
    le200.in[0] <== householdIncome * 100;
    le200.in[1] <== threshold * 200;

    // Must qualify for at least the lowest subsidised tier.
    le200.out === 1;

    // Bands are nested (le100 => le150 => le200), so the sum is the tier.
    subsidizedTier <== le100.out + le150.out + le200.out;

    // Bind the private values to the verifier's attestation.
    component hash = Poseidon(3);
    hash.inputs[0] <== householdIncome;
    hash.inputs[1] <== householdSize;
    hash.inputs[2] <== salt;
    hash.out === commitment;
}

component main {public [guidelineBase, guidelinePerPerson, commitment]} = FinancialHardship();
