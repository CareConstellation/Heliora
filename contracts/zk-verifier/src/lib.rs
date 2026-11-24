#![no_std]

//! On-chain Groth16 verifier for the `age_eligibility` circuit.
//!
//! The circuit proves `birthDate <= cutoffDate` against an issuer-attested
//! Poseidon commitment. This contract checks the BN254 pairing equation
//!
//! ```text
//! e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) = 1
//! ```
//!
//! with `vk_x = IC[0] + Σ signal_i · IC[i+1]`, using Stellar's native BN254
//! host functions (Protocol 25+). The contract never sees the birth date.
//!
//! Public inputs for this circuit are `[cutoffDate, commitment]`, so callers
//! should also check that `cutoffDate` is the expected cutoff and that
//! `commitment` is the patient's registered commitment (the frontend helper in
//! `src/lib/zkEligibility.ts` does both).

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    Address, BytesN, Env, U256, Vec,
};

/// Serialized size of a G1 point: be(X) || be(Y), 32 bytes each.
pub const G1_SIZE: u32 = 64;
/// Serialized size of a G2 point: be(X.c1) || be(X.c0) || be(Y.c1) || be(Y.c0).
pub const G2_SIZE: u32 = 128;

/// A Groth16 proof in snarkjs' field order (G2 coordinates are c1 || c0).
#[contracttype]
#[derive(Clone)]
pub struct Groth16Proof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

/// The circuit's verification key, as exported by `snarkjs zkey export verificationkey`.
#[contracttype]
#[derive(Clone)]
pub struct VerificationKey {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    /// `IC[0] .. IC[n]`; `IC.len() == public_inputs.len() + 1`.
    pub ic: Vec<BytesN<64>>,
}

#[contracttype]
pub enum DataKey {
    Admin,
    VerificationKey,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    MalformedVerificationKey = 2,
    MalformedSignals = 3,
    IdentityPoint = 4,
    ProofRejected = 5,
}

#[contract]
pub struct ZkVerifier;

#[contractimpl]
impl ZkVerifier {
    /// Stores the admin and the verification key of the deployed circuit.
    pub fn __constructor(
        env: Env,
        admin: Address,
        verification_key: VerificationKey,
    ) -> Result<(), Error> {
        if verification_key.ic.len() < 2 {
            return Err(Error::MalformedVerificationKey);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::VerificationKey, &verification_key);
        Ok(())
    }

    /// Rotates the verification key after a new trusted setup. Admin only.
    pub fn update_verification_key(
        env: Env,
        verification_key: VerificationKey,
    ) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        if verification_key.ic.len() < 2 {
            return Err(Error::MalformedVerificationKey);
        }
        env.storage()
            .instance()
            .set(&DataKey::VerificationKey, &verification_key);
        Ok(())
    }

    /// Verifies an age-eligibility proof. Returns `true` only when the pairing
    /// equation holds for the stored verification key and `signals`.
    ///
    /// Rejects identity (`0…0`) points: a key or proof of identities satisfies
    /// the pairing equation trivially and would accept any claim.
    pub fn verify_age_proof(
        env: Env,
        proof: Groth16Proof,
        signals: Vec<U256>,
    ) -> Result<bool, Error> {
        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::VerificationKey)
            .ok_or(Error::NotInitialized)?;

        // vk_x uses IC[0] plus one IC point per public signal.
        if signals.len() + 1 != vk.ic.len() {
            return Err(Error::MalformedSignals);
        }

        let mut vk_x = vk.ic.get(0).ok_or(Error::MalformedVerificationKey)?;
        for (i, signal) in signals.iter().enumerate() {
            let ic = vk
                .ic
                .get(i as u32 + 1)
                .ok_or(Error::MalformedVerificationKey)?;
            vk_x = vk_x + ic * Bn254Fr::from_u256(signal);
        }

        let alpha = Bn254G1Affine::from_bytes(vk.alpha);
        let a = Bn254G1Affine::from_bytes(proof.a);
        let c = Bn254G1Affine::from_bytes(proof.c);
        let vk_x = Bn254G1Affine::from_bytes(vk_x);

        if is_identity(&a) || is_identity(&c) || is_identity(&alpha) || is_identity(&vk_x) {
            return Err(Error::IdentityPoint);
        }

        let mut g1s = Vec::new(&env);
        let mut g2s = Vec::new(&env);
        g1s.push_back(-a);
        g2s.push_back(Bn254G2Affine::from_bytes(proof.b));
        g1s.push_back(-alpha);
        g2s.push_back(Bn254G2Affine::from_bytes(vk.beta));
        g1s.push_back(-vk_x);
        g2s.push_back(Bn254G2Affine::from_bytes(vk.gamma));
        g1s.push_back(-c);
        g2s.push_back(Bn254G2Affine::from_bytes(vk.delta));

        if env.crypto().bn254().pairing_check(g1s, g2s) {
            Ok(true)
        } else {
            Err(Error::ProofRejected)
        }
    }

    pub fn verification_key(env: Env) -> Result<VerificationKey, Error> {
        env.storage()
            .instance()
            .get(&DataKey::VerificationKey)
            .ok_or(Error::NotInitialized)
    }
}

