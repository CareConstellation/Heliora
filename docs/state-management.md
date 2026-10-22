# State Management (Zustand Stores)

The app uses [Zustand](https://github.com/pmndrs/zustand) for global client state. `useAuthStore` and `useWalletStore` are wrapped in the `persist` middleware, which mirrors state to `localStorage`. `useProxyStore` persists to `sessionStorage`, and `useAddressBookStore` is kept in memory only (its data is stored encrypted, see below).

## `useAuthStore` (`src/store/authStore.ts`)

Tracks the authenticated user's wallet/role and loading status during auth checks.

| Field | Type | Description |
|---|---|---|
| `walletAddress` | `string \| null` | Connected wallet's public address. |
| `role` | `UserRole \| null` | Authenticated user's role (patient/doctor/hospital, etc.). |
| `isLoading` | `boolean` | True while an auth check is in flight. Not persisted. |
| `shieldStatus` | `ShieldVerificationStatus \| null` | Result of the last anti-phishing shield check on the login page (#119). Not persisted, so it is re-checked on every login. |

Actions: `setWalletAddress`, `setRole`, `setIsLoading`, `setShieldStatus`, `clearAuth` (resets all fields).

**Persistence**: stored under the `heliora-auth` localStorage key. Uses `partialize` to persist only `walletAddress` and `role` — `isLoading` is always reset to `false` on reload.

**Consumers**: `src/context/Providers.tsx`, `src/app/dashboard/layout.tsx`, `src/app/role-not-registered/page.tsx`, `src/components/navigation/Header.tsx`.

## `useWalletStore` (`src/store/useWalletStore.ts`)

Tracks the connected Stellar wallet used for on-chain interactions.

| Field | Type | Description |
|---|---|---|
| `publicKey` | `string \| null` | Connected wallet's public key. |
| `role` | `UserRole \| null` | Role associated with the connected wallet. |
| `network` | `string` | Stellar network, from `NEXT_PUBLIC_STELLAR_NETWORK` env var (defaults to `testnet`). |

Actions: `setWallet(publicKey, role)`, `disconnect` (clears `publicKey` and `role`).

**Persistence**: stored under the `wallet-store` localStorage key. The entire state object is persisted (no `partialize`), including `network`.

**Consumers**: dashboard pages (`patient`, `doctor`, `hospital`), `appointments`, `login`, `ProtectedRoute`, `Navbar`, `ConnectWalletModal`, `NotificationBell`, `NewRecordForm`.

## `useProxyStore` (`src/store/proxyStore.ts`)

Delegated resident proxy session of a supervising physician (#118).

| Field | Type | Description |
|---|---|---|
| `activeToken` | `DelegatedProxyToken \| null` | Proxy token of the resident being supervised; `null` outside proxy mode. |
| `cosignatureLog` | `SupervisorCosignature[]` | Co-signatures made in this session, newest first. |

Actions: `enterProxyMode(token)` (refuses expired tokens), `exitProxyMode`, `logCosignature`.

**Persistence**: `sessionStorage` key `heliora-proxy-session`, so the session survives a reload but ends with the tab. An expired token is dropped on rehydration, and `useDelegatedProxy` leaves proxy mode when the token expires. Disconnecting the wallet also ends it.

**Consumers**: `ResidentSupervision`, `DelegatedProxyBanner` / `ExitProxyModeButton` (via `useDelegatedProxy`), `src/app/dashboard/layout.tsx`, `Header`.

## `useAddressBookStore` (`src/store/addressBookStore.ts`)

In-memory copy of the connected wallet's trusted clinician address book (#116).

| Field | Type | Description |
|---|---|---|
| `owner` | `string \| null` | Wallet whose book is loaded. |
| `book` | `AddressBook` | Contacts, including deletion tombstones. |
| `loaded` / `error` | `boolean` / `string \| null` | Load state of the encrypted local copy. |

Actions: `hydrate(owner)`, `commit(change)`, `discardStored`, `reset`. `commit` waits for the pending load and applies `change` to the current book, so a write can never overwrite contacts that are still being decrypted. Components use the `useContactResolver` / `useAddressBook` hooks rather than the store directly.

**Persistence**: not persisted by zustand. The book is stored AES-GCM encrypted in `localStorage` (`heliora-address-book:<owner>`) with a non-extractable key kept in IndexedDB (`src/lib/encryptedLocalStore.ts`), and optionally as an encrypted cloud backup.

## Notes

- `useAuthStore` and `useWalletStore` persist to `localStorage`, so state survives page reloads but is device/browser-specific.
- `useAuthStore` and `useWalletStore` overlap on `role` — they are updated independently and are not automatically kept in sync with each other.
