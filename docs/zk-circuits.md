# Zero-Knowledge Circuits

Heliora proves eligibility facts (age, insurance coverage) without revealing the
underlying data. Proofs are Groth16 over BN254, written in Circom 2.1.6 and
proved/verified with snarkjs (`src/lib/zkEligibility.ts`).

| Circuit | File | Proves | Public inputs | Private inputs |
|---|---|---|---|---|
| `age_eligibility` | `circuits/age_eligibility.circom` | holder was born on or before `cutoffDate` | `cutoffDate`, `commitment` | `birthDate`, `salt` |
| `insurance_coverage` | `circuits/insurance_coverage.circom` | policy is not expired on `currentDate` | `currentDate`, `commitment` | `policyId`, `expiryDate`, `salt` |
| `clinician_credential` | `circuits/clinician_credential.circom` | a medical board certified the holder in subspecialty `specialtyCode`, and the certification has not expired on `currentDate` | `specialtyCode`, `currentDate`, `issuerAx`, `issuerAy` | `licenseId`, `expiryDate`, board signature `sigR8x`, `sigR8y`, `sigS` |
| `financial_hardship` | `circuits/financial_hardship.circom` | household income is at or below 200% of the poverty guideline for its size; outputs the subsidised tier | `guidelineBase`, `guidelinePerPerson`, `commitment`; output `subsidizedTier` | `householdIncome`, `householdSize`, `salt` |

### Clinician subspecialty credential

The certifying board signs `M = Poseidon(licenseId, specialtyCode, expiryDate)`
with EdDSA-Poseidon over BabyJubjub (`signClinicianCredential`). The circuit
checks the signature with `EdDSAPoseidonVerifier`, so changing the license,
subspecialty or expiry, or forging the signature, leaves no satisfying witness.
The verifier (`verifyClinicianCredentialProof`) **must** pin the board public
key and the expected subspecialty, and reject proofs whose `currentDate` is
before today. `licenseId` is SHA-256 of the license number truncated to 248 bits
(`licenseIdFromNumber`). Non-numeric subspecialty codes (e.g. NUCC `207RC0000X`)
are encoded the same way (`specialtyCodeToField`).

### Financial hardship fee tier

An income verifier (benefits office, tax authority, social worker) attests
`commitment = Poseidon(householdIncome, householdSize, salt)`. The circuit
computes the HHS guideline `threshold = guidelineBase + guidelinePerPerson * (size - 1)`
and compares `income * 100` with `threshold * {100, 150, 200}` exactly (no
rounding):

| `subsidizedTier` | Income vs. guideline |
|---|---|
| 3 | ≤ 100% (full waiver) |
| 2 | ≤ 150% |
| 1 | ≤ 200% |
| — | > 200%: no proof can be produced |

Bounds: income and guideline amounts are whole dollars `< 2^32`, and household
size is `1..63` (`Num2Bits(6)`). The verifier
(`verifyFinancialHardshipProof`) must check that `commitment` was attested and
that the guideline is the one currently in force.

## How a proof works

1. An issuer (hospital, insurer) attests a credential by publishing
   `commitment = Poseidon(fields..., salt)` and handing the holder the fields
   and `salt`.
2. The holder proves, in the browser, that their private fields hash to the
   attested `commitment` **and** satisfy the public predicate.
3. A verifier checks the proof against the circuit's verification key
   (`<circuit>.vkey.json`) and the public inputs. The verifier never sees the
   private inputs.

Dates are `YYYYMMDD` integers, which compare like calendar dates.

## Input validation (field elements)

Every circuit signal is an element of the BN254 scalar field
`r = 21888242871839275222246405745257275088548364400416034343698204186575808495617`.
The witness calculator silently reduces larger values modulo `r`, so
`salt + r` would prove exactly what `salt` proves while looking different to
off-circuit checks (equality of commitments, nullifier replay lists).
`src/lib/zkInputValidation.ts` therefore:

- requires every prover input to satisfy `0 ≤ x < r`, given as a bigint, a safe
  integer, a canonical decimal string or a `0x` hex string, and throws
  `ZkInputValidationError` (naming the signal) otherwise (`sanitizeCircuitInput`);
- rejects credential files whose salts, commitments or signature values are
  `≥ r` (`parseCredential`, `parseClinicianCredential`,
  `parseFinancialHardshipCredential`);
- makes verifiers reject proofs whose public signals or nullifier are not
  canonical (`arePublicSignalsCanonical`).

## Parameters and security bounds

| Item | Value | Why it matters |
|---|---|---|
| Proving system | Groth16, BN254 | Needs a circuit-specific trusted setup (below). |
| Date range | `0 <= date < 2^32` | `LessEqThan(32)` / `GreaterEqThan(32)` are only sound for inputs below `2^32`. Both circuits constrain this with `Num2Bits(32)`. `YYYYMMDD` values (~2.0e7) are far below the bound. |
| Hash | Poseidon (circomlib) | `Poseidon(2)` for age, `Poseidon(3)` for insurance. |
| `salt` | Field element, issuer-generated, unique per credential | Without a high-entropy `salt` the commitment can be brute-forced: a birth date has only ~36,500 plausible values. Use at least 128 bits of randomness. |
| Soundness | ~128-bit security level for BN254 | Soundness holds only if at least one setup participant discarded their toxic waste. |
| Zero knowledge | Proofs reveal only public inputs | The proof is randomised, so two proofs for the same statement are unlinkable. The `commitment` itself is public and links proofs made from the same credential. |