fn is_identity(point: &Bn254G1Affine) -> bool {
    point.to_array().iter().all(|byte| *byte == 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, Env};

    fn g1(byte: u8) -> BytesN<G1_SIZE> {
        BytesN::from_array(&Env::default(), &[byte; 64])
    }

    fn g2(byte: u8) -> BytesN<G2_SIZE> {
        BytesN::from_array(&Env::default(), &[byte; 128])
    }

    fn key(env: &Env, ic_len: u32) -> VerificationKey {
        let mut ic = Vec::new(env);
        for i in 0..ic_len {
            ic.push_back(g1((i + 1) as u8));
        }
        VerificationKey {
            alpha: g1(7),
            beta: g2(8),
            gamma: g2(9),
            delta: g2(10),
            ic,
        }
    }

    fn setup(env: &Env, ic_len: u32) -> ZkVerifierClient<'_> {
        let admin = Address::generate(env);
        let contract = env.register(ZkVerifier, (admin, key(env, ic_len)));
        ZkVerifierClient::new(env, &contract)
    }

    fn proof(env: &Env) -> Groth16Proof {
        Groth16Proof {
            a: g1(1),
            b: g2(2),
            c: g1(3),
        }
    }

    #[test]
    fn rejects_wrong_number_of_public_signals() {
        let env = Env::default();
        let client = setup(&env, 3); // two public inputs
        assert_eq!(
            client.try_verify_age_proof(&proof(&env), &vec![&env, U256::from_u32(&env, 1)]),
            Err(Ok(Error::MalformedSignals))
        );
    }

    #[test]
    fn rejects_identity_points() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let mut vk = key(&env, 3);
        vk.alpha = BytesN::from_array(&env, &[0u8; 64]);
        let contract = env.register(ZkVerifier, (admin, vk));
        let client = ZkVerifierClient::new(&env, &contract);
        let signals = vec![&env, U256::from_u32(&env, 1), U256::from_u32(&env, 2)];
        assert_eq!(
            client.try_verify_age_proof(&proof(&env), &signals),
            Err(Ok(Error::IdentityPoint))
        );
    }

    #[test]
    #[should_panic]
    fn constructor_rejects_short_ic() {
        let env = Env::default();
        let admin = Address::generate(&env);
        env.register(ZkVerifier, (admin, key(&env, 1)));
    }

    #[test]
    fn rotates_verification_key_for_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let client = setup(&env, 3);
        client.update_verification_key(&key(&env, 4));
        assert_eq!(client.verification_key().ic.len(), 4);
    }

    #[test]
    fn stores_initial_verification_key() {
        let env = Env::default();
        let client = setup(&env, 3);
        assert_eq!(client.verification_key().ic.len(), 3);
    }
}
