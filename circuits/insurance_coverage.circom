pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Proves the holder of an insurer-attested policy is covered on `currentDate`,
// without revealing the policy number or expiry date.
// Dates are YYYYMMDD integers, which compare like calendar dates.
template InsuranceCoverage() {
    signal input policyId;     // private: policy number encoded as a field element
    signal input expiryDate;   // private
    signal input salt;         // private, issued with the credential
    signal input currentDate;  // public
    signal input commitment;   // public: Poseidon(policyId, expiryDate, salt), attested by the insurer

    // GreaterEqThan(32) is only sound for inputs below 2^32.
    component expiryBits = Num2Bits(32);
    expiryBits.in <== expiryDate;
    component currentBits = Num2Bits(32);
    currentBits.in <== currentDate;

    component covered = GreaterEqThan(32);
    covered.in[0] <== expiryDate;
    covered.in[1] <== currentDate;
    covered.out === 1;

    component hash = Poseidon(3);
    hash.inputs[0] <== policyId;
    hash.inputs[1] <== expiryDate;
    hash.inputs[2] <== salt;
    hash.out === commitment;
}

component main {public [currentDate, commitment]} = InsuranceCoverage();
