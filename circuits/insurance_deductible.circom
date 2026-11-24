pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Proves the holder of an insurer-attested policy has already spent at least
// the policy deductible on covered care, without revealing the amount spent or
// the policy number.
//
// The insurer attests `commitment = Poseidon(policyId, spend, salt)`, binding
// the claimed spend to the policy so a proof cannot be replayed with a larger
// spend. `spend` and `deductible` are YYYYMMDD-style unsigned integers (cents),
// which compare numerically.
template InsuranceDeductible() {
    signal input policyId;     // private: policy number encoded as a field element
    signal input spend;        // private: amount spent on covered care
    signal input salt;         // private, issued with the credential
    signal input deductible;   // public: the policy's deductible
    signal input commitment;   // public: Poseidon(policyId, spend, salt), attested by the insurer

    // GreaterEqThan(32) is only sound for inputs below 2^32.
    component spendBits = Num2Bits(32);
    spendBits.in <== spend;
    component deductibleBits = Num2Bits(32);
    deductibleBits.in <== deductible;

    component met = GreaterEqThan(32);
    met.in[0] <== spend;
    met.in[1] <== deductible;
    met.out === 1;

    component hash = Poseidon(3);
    hash.inputs[0] <== policyId;
    hash.inputs[1] <== spend;
    hash.inputs[2] <== salt;
    hash.out === commitment;
}

component main {public [deductible, commitment]} = InsuranceDeductible();
