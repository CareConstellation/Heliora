pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/eddsaposeidon.circom";

// Proves the holder possesses an approved vaccination attested by an authorized clinic's
// EdDSA signature over BabyJubjub, that the vaccination is currently valid (not expired),
// and outputs a deterministic nullifier to prevent double-spending or credential sharing.
//
// Dates are YYYYMMDD integers, comparing chronologically like calendar dates.
template VaccineVerification() {
    // ---------------- Private Inputs ----------------
    signal input patientSecret;     // Patient secret entropy
    signal input vaccineCode;      // Numeric vaccine code (e.g., ICD/SNOMED / integer ID)
    signal input validUntil;       // Expiration date (YYYYMMDD)
    signal input clinicAx;         // Clinic BabyJubjub public key Ax
    signal input clinicAy;         // Clinic BabyJubjub public key Ay
    signal input sigR8x;           // Clinic EdDSA signature R8x point
    signal input sigR8y;           // Clinic EdDSA signature R8y point
    signal input sigS;             // Clinic EdDSA signature S scalar

    // ---------------- Public Inputs ----------------
    signal input currentDate;       // Current date (YYYYMMDD)
    signal input expectedClinicAx;  // Expected clinic Ax (authenticity check)
    signal input expectedClinicAy;  // Expected clinic Ay
    signal input externalNullifier; // Context-binding nullifier seed (e.g. appointment or verifier ID)

    // ---------------- Public Outputs ----------------
    signal output nullifier;        // Deterministic nullifier preventing credential sharing

    // 1. Verify Clinic Identity matches expected authorized clinic public key
    clinicAx === expectedClinicAx;
    clinicAy === expectedClinicAy;

    // 2. Verify Vaccination is Valid (validUntil >= currentDate)
    component validBits = Num2Bits(32);
    validBits.in <== validUntil;
    component currentBits = Num2Bits(32);
    currentBits.in <== currentDate;

    component validDateCheck = GreaterEqThan(32);
    validDateCheck.in[0] <== validUntil;
    validDateCheck.in[1] <== currentDate;
    validDateCheck.out === 1;

    // 3. Compute message hash M = Poseidon(patientSecret, vaccineCode, validUntil)
    component msgHash = Poseidon(3);
    msgHash.inputs[0] <== patientSecret;
    msgHash.inputs[1] <== vaccineCode;
    msgHash.inputs[2] <== validUntil;

    // 4. Verify EdDSA Poseidon signature from the clinic over the message
    component eddsaVerifier = EdDSAPoseidonVerifier();
    eddsaVerifier.enabled <== 1;
    eddsaVerifier.Ax <== clinicAx;
    eddsaVerifier.Ay <== clinicAy;
    eddsaVerifier.R8x <== sigR8x;
    eddsaVerifier.R8y <== sigR8y;
    eddsaVerifier.S <== sigS;
    eddsaVerifier.M <== msgHash.out;

    // 5. Generate Nullifier = Poseidon(patientSecret, externalNullifier)
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== patientSecret;
    nullifierHasher.inputs[1] <== externalNullifier;
    nullifier <== nullifierHasher.out;
}

component main {public [currentDate, expectedClinicAx, expectedClinicAy, externalNullifier]} = VaccineVerification();
