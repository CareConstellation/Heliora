pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Proves the holder of an issuer-attested birth date was born on or before
// `cutoffDate` (today minus the minimum age), without revealing the birth date.
// Dates are YYYYMMDD integers, which compare like calendar dates.
template AgeEligibility() {
    signal input birthDate;   // private
    signal input salt;        // private, issued with the credential
    signal input cutoffDate;  // public
    signal input commitment;  // public: Poseidon(birthDate, salt), attested by the issuer

    // LessEqThan(32) is only sound for inputs below 2^32.
    component birthBits = Num2Bits(32);
    birthBits.in <== birthDate;
    component cutoffBits = Num2Bits(32);
    cutoffBits.in <== cutoffDate;

    component oldEnough = LessEqThan(32);
    oldEnough.in[0] <== birthDate;
    oldEnough.in[1] <== cutoffDate;
    oldEnough.out === 1;

    component hash = Poseidon(2);
    hash.inputs[0] <== birthDate;
    hash.inputs[1] <== salt;
    hash.out === commitment;
}

component main {public [cutoffDate, commitment]} = AgeEligibility();
