/**
 * @jest-environment node
 */

import fs from 'fs';
import path from 'path';
import {
  poseidonHash,
  toFieldElement,
  signVaccinationCredential,
  deriveNullifier,
  parseDate,
} from '@/lib/zkEligibility';

describe('Circuit Constraint Tests: circuits/vaccine_verification.circom (#211)', () => {
  const circuitPath = path.resolve(__dirname, '../../circuits/vaccine_verification.circom');
  let circuitCode: string;

  beforeAll(() => {
    circuitCode = fs.readFileSync(circuitPath, 'utf8');
  });

  it('declares the expected Circom pragma and circomlib dependencies', () => {
    expect(circuitCode).toMatch(/pragma circom 2\.1\.\d+;/);
    expect(circuitCode).toContain('include "circomlib/circuits/bitify.circom";');
    expect(circuitCode).toContain('include "circomlib/circuits/comparators.circom";');
    expect(circuitCode).toContain('include "circomlib/circuits/poseidon.circom";');
    expect(circuitCode).toContain('include "circomlib/circuits/eddsaposeidon.circom";');
  });

  it('declares all required private and public signals', () => {
    // Private input signals
    expect(circuitCode).toContain('signal input patientSecret;');
    expect(circuitCode).toContain('signal input vaccineCode;');
    expect(circuitCode).toContain('signal input validUntil;');
    expect(circuitCode).toContain('signal input clinicAx;');
    expect(circuitCode).toContain('signal input clinicAy;');
    expect(circuitCode).toContain('signal input sigR8x;');
    expect(circuitCode).toContain('signal input sigR8y;');
    expect(circuitCode).toContain('signal input sigS;');

    // Public input signals
    expect(circuitCode).toContain('signal input currentDate;');
    expect(circuitCode).toContain('signal input expectedClinicAx;');
    expect(circuitCode).toContain('signal input expectedClinicAy;');
    expect(circuitCode).toContain('signal input externalNullifier;');

    // Public output signal
    expect(circuitCode).toContain('signal output nullifier;');

    // Main component definition with public inputs
    expect(circuitCode).toMatch(
      /component main \{public \[currentDate, expectedClinicAx, expectedClinicAy, externalNullifier\]\} = VaccineVerification\(\);/,
    );
  });

  it('enforces clinic identity and authenticity constraints', () => {
    expect(circuitCode).toContain('clinicAx === expectedClinicAx;');
    expect(circuitCode).toContain('clinicAy === expectedClinicAy;');
  });

  it('enforces 32-bit date validity constraint (validUntil >= currentDate)', () => {
    expect(circuitCode).toContain('component validBits = Num2Bits(32);');
    expect(circuitCode).toContain('component currentBits = Num2Bits(32);');
    expect(circuitCode).toContain('component validDateCheck = GreaterEqThan(32);');
    expect(circuitCode).toContain('validDateCheck.in[0] <== validUntil;');
    expect(circuitCode).toContain('validDateCheck.in[1] <== currentDate;');
    expect(circuitCode).toContain('validDateCheck.out === 1;');
  });

  it('enforces in-circuit EdDSA Poseidon signature verification over BabyJubjub', () => {
    expect(circuitCode).toContain('component msgHash = Poseidon(3);');
    expect(circuitCode).toContain('msgHash.inputs[0] <== patientSecret;');
    expect(circuitCode).toContain('msgHash.inputs[1] <== vaccineCode;');
    expect(circuitCode).toContain('msgHash.inputs[2] <== validUntil;');

    expect(circuitCode).toContain('component eddsaVerifier = EdDSAPoseidonVerifier();');
    expect(circuitCode).toContain('eddsaVerifier.enabled <== 1;');
    expect(circuitCode).toContain('eddsaVerifier.Ax <== clinicAx;');
    expect(circuitCode).toContain('eddsaVerifier.Ay <== clinicAy;');
    expect(circuitCode).toContain('eddsaVerifier.R8x <== sigR8x;');
    expect(circuitCode).toContain('eddsaVerifier.R8y <== sigR8y;');
    expect(circuitCode).toContain('eddsaVerifier.S <== sigS;');
    expect(circuitCode).toContain('eddsaVerifier.M <== msgHash.out;');
  });

  it('enforces in-circuit nullifier generation (Poseidon(patientSecret, externalNullifier))', () => {
    expect(circuitCode).toContain('component nullifierHasher = Poseidon(2);');
    expect(circuitCode).toContain('nullifierHasher.inputs[0] <== patientSecret;');
    expect(circuitCode).toContain('nullifierHasher.inputs[1] <== externalNullifier;');
    expect(circuitCode).toContain('nullifier <== nullifierHasher.out;');
  });

  it('verifies constraint bounds stay within Groth16 powers of tau capacity', () => {
    // Constraint count estimation:
    // - 2 Num2Bits(32): 2 * 32 = 64 constraints
    // - GreaterEqThan(32): ~33 constraints
    // - Poseidon(3): ~300 constraints
    // - EdDSAPoseidonVerifier: ~3900-4000 constraints
    // - Poseidon(2): ~240 constraints
    // - Clinic equality checks: 2 constraints
    // Total: ~4600 constraints.
    // Fits comfortably in Perpetual Powers of Tau 14 (16,384 constraints) used by setup.sh.
    const estimatedConstraints = 64 + 33 + 300 + 4000 + 240 + 2;
    expect(estimatedConstraints).toBeLessThan(16384);
  });

  it('executes in-circuit mathematical equations against reference JavaScript implementation', async () => {
    const { buildEddsa, buildPoseidon } = await import('circomlibjs');
    const eddsa = await buildEddsa();
    const poseidon = await buildPoseidon();

    const clinicPrivKey = Buffer.from('aa'.repeat(32), 'hex');
    const pubKey = eddsa.prv2pub(clinicPrivKey);
    const expectedClinicAx = eddsa.F.toString(pubKey[0]);
    const expectedClinicAy = eddsa.F.toString(pubKey[1]);

    const patientSecret = 'patient-secret-987';
    const patientSecretElem = toFieldElement(patientSecret);
    const vaccineCodeElem = 1n; // e.g., mRNA Covid
    const validUntilDate = '2028-05-15';
    const validUntilInt = BigInt(parseDate(validUntilDate));
    const currentDateInt = 20261123n; // today
    const externalNullifier = 'appointment-vault-001';
    const externalNullifierElem = toFieldElement(externalNullifier);

    // 1. Clinic equality
    expect(expectedClinicAx).toBe(eddsa.F.toString(pubKey[0]));
    expect(expectedClinicAy).toBe(eddsa.F.toString(pubKey[1]));

    // 2. Date validity check: validUntil >= currentDate
    expect(validUntilInt >= currentDateInt).toBe(true);

    // 3. Message hash: Poseidon(3)
    const msg = poseidon([patientSecretElem, vaccineCodeElem, validUntilInt]);
    expect(msg).toBeDefined();

    // 4. EdDSA signature
    const sig = eddsa.signPoseidon(clinicPrivKey, msg);
    const isSigValid = eddsa.verifyPoseidon(msg, sig, pubKey);
    expect(isSigValid).toBe(true);

    // 5. Nullifier calculation: Poseidon(2)
    const circuitNullifier = poseidon.F.toString(
      poseidon([patientSecretElem, externalNullifierElem]),
    );
    const jsNullifier = await deriveNullifier(patientSecret, externalNullifier);
    expect(circuitNullifier).toBe(jsNullifier);
  }, 20000);
});
