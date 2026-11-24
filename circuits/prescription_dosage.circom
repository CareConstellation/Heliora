pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

// Proves that a prescribed medication dosage (e.g. mg) does not exceed
// the maximum safe dosage for the patient:
// dosage <= patientWeight * safeThreshold
// without disclosing the patient's actual weight.
// The patient weight is attested by an authorized clinic/triage commitment:
// commitment = Poseidon(patientWeight, salt).
template PrescriptionDosage() {
    signal input patientWeight;  // private: patient weight (e.g., in kg or grams)
    signal input salt;           // private: cryptographic salt issued with weight attestation
    signal input dosage;         // public: prescribed drug amount
    signal input safeThreshold;  // public: safe maximum limit per unit weight (e.g., mg/kg)
    signal input commitment;     // public: Poseidon(patientWeight, salt)

    // Bit-width constraints for sound comparison:
    // Ensure inputs fit within 64 bits to prevent overflow in the field.
    component weightBits = Num2Bits(64);
    weightBits.in <== patientWeight;

    component dosageBits = Num2Bits(64);
    dosageBits.in <== dosage;

    component thresholdBits = Num2Bits(64);
    thresholdBits.in <== safeThreshold;

    // Compute maximum allowable dosage: maxAllowed = patientWeight * safeThreshold
    signal maxAllowed;
    maxAllowed <== patientWeight * safeThreshold;

    component maxBits = Num2Bits(128);
    maxBits.in <== maxAllowed;

    // Check dosage <= maxAllowed
    component withinSafeBoundary = LessEqThan(128);
    withinSafeBoundary.in[0] <== dosage;
    withinSafeBoundary.in[1] <== maxAllowed;
    withinSafeBoundary.out === 1;

    // Verify Poseidon commitment to patient's private weight
    component hash = Poseidon(2);
    hash.inputs[0] <== patientWeight;
    hash.inputs[1] <== salt;
    hash.out === commitment;
}

component main {public [dosage, safeThreshold, commitment]} = PrescriptionDosage();
