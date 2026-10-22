# Wallet Adapters

This document describes the modular wallet adapter system that supports multiple Stellar wallets and protocols.

## Supported Wallets

- **Freighter** - Browser extension for Stellar
- **Albedo** - Web-based Stellar wallet
- **xBull** - Browser extension Stellar wallet
- **LOBSTR** - Browser extension and web wallet
- **WalletConnect v2** - Mobile and cross-platform wallet connections via QR code

## Architecture

The wallet system uses a modular adapter pattern where each wallet implements the `WalletAdapter` interface:

```typescript
interface WalletAdapter {
  id: string;
  name: string;
  icon: string;
  isAvailable(): Promise<boolean>;
  connect(): Promise<{ publicKey: string }>;
  signTransaction(xdr: string): Promise<string>;
  signAuthEntry(base64: string): Promise<string>;
  disconnect(): Promise<void>;
}
```

## Usage

### React Hook

Use the `useWalletManager` hook in your components:

```typescript
import { useWalletManager } from '@/hooks/useWalletManager';

export function MyWalletComponent() {
  const {
    publicKey,
    isConnected,
    isLoading,
    error,
    availableWallets,
    connect,
    disconnect,
    signTransaction,
  } = useWalletManager();

  const handleConnect = async () => {
    const key = await connect('freighter');
    if (key) {
      console.log('Connected:', key);
    }
  };

  return (
    <div>
      {isConnected ? (
        <div>
          <p>Connected: {publicKey}</p>
          <button onClick={disconnect}>Disconnect</button>
        </div>
      ) : (
        <button onClick={handleConnect} disabled={isLoading}>
          {isLoading ? 'Connecting...' : 'Connect Wallet'}
        </button>
      )}
    </div>
  );
}
```

### Direct Manager Usage

```typescript
import { getWalletManager } from '@/lib/wallet';

const manager = getWalletManager();
const wallets = await manager.getAvailableWallets();
const { publicKey } = await manager.connect('albedo');
const signedXdr = await manager.signTransaction(xdr);
await manager.disconnect();
```

## Wallet-Specific Notes

### Freighter
- Requires browser extension from https://freighter.app
- Validates network matches wallet configuration
- Supports both testnet and mainnet

### Albedo
- Web-based wallet accessible from https://albedo.link
- No installation required
- Works across browsers

### xBull
- Browser extension wallet
- Supports Stellar-to-X bridge transactions
- Available from xbull.app

### LOBSTR
- Available as both browser extension and web wallet
- Supports multiple networks
- Visit https://lobstr.co for more info

### WalletConnect v2
- Enables mobile wallet connections via QR code
- Supports Stellar-compatible wallets on mobile
- Automatic QR display and user approval flow

## Integration with Account Auto-Funding

The `ConnectWalletModal` component supports automatic testnet funding via `FriendbotFaucet`:

```typescript
<ConnectWalletModal 
  onClose={handleClose}
  autoFundTestnet={true}  // Automatically fund new accounts on testnet
/>
```

When enabled, the system will:
1. Connect to the selected wallet
2. Check account balance via Horizon API
3. If balance < 2 XLM, request testnet funds from Friendbot
4. Complete the connection flow

## Error Handling

All adapters throw descriptive errors:

```typescript
try {
  await connect('freighter');
} catch (error) {
  if (error.message.includes('rejected')) {
    // User cancelled
  } else if (error.message.includes('not found')) {
    // Wallet not installed
  } else {
    // Other error
  }
}
```

## Adding a New Wallet

To add a new wallet adapter:

1. Create a new file in `src/lib/wallet/adapters/`
2. Implement the `WalletAdapter` interface
3. Add the adapter to `WalletManager` in the constructor
4. Update the `WalletType` union type
5. Export from `adapters/index.ts`

Example:

```typescript
export class CustomWalletAdapter implements WalletAdapter {
  id = 'custom';
  name = 'Custom Wallet';
  icon = '🔐';

  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && !!window.customWallet;
  }

  async connect(): Promise<{ publicKey: string }> {
    const pubkey = await window.customWallet.getPublicKey();
    return { publicKey: pubkey };
  }

  async signTransaction(xdr: string): Promise<string> {
    return window.customWallet.signTransaction(xdr);
  }

  async signAuthEntry(base64: string): Promise<string> {
    return window.customWallet.signMessage(base64);
  }

  async disconnect(): Promise<void> {
    // Implementation
  }
}
```
