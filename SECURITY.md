# Security Policy

## Reporting Security Issues

The Heliora team takes security vulnerabilities seriously. If you discover a vulnerability or security flaw in Heliora, please report it promptly.

### How to Report

Please **do not** open a public issue on GitHub for security vulnerabilities. Instead, report security issues directly to the maintainer via email:

- **Maintainer:** Aderonke Afolabi
- **Email:** [afolabiaderonke1995@gmail.com](mailto:afolabiaderonke1995@gmail.com)
- **Repository:** [https://github.com/CareConstellation/Heliora](https://github.com/CareConstellation/Heliora)

### Report Information

When reporting a vulnerability, please include as much detail as possible:

1. Type of issue (e.g. cross-site scripting, authentication bypass, data leak)
2. Detailed steps to reproduce the vulnerability
3. Any potential impact of the issue
4. Proof-of-concept code or screenshots if applicable

We will acknowledge receipt of your report within 48 hours and provide updates on resolution progress.

## Cryptographic Design & Threat Model

Heliora encrypts protected health information in the browser before it leaves the device. The full specification is in **[`docs/cryptography.md`](docs/cryptography.md)**. It covers every cipher suite (AES-256-GCM, ECDH P-256, ML-KEM-768 + X25519 hybrid KEM, Ed25519, ML-DSA, Poseidon, Groth16), key storage, a STRIDE threat model, and known gaps.

In short:

- **Encryption:** AES-256-GCM with per-file keys; streaming envelope for large files.
- **Key encapsulation:** ECDH P-256 + HKDF-SHA-256 + AES-KW, with an optional hybrid **ML-KEM-768 + X25519** (NIST SP 800-227) for post-quantum protection.
- **Signatures:** Ed25519 (Stellar wallets, SEP-10, SEP-53). ML-DSA is **not yet implemented**; see the warning below.
- **Zero-knowledge:** Groth16 over BN254 with Poseidon commitments.

> ⚠️ **Do not set `NEXT_PUBLIC_PQC_ENABLED=true` in production.** The ML-DSA signature functions behind that flag are placeholders (see [`docs/cryptography.md` §11](docs/cryptography.md#11-known-gaps-and-roadmap)).

When reporting a cryptographic issue, please reference the relevant section and threat ID (e.g. `T-5`) from the specification.
