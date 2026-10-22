# Frontend Architecture & API Integration Guide

> **Audience:** New frontend contributors who are familiar with React but new to Stellar/blockchain development.

---

## Table of Contents

1. [Tech Stack Overview](#tech-stack-overview)
2. [Folder Structure](#folder-structure)
3. [State Management](#state-management)
4. [API Service Layer](#api-service-layer)
5. [Stellar Integration](#stellar-integration)
   - [Wallet-Signed Security Features](#wallet-signed-security-features)
6. [Role-Based Routing](#role-based-routing)
7. [Adding a New Page](#adding-a-new-page)
8. [Data-Flow Diagram](#data-flow-diagram)

---

## Tech Stack Overview

| Technology                               | Purpose                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| **Next.js 14 (App Router)**              | React framework — file-based routing, server components, layouts        |
| **TypeScript**                           | Static typing across the entire codebase                                |
| **Zustand**                              | Lightweight client-side state (wallet connection, user role)            |
| **TanStack Query v5**                    | Server-state management — fetching, caching, and synchronising API data |
| **Stellar SDK (`@stellar/stellar-sdk`)** | Building, signing, and submitting Stellar transactions                  |
| **`@soroban-react/core`**                | Soroban smart-contract integration helpers                              |
| **Axios**                                | HTTP client used inside the API service layer                           |
| **shadcn-ui + Tailwind CSS**             | UI component library and utility-first styling                          |
| **Lucide React**                         | Icon set                                                                |

---

## Folder Structure

```
src/
├── app/                    # Next.js App Router pages and layouts
│   ├── layout.tsx          # Root layout — wraps every page with Providers + Navbar
│   ├── page.tsx            # Public landing page
│   ├── login/              # Wallet connection entry point
│   ├── appointments/       # Patient appointment booking flow
│   ├── dashboard/
│   │   ├── patient/        # Patient medical records dashboard
│   │   ├── doctor/         # Doctor appointments dashboard
│   │   ├── hospital/       # Hospital management dashboard
│   │   └── admin/          # Admin platform dashboard
│   └── role-not-registered/ # Shown when a connected wallet has no assigned role
│
├── components/             # Reusable UI components, grouped by domain
│   ├── appointments/       # DoctorSearch, SlotPicker, BookingConfirmation, UpcomingAppointments
│   ├── auth/               # ProtectedRoute — guards pages by role
│   ├── doctor/             # AppointmentCard, NewRecordForm
│   ├── navigation/         # Header
│   ├── records/            # RecordCard, RecordDetailDrawer, RecordSkeleton
│   └── wallet/             # ConnectWalletModal, Navbar
│
├── context/
│   └── Providers.tsx       # Mounts QueryClientProvider (and any future context providers)
│
├── hooks/
│   └── useRoleRedirect.ts  # Redirects authenticated users to their role dashboard
│
├── lib/
│   └── stellar.ts          # Stellar network config (network name, Horizon URL, passphrase)
│
├── services/
│   └── api.service.ts      # All REST API calls — single Axios instance, typed responses
│
├── store/
│   ├── authStore.ts        # Zustand store — wallet address + role (persisted)
│   └── useWalletStore.ts   # Zustand store — public key, role, network (persisted)
│
└── types/
    └── index.ts            # Shared TypeScript types and interfaces
```

---

## State Management

The app uses three distinct layers of state. Choosing the right layer for new state is important for consistency.

### Zustand — Client / Session State

Zustand stores hold state that belongs to the current browser session and does not come from the server.

| Store            | What it holds                                                       |
| ---------------- | ------------------------------------------------------------------- |
| `useWalletStore` | `publicKey`, `role`, `network` — set after wallet connection        |
| `useAuthStore`   | `walletAddress`, `role`, `isLoading` — alternative auth state slice |

Both stores use the `persist` middleware so the session survives a page refresh (stored in `localStorage`).

```ts
// Reading wallet state anywhere in the app
import { useWalletStore } from '@/store/useWalletStore';

const { publicKey, role, disconnect } = useWalletStore();
```

### TanStack Query — Server / Remote State

All data fetched from the backend API is managed by TanStack Query. It handles caching, background refetching, loading states, and error states automatically.

```ts
import { useQuery } from '@tanstack/react-query';
import { fetchRecords } from '@/services/api.service';

const { data, isLoading, isError } = useQuery({
  queryKey: ['records', publicKey], // cache key — include all variables the query depends on
  queryFn: () => fetchRecords(publicKey!),
  enabled: !!publicKey, // only run when publicKey is available
});
```

Use `useMutation` for write operations (POST, PATCH, DELETE):

```ts
import { useMutation } from '@tanstack/react-query';
import { createAppointment } from '@/services/api.service';

const mutation = useMutation({
  mutationFn: createAppointment,
  onSuccess: (data) => {
    /* handle success */
  },
});
```

### Local Component State

Use `useState` for ephemeral UI state that does not need to be shared — form field values, modal open/close, multi-step wizard progress, etc.

---

## API Service Layer

All HTTP calls go through a single Axios instance defined in `src/services/api.service.ts`. This keeps the base URL and default headers in one place.

### How the instance is configured

```ts
// src/services/api.service.ts
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL, // set in .env.local
  headers: { 'Content-Type': 'application/json' },
});
```

### Auth header pattern

When the backend requires an authenticated request, attach the wallet's public key (or a JWT if the backend issues one) via an Axios request interceptor. Add the interceptor in `api.service.ts`:

```ts
import { useWalletStore } from '@/store/useWalletStore';

api.interceptors.request.use((config) => {
  const { publicKey } = useWalletStore.getState(); // read store outside React
  if (publicKey) {
    config.headers['X-Wallet-Address'] = publicKey;
  }
  return config;
});
```

### Adding a new API call

1. Define the response type in `src/types/index.ts` if it does not already exist.
2. Add a typed function to `src/services/api.service.ts`:

```ts
// Example: fetch a single medical record by ID
export const fetchRecord = (id: string) =>
  api.get<MedicalRecord>(`/records/${id}`).then((r) => r.data);
```

3. Use it in a component via `useQuery` or `useMutation` (see [State Management](#state-management) above).

---

## Stellar Integration

### How wallet connection works

1. The user clicks **Connect Wallet** in the `Navbar`.
2. `ConnectWalletModal` opens and the user selects **Freighter** or **Albedo**.
3. The modal calls the browser extension API to get the user's `publicKey`.
4. It then calls `GET /users/:publicKey/role` on the backend to retrieve the user's assigned role.
5. `useWalletStore.setWallet(publicKey, role)` is called, persisting the session.
6. The user is redirected to their role-specific dashboard via `useRoleRedirect`.

### Network configuration

Network settings live in `src/lib/stellar.ts` and are driven by environment variables:

```ts
// src/lib/stellar.ts
export const STELLAR_CONFIG = {
  network: process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet',
  horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org',
  passphrase: Networks.TESTNET,
};
```

Set `NEXT_PUBLIC_STELLAR_NETWORK=mainnet` and update `NEXT_PUBLIC_HORIZON_URL` to `https://horizon.stellar.org` for production. **Never commit mainnet credentials.**

### Building and signing a transaction

The appointment booking flow (`src/app/appointments/page.tsx`) demonstrates the full transaction lifecycle:

```ts
import { TransactionBuilder, Networks, Operation, Asset } from '@stellar/stellar-sdk';
import { STELLAR_CONFIG } from '@/lib/stellar';

// 1. Load the sender's account sequence number from Horizon
const server = new Horizon.Server(STELLAR_CONFIG.horizonUrl);
const account = await server.loadAccount(publicKey);

// 2. Build the transaction
const tx = new TransactionBuilder(account, {
  fee: '100',
  networkPassphrase: STELLAR_CONFIG.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET,
})
  .addOperation(
    Operation.payment({
      destination: doctorAddress,
      asset: Asset.native(), // XLM
      amount: '10',
    }),
  )
  .setTimeout(30)
  .build();

// 3. Sign with Freighter (browser extension)
const signedXdr = await window.freighter.signTransaction(tx.toXDR(), {
  networkPassphrase: STELLAR_CONFIG.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET,
});

// 4. Submit to the network
await server.submitTransaction(TransactionBuilder.fromXDR(signedXdr /* passphrase */));
```

### Testnet vs. Mainnet

|                               | Testnet                                                                            | Mainnet                       |
| ----------------------------- | ---------------------------------------------------------------------------------- | ----------------------------- |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet`                                                                          | `mainnet`                     |
| `NEXT_PUBLIC_HORIZON_URL`     | `https://horizon-testnet.stellar.org`                                              | `https://horizon.stellar.org` |
| Network passphrase            | `Networks.TESTNET`                                                                 | `Networks.PUBLIC`             |
| XLM                           | Free via [Friendbot](https://laboratory.stellar.org/#account-creator?network=test) | Real value                    |

### Wallet-Signed Security Features

Several features prove intent with a [SEP-53](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md) message signature instead of a transaction: `freighterMessageSigner` signs and `verifySignedMessage` checks (`src/lib/stellar.ts`). Every signed message starts with a versioned domain line such as `heliora-anti-phishing-enrollment:v1`, so a signature for one purpose cannot be replayed for another.

| Feature                              | Code                                                                                        | What is signed / stored                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anti-phishing shield (#119)          | `lib/antiPhishing.ts`, `components/auth/AntiPhishingShield.tsx`                             | Secret icon + phrase in an encrypted local slot; the wallet signs the shield fingerprint at enrollment; the server returns an attestation signed by `NEXT_PUBLIC_AUTH_SIGNING_KEY`. |
| Official domain banner (#119)        | `components/auth/OfficialDomainBanner.tsx`                                                  | Compares `window.location` with `NEXT_PUBLIC_OFFICIAL_DOMAINS` (exact hostname, HTTPS).                                                                                             |
| Delegated resident proxy mode (#118) | `lib/delegatedProxy.ts`, `store/proxyStore.ts`, `components/doctor/ResidentSupervision.tsx` | The attending's wallet co-signs the SHA-256 hash of the approved draft; the backend logs it.                                                                                        |
| Trusted contacts (#116)              | `lib/addressBook.ts`, `hooks/useAddressBook.ts`, `components/contacts/`                     | Contacts in an encrypted local slot; the cloud backup key is derived (HKDF) from the wallet's deterministic Ed25519 signature of a fixed message.                                   |
| Account merge (#117)                 | `lib/stellar.ts` (merge helpers), `app/dashboard/patient/merge/`                            | One atomic transaction pays out assets, removes trustlines and data entries, then `AccountMerge`s, only after the record pointers are confirmed on the new account.                 |

`src/lib/encryptedLocalStore.ts` provides the encrypted local slots: AES-256-GCM with a non-extractable key in IndexedDB, bound to `namespace:owner` through the GCM additional data.

---

## Role-Based Routing

### UserRole type

```ts
// src/types/index.ts
export type UserRole = 'PATIENT' | 'DOCTOR' | 'HOSPITAL' | 'ADMIN';
```

### Role → dashboard mapping

```ts
// src/hooks/useRoleRedirect.ts
export const ROLE_DASHBOARD_MAP: Record<UserRole, string> = {
  PATIENT: '/dashboard/patient',
  DOCTOR: '/dashboard/doctor',
  HOSPITAL: '/dashboard/hospital',
  ADMIN: '/dashboard/admin',
};
```

After a successful wallet connection, `useRoleRedirect(walletAddress, role)` is called. It redirects the user to their dashboard, or to `/role-not-registered` if no role is assigned.

### Protecting a page

Wrap the page content in `ProtectedRoute` and pass the required role:

```tsx
import ProtectedRoute from '@/components/auth/ProtectedRoute';

export default function MyPage() {
  return <ProtectedRoute requiredRole="PATIENT">{/* page content */}</ProtectedRoute>;
}
```

`ProtectedRoute` redirects to `/login` if the wallet is not connected, or to `/` if the connected wallet's role does not match `requiredRole`.

---

## Adding a New Page

Follow these steps to add a new page end-to-end.

### 1. Create the route file

Next.js App Router uses the filesystem as the router. Create a `page.tsx` inside the appropriate directory under `src/app/`:

```
src/app/dashboard/patient/records/page.tsx
```

### 2. Add the `'use client'` directive if needed

Add `'use client'` at the top of the file if the page uses hooks, browser APIs, or interactive state. Omit it for purely static/server-rendered pages.

### 3. Protect the route

```tsx
'use client';

import ProtectedRoute from '@/components/auth/ProtectedRoute';

function PageContent() {
  return <div>Page content here</div>;
}

export default function MyNewPage() {
  return (
    <ProtectedRoute requiredRole="PATIENT">
      <PageContent />
    </ProtectedRoute>
  );
}
```

### 4. Add a type (if needed)

If the page fetches a new resource, add its type to `src/types/index.ts`:

```ts
export interface MyNewResource {
  id: string;
  name: string;
}
```

### 5. Add an API function

Add a typed function to `src/services/api.service.ts`:

```ts
export const fetchMyResource = (id: string) =>
  api.get<MyNewResource>(`/my-resource/${id}`).then((r) => r.data);
```

### 6. Wire up data fetching

Use `useQuery` inside the page component:

```tsx
import { useQuery } from '@tanstack/react-query';
import { fetchMyResource } from '@/services/api.service';
import { useWalletStore } from '@/store/useWalletStore';

function PageContent() {
  const { publicKey } = useWalletStore();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['my-resource', publicKey],
    queryFn: () => fetchMyResource(publicKey!),
    enabled: !!publicKey,
  });

  if (isLoading) return <p>Loading…</p>;
  if (isError) return <p>Something went wrong.</p>;

  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
```

### 7. Add navigation (optional)

Link to the new page from the `Navbar` or a dashboard sidebar by adding a `<Link href="/your/new/route">` element.

---

## Data-Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser / Client                         │
│                                                                 │
│  ┌──────────────┐    connect     ┌─────────────────────────┐   │
│  │   Freighter  │◄──────────────►│  ConnectWalletModal     │   │
│  │  (Extension) │   publicKey    │  useWalletStore (Zustand)│   │
│  └──────────────┘                └────────────┬────────────┘   │
│                                               │ publicKey+role  │
│                                               ▼                 │
│                                  ┌────────────────────────┐    │
│                                  │   ProtectedRoute /     │    │
│                                  │   useRoleRedirect      │    │
│                                  └────────────┬───────────┘    │
│                                               │                 │
│                                               ▼                 │
│                                  ┌────────────────────────┐    │
│                                  │   Page Component       │    │
│                                  │   (useQuery / useMutation)  │
│                                  └────────────┬───────────┘    │
│                                               │                 │
└───────────────────────────────────────────────┼─────────────────┘
                                                │ HTTP (Axios)
                                                ▼
                               ┌────────────────────────────┐
                               │   Backend REST API         │
                               │   NEXT_PUBLIC_API_URL      │
                               └────────────┬───────────────┘
                                            │ Stellar transaction XDR
                                            ▼
                               ┌────────────────────────────┐
                               │   Stellar Network          │
                               │   (Horizon API)            │
                               │   Testnet / Mainnet        │
                               └────────────────────────────┘
```

**Flow summary:**

1. **Wallet → Frontend:** The user connects via Freighter or Albedo. The public key and role are stored in Zustand (`useWalletStore`).
2. **Frontend → API:** React components use TanStack Query to call `src/services/api.service.ts`, which sends typed HTTP requests to the backend.
3. **Frontend → Stellar Network:** For payment operations, the frontend builds a transaction using the Stellar SDK, signs it via Freighter, and submits it directly to Horizon.
4. **API → Stellar Network:** The backend may also interact with the Stellar network independently (e.g., to verify transaction hashes or manage smart contracts).
