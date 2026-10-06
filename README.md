# Heliora

Tagline: Instant verification, infinite traceability.

Heliora is an innovative decentralized healthcare management platform built on the Stellar blockchain, designed to address the challenges faced by the medical industry today. With fragmented patient records, inefficient verification processes, and security risks, Heliora provides a comprehensive solution for secure, efficient, and transparent healthcare management. By leveraging blockchain technology, Heliora ensures that medical records are immutable, easily accessible, and verifiable in real time, enhancing the overall healthcare experience for medical institutions, professionals, and patients.

## Objectives

- **Secure Registration and Verification**: Allow medical entities and professionals to securely register their credentials on a tamper-proof blockchain ledger, ensuring their certifications are verifiable and immutable.
- **Decentralized and Secure Medical Records Management**: Enable patients to store, manage, and share their medical history securely, with encrypted access protected by blockchain.
- **Efficient Appointment Scheduling and Payment System**: Provide a user-friendly platform for booking appointments (both in-person and telemedicine) and processing payments via cryptocurrency (Stellar) or traditional methods.
- **Integration with Insurance and Emergency Services**: Simplify insurance verification and claims with smart contracts and enable ambulance requests and home medical checkups directly through the platform.

## Features

- **Enhanced Security**: Patient data is stored securely on the Stellar blockchain, preventing unauthorized modifications and ensuring data integrity.
- **Seamless Appointment Scheduling**: Patients can easily book in-person and online consultations with doctors, reducing friction in the process.
- **Flexible Payment Methods**: Payments for medical services can be made through cryptocurrency (Stellar) or traditional methods, providing options for users across different regions.
- **Interoperability**: Patients' medical histories, test results, and other vital information can be shared securely between different healthcare providers.
- **Decentralized Data Management**: Blockchain ensures that medical records are not stored on a centralized server, minimizing the risk of data breaches or unauthorized access.
- **Smart Contract Integration**: Streamlined insurance claims, emergency service requests, and medical verification processes are automated through smart contracts.

## Target Users

- **Medical Professionals**: Doctors and medical staff who want an efficient way to manage their profiles, receive payments, and maintain accurate patient records.
- **Patients**: Individuals seeking a secure, transparent way to store, access, and share their medical history with various healthcare providers.
- **Insurance Providers**: Companies offering health coverage that want to integrate blockchain-based verification into their policies.

## Prerequisites

Before you begin, ensure you have installed:
- Node.js (version 18.x or higher recommended)
- npm (comes with Node.js)

## Getting Started

To get a local copy up and running, follow these steps:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/CareConstellation/Heliora.git
   cd Heliora
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local` and fill in the required values (see [Environment Variables](#environment-variables) below).

4. **Run the development server:**
   ```bash
   npm run dev
   ```

   Your application will be available at `http://localhost:3000`.

## Environment Variables

Copy `.env.example` to `.env.local` before running the app. Each variable is described below.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | **Yes** | — | Backend REST API base URL. |
| `NEXT_PUBLIC_STELLAR_NETWORK` | No | `testnet` | Stellar network to connect to. Accepted values: `testnet` \| `mainnet`. |
| `NEXT_PUBLIC_HORIZON_URL` | No | `https://horizon-testnet.stellar.org` | Horizon API endpoint used to submit transactions and query the ledger. |

### How to obtain each value

- `NEXT_PUBLIC_API_URL` — Contact the backend team. For local development the backend defaults to `http://localhost:3000/api/v1`.
- `NEXT_PUBLIC_STELLAR_NETWORK` — Use `testnet` for development and staging. Use `mainnet` only for production deployments.
- `NEXT_PUBLIC_HORIZON_URL` — Provided by the [Stellar Foundation](https://developers.stellar.org/docs/data/horizon). Testnet: `https://horizon-testnet.stellar.org`. Mainnet: `https://horizon.stellar.org`. You may also run a self-hosted Horizon instance.

### Secrets that must NOT be committed

The following files are already listed in `.gitignore` and must never be committed to version control:
- `.env.local` — contains your real environment values
- `.env` — any plain `.env` file
- `*.pem` — private key files

If you accidentally commit a secret, rotate it immediately and rewrite git history.

## API Documentation

Full API reference documenting all endpoints, request/response shapes, and authentication is available at:

📄 [`docs/api.md`](./docs/api.md)

### Quick Overview

| Endpoint Group | Base Path | Auth |
| --- | --- | --- |
| Medical Records | `/records` | Public key |
| Doctors & Slots | `/doctors` | Public key |
| Appointments | `/appointments` | Public key |
| Hospital Management | `/hospital` | Role: HOSPITAL |
| Users | `/users` | Public key |

## Switching to Mainnet

To point the frontend at the Stellar mainnet, update these variables in `.env.local`:

```env
NEXT_PUBLIC_STELLAR_NETWORK=mainnet
NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_API_URL=https://api.heliora.io/v1
```

**Security implications:**
- Mainnet transactions use **real XLM**. Mistakes cannot be reversed.
- Ensure the backend API URL also points to the production environment.
- Never expose private keys or mnemonics in environment variables or source code.
- Review all smart contract interactions before deploying to mainnet.
- Use a secrets manager (e.g., Vercel Environment Variables, AWS Secrets Manager) to inject production values — do not store them in any committed file.

## Maintainer & Contact

- **Maintainer:** Aderonke Afolabi
- **Email:** [afolabiaderonke1995@gmail.com](mailto:afolabiaderonke1995@gmail.com)
- **Repository:** [https://github.com/CareConstellation/Heliora](https://github.com/CareConstellation/Heliora)

## License

This project is licensed under the MIT License - see the [License](License) file for details.
