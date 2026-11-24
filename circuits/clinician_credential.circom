pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/eddsaposeidon.circom";

// Proves a clinician holds a current medical-board certification in a public
// subspecialty, signed by a public certifying board, without revealing the
// clinician's state license ID or the certification's exact expiry date.
//
// The board signs M = Poseidon(licenseId, specialtyCode, expiryDate) with
// EdDSA-Poseidon over BabyJubjub. The signature (R8, S) and licenseId never
// leave the prover, so verifiers learn only: "the board identified by
// (issuerAx, issuerAy) certified someone in `specialtyCode`, valid on
// `currentDate`".
//
// Dates are YYYYMMDD integers, which compare like calendar dates.
template ClinicianCredential() {
    // ---------------- Public Inputs (declared in public-signal order) -------
    signal input specialtyCode;   // public: subspecialty code being proven (e.g. NUCC taxonomy as integer)
    signal input currentDate;     // public: verification date (YYYYMMDD)
    signal input issuerAx;        // public: certifying board BabyJubjub public key Ax
    signal input issuerAy;        // public: certifying board BabyJubjub public key Ay

    // ---------------- Private Inputs ----------------
    signal input licenseId;       // private: state license ID encoded as a field element
    signal input expiryDate;      // private: certification expiry (YYYYMMDD)
    signal input sigR8x;          // private: board EdDSA signature R8.x
    signal input sigR8y;          // private: board EdDSA signature R8.y
    signal input sigS;            // private: board EdDSA signature S

    // 1. Certification not expired: expiryDate >= currentDate.
    //    GreaterEqThan(32) is only sound for inputs below 2^32.
    component expiryBits = Num2Bits(32);
    expiryBits.in <== expiryDate;
    component currentBits = Num2Bits(32);
    currentBits.in <== currentDate;

    component notExpired = GreaterEqThan(32);
    notExpired.in[0] <== expiryDate;
    notExpired.in[1] <== currentDate;
    notExpired.out === 1;

    // 2. Message bound to the license, subspecialty and expiry.
    component msgHash = Poseidon(3);
    msgHash.inputs[0] <== licenseId;
    msgHash.inputs[1] <== specialtyCode;
    msgHash.inputs[2] <== expiryDate;

    // 3. Board signature verified inside the circuit. A tampered licenseId,
    //    specialtyCode, expiryDate or signature makes this unsatisfiable.
    component sig = EdDSAPoseidonVerifier();
    sig.enabled <== 1;
    sig.Ax <== issuerAx;
    sig.Ay <== issuerAy;
    sig.R8x <== sigR8x;
    sig.R8y <== sigR8y;
    sig.S <== sigS;
    sig.M <== msgHash.out;
}

component main {public [specialtyCode, currentDate, issuerAx, issuerAy]} = ClinicianCredential();
