import type { WalletAdapter } from './types';

interface WalletConnectSession {
  topic: string;
  pairingTopic?: string;
  peer?: {
    metadata?: {
      name?: string;
      url?: string;
      icons?: string[];
    };
  };
  accounts: string[];
  chainId: string;
  relay?: { protocol: string };
  expiry?: number;
}

interface WalletConnectClient {
  connect(opts: {
    requiredNamespaces: Record<string, unknown>;
  }): Promise<{ uri: string; approval: () => Promise<WalletConnectSession> }>;
  request(opts: {
    topic: string;
    chainId: string;
    request: {
      method: string;
      params: unknown[];
    };
  }): Promise<unknown>;
  disconnect(opts: { topic: string; reason?: string }): Promise<void>;
  session: WalletConnectSession | null;
}

export class WalletConnectAdapter implements WalletAdapter {
  id = 'walletconnect';
  name = 'WalletConnect';
  icon = '📱';
  private client: WalletConnectClient | null = null;
  private session: WalletConnectSession | null = null;
  private qrModalUnsubscribe: (() => void) | null = null;

  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined';
  }

  async initializeClient(): Promise<WalletConnectClient> {
    if (this.client) return this.client;

    try {
      // Dynamically import WalletConnect v2
      const { Web3Modal } = await import('@web3modal/standalone');
      const { EthereumClient, w3mConnectors, w3mProvider } = await import(
        '@web3modal/ethereum'
      );

      // For Stellar, we'll use a WalletConnect-compatible provider
      // In production, consider using @walletconnect/sign-client directly
      throw new Error(
        'WalletConnect for Stellar requires custom integration. Use Stellar-compatible relay server.',
      );
    } catch (error) {
      throw new Error(
        `Failed to initialize WalletConnect: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async connect(): Promise<{ publicKey: string }> {
    try {
      const client = await this.initializeClient();

      // Request connection with QR modal
      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          stellar: {
            methods: ['stellar_signTransaction', 'stellar_signMessage'],
            chains: ['stellar:public'],
            events: [],
          },
        },
      });

      if (!uri) {
        throw new Error('Failed to generate WalletConnect URI');
      }

      // Show QR code (implementation depends on your UI framework)
      this.displayQRCode(uri);

      // Wait for approval
      this.session = await approval();
      this.client = client;

      if (!this.session.accounts.length) {
        throw new Error('No accounts returned from wallet');
      }

      // Extract public key from account (format: stellar:public:GXXXXXX)
      const account = this.session.accounts[0];
      const publicKey = account.split(':').pop() || '';

      return { publicKey };
    } catch (error) {
      throw new Error(
        `WalletConnect connection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async signTransaction(xdr: string): Promise<string> {
    if (!this.client || !this.session) {
      throw new Error('WalletConnect not connected');
    }

    try {
      const response = await this.client.request({
        topic: this.session.topic,
        chainId: this.session.chainId,
        request: {
          method: 'stellar_signTransaction',
          params: [xdr],
        },
      });

      return response as string;
    } catch (error) {
      throw new Error(
        `Failed to sign transaction: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async signAuthEntry(base64: string): Promise<string> {
    if (!this.client || !this.session) {
      throw new Error('WalletConnect not connected');
    }

    try {
      const response = await this.client.request({
        topic: this.session.topic,
        chainId: this.session.chainId,
        request: {
          method: 'stellar_signMessage',
          params: [base64],
        },
      });

      return response as string;
    } catch (error) {
      throw new Error(
        `Failed to sign message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.session) {
      await this.client.disconnect({
        topic: this.session.topic,
        reason: 'User disconnected',
      });
    }
    this.session = null;
    if (this.qrModalUnsubscribe) {
      this.qrModalUnsubscribe();
      this.qrModalUnsubscribe = null;
    }
  }

  private displayQRCode(uri: string): void {
    // Implementation for displaying QR code
    // This would typically integrate with a QR code display component
    const event = new CustomEvent('walletconnect-qr', { detail: { uri } });
    window.dispatchEvent(event);
  }
}
