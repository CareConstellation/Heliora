# State Management (Zustand Stores)

The app uses [Zustand](https://github.com/pmndrs/zustand) for global client state. There are two stores, both wrapped in the `persist` middleware which mirrors state to `localStorage`.

## `useAuthStore` (`src/store/authStore.ts`)

Tracks the authenticated user's wallet/role and loading status during auth checks.

| Field | Type | Description |
|---|---|---|
| `walletAddress` | `string \| null` | Connected wallet's public address. |
| `role` | `UserRole \| null` | Authenticated user's role (patient/doctor/hospital, etc.). |
| `isLoading` | `boolean` | True while an auth check is in flight. Not persisted. |

Actions: `setWalletAddress`, `setRole`, `setIsLoading`, `clearAuth` (resets all fields).

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

## Notes

- Both stores persist to `localStorage`, so state survives page reloads but is device/browser-specific.
- `useAuthStore` and `useWalletStore` overlap on `role` — they are updated independently and are not automatically kept in sync with each other.