Public-input binding: a verifier **must** check that `commitment` was attested
by the issuer, and that `cutoffDate` / `currentDate` is the value the verifier
expects. A valid proof for an attacker-chosen date proves nothing.

## Constraint budgets

Approximate non-linear constraint counts from the circomlib templates used.
They are estimates; get exact numbers for a build with
`npx snarkjs r1cs info build/zk/<circuit>.r1cs`.

| Component | Approx. constraints |
|---|---|
| `Num2Bits(32)` | ~32 |
| `LessEqThan(32)` / `GreaterEqThan(32)` | ~33 |
| `Poseidon(2)` | ~240 |
| `Poseidon(3)` | ~260 |

| Circuit | Components | Approx. total |
|---|---|---|
| `age_eligibility` | 2 x `Num2Bits(32)`, 1 x `LessEqThan(32)`, `Poseidon(2)` | ~340 |
| `insurance_coverage` | 2 x `Num2Bits(32)`, 1 x `GreaterEqThan(32)`, `Poseidon(3)` | ~360 |
| `clinician_credential` | 2 x `Num2Bits(32)`, 1 x `GreaterEqThan(32)`, `Poseidon(3)`, `EdDSAPoseidonVerifier` (~4,200) | ~4,600 |
| `financial_hardship` | 3 x `Num2Bits(32)`, `Num2Bits(6)`, 3 x `LessEqThan(48)`, `IsZero`, `Poseidon(3)` | ~510 |

All circuits fit in the `2^14` (16,384 constraint) Powers of Tau file used by
`circuits/setup.sh` (`ppot_0080_14.ptau`). A circuit that grows past that needs
a larger `.ptau` file, and `setup.sh` must be updated.

### Measured counts and proving time

`npm --prefix circuits run benchmark` compiles every circuit and prints exact
constraint/wire counts plus median Groth16 proving and verification times (see
`circuits/README.md`). The `Circuit benchmarks` GitHub Actions workflow runs it
on every PR that touches `circuits/`, publishes the table in the job summary,
and fails if a circuit's constraint count grows by more than 10% over the base
commit.

## Trusted setup

Groth16 needs two phases:

- **Phase 1 (universal):** the public PSE Perpetual Powers of Tau, contribution
  80, beacon applied and prepared for phase 2. It is downloaded by
  `circuits/setup.sh`; nothing to run.
- **Phase 2 (circuit-specific):** run per circuit. `setup.sh` performs a single
  contribution plus a public random beacon. **For production, have several
  independent parties contribute in turn before the beacon** (see
  "Multi-party ceremony" below).

### Reproduce the artifacts

Prerequisites: Node.js, `npm ci` (installs `snarkjs` and `circomlib`), and
[Circom](https://docs.circom.io/getting-started/installation/) >= 2.1.6.

```bash
# BEACON: 64 hex characters of public randomness chosen AFTER the last
# contribution, e.g. the hash of a future Bitcoin/Ethereum block.
BEACON=<64 hex chars> circuits/setup.sh
```

For each circuit the script:

1. compiles it: `circom circuits/<name>.circom --r1cs --wasm`
2. creates the phase 2 start key: `snarkjs groth16 setup <r1cs> <ptau> <name>_0000.zkey`
3. adds a contribution: `snarkjs zkey contribute`
4. applies the beacon: `snarkjs zkey beacon` (10 iterations)
5. verifies the final key against the circuit and the `.ptau`: `snarkjs zkey verify`
6. exports `<name>.vkey.json` and copies `<name>.wasm`

Output is written to `public/zk/` (or the URL set in `NEXT_PUBLIC_ZK_ARTIFACTS_URL`):
`<circuit>.wasm`, `<circuit>.zkey`, `<circuit>.vkey.json`.

### Multi-party ceremony

Run steps 1-2 above, then pass the key between participants. Each participant
runs, on their own machine:

```bash
snarkjs zkey contribute <name>_000N.zkey <name>_000N+1.zkey --name="<participant>" -e="<fresh entropy>"
```

and publishes the contribution hash printed by the command. After the last
participant, apply the beacon (step 4), verify (step 5) and export (step 6).
Anyone can re-verify the final key with `snarkjs zkey verify`.

### Verifying a published setup

1. Rebuild `<circuit>.r1cs` from the committed `.circom` file with the same
   Circom version.
2. Run `snarkjs zkey verify <circuit>.r1cs ppot_0080_14.ptau <circuit>.zkey`.
3. Re-export the verification key and compare it with the published
   `<circuit>.vkey.json`.

## Known gaps

- `circuits/setup.sh` also loops over `vaccination_proof`, but
  `circuits/vaccination_proof.circom` does not exist yet. The script fails at
  that circuit until the file is added or the name is removed from the loop.
- The constraint counts in the tables above are estimates. Run the benchmark
  harness for measured values.
