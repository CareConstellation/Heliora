# Circuits

Circom circuits for Heliora's zero-knowledge eligibility proofs.

| File | Statement |
|---|---|
| `age_eligibility.circom` | born on or before a public cutoff date |
| `insurance_coverage.circom` | insurance policy not expired on a public date |
| `setup.sh` | builds the Groth16 proving/verification artifacts |

Full parameters, security bounds, constraint budgets and the trusted-setup
reproduction steps are in [`docs/zk-circuits.md`](../docs/zk-circuits.md).

Quick start:

```bash
npm ci
BEACON=<64 hex chars of public randomness> circuits/setup.sh   # needs circom >= 2.1.6
```
