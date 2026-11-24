# Heliora ZK verifier (Soroban)

On-chain Groth16 verifier for the `age_eligibility` circuit. It checks the
BN254 pairing equation with Stellar's native BN254 host functions, so the
contract only ever sees the proof and the two public signals
(`cutoffDate`, `commitment`) — never the birth date.

## Contract interface

```rust
fn __constructor(env, admin: Address, verification_key: VerificationKey);

fn verify_age_proof(
    env,
    proof: Groth16Proof,      // a: BytesN<64>, b: BytesN<128>, c: BytesN<64>
    signals: Vec<U256>,       // [cutoffDate, commitment]
) -> Result<bool, Error>;

fn update_verification_key(env, verification_key: VerificationKey) -> Result<(), Error>; // admin only
fn verification_key(env) -> Result<VerificationKey, Error>;
```

Points use the host's Ethereum-compatible layout:

- G1: `be(X) || be(Y)`, 64 bytes.
- G2: `be(X.c1) || be(X.c0) || be(Y.c1) || be(Y.c0)`, 128 bytes, which is the
  same coordinate order snarkjs exports.

`src/lib/zkEligibility.ts` (`encodeGroth16Proof`, `verifyAgeProofOnChain`)
converts a snarkjs proof and simulates the call.

Identity (`0…0`) points are rejected: a key or proof made of identities
satisfies the pairing equation trivially.

## Build and deploy

Requires Rust with the `wasm32-unknown-unknown` target and Stellar CLI.

```sh
cd contracts/zk-verifier
stellar contract build

# Generate the verification key JSON first (circuits/setup.sh), then convert its
# alpha/beta/gamma/delta/IC points to the byte layout above and deploy:
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/heliora_zk_verifier.wasm \
  --source <admin-secret-key> \
  --network testnet
```

The constructor takes the admin address and the verification key, e.g. via
`stellar contract invoke --id <CONTRACT_ID> -- deploy --admin <G...> --verification_key <json>`.
Set the resulting contract ID as `NEXT_PUBLIC_ZK_VERIFIER_CONTRACT_ID`.

BN254 host functions require Protocol 25 or later on the target network.

## Tests

```sh
cargo test
```

The tests cover malformed signal counts, identity-point rejection, constructor
validation, admin-only key rotation, and key storage. End-to-end vectors need a
trusted setup; generate them with `circuits/setup.sh` and a local
`snarkjs.fullProve`, then assert `verify_age_proof` returns `Ok(true)` for the
genuine proof and `Err(ProofRejected)` after flipping a byte in `a`.
