# Circuits

Circom circuits for Heliora's zero-knowledge eligibility proofs.

| File | Statement |
|---|---|
| `age_eligibility.circom` | born on or before a public cutoff date |
| `insurance_coverage.circom` | insurance policy not expired on a public date |
| `insurance_deductible.circom` | covered-care spend meets the policy deductible |
| `vaccine_verification.circom` | clinic-signed, unexpired vaccination, with a nullifier |
| `prescription_dosage.circom` | prescribed dose within a weight-based safe limit |
| `clinician_credential.circom` | board-signed, unexpired subspecialty certification; state license ID stays private |
| `financial_hardship.circom` | household income at or below 100/150/200% of the poverty guideline; emits the subsidised tier |
| `setup.sh` | builds the Groth16 proving/verification artifacts |
| `benchmark.ts` | compiles every circuit and reports constraints, wires and proving time |

Full parameters, security bounds, constraint budgets and the trusted-setup
reproduction steps are in [`docs/zk-circuits.md`](../docs/zk-circuits.md).

Quick start:

```bash
npm ci
BEACON=<64 hex chars of public randomness> circuits/setup.sh   # needs circom >= 2.1.6
```

## Benchmarks

`benchmark.ts` compiles every circuit, prints a markdown table of constraint
and wire counts, then times Groth16 `fullProve` (witness + proof) and `verify`
on a known-good sample input. If any circuit's constraint count grows more
than 10% over the baseline, it exits non-zero. CI runs it
(`.github/workflows/circuits-benchmark.yml`) against the base commit of every
PR that touches `circuits/`.

```bash
npm --prefix circuits install                         # needs circom >= 2.1.6 on PATH (or CIRCOM=…)
npm --prefix circuits run benchmark                   # constraints + proving times
npm --prefix circuits run benchmark:constraints       # constraints only (fast)
npm --prefix circuits run benchmark -- --baseline build/zk-bench/results.json --threshold 0.05
npm --prefix circuits run benchmark:update-baseline   # writes circuits/benchmark-baseline.json
```

When `circuits/benchmark-baseline.json` exists, it is the default baseline.
The benchmark's zkeys have a single-contributor phase 2 and are only good for
timing. Never deploy them.

A new circuit needs an entry in `SAMPLE_INPUTS` in `benchmark.ts`. A unit test
checks that each sample's keys match the circuit's `signal input`s.
