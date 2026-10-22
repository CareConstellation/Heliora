import {
  FreighterAdapter,
  AlbedoAdapter,
  XbullAdapter,
  LOBSTRAdapter,
  WalletConnectAdapter,
  type WalletAdapter,
  type WalletType,
  type WalletAdapterOptions,
} from './adapters';

export class WalletManager {
  private adapters: Map<WalletType, WalletAdapter>;
  private currentAdapter: WalletAdapter | null = null;
  private publicKey: string | null = null;
  private options: WalletAdapterOptions;

  constructor(options: WalletAdapterOptions = {}) {
    this.options = options;
    this.adapters = new Map([
      ['freighter', new FreighterAdapter()],
      ['albedo', new AlbedoAdapter()],
      ['xbull', new XbullAdapter()],
      ['lobstr', new LOBSTRAdapter()],
      ['walletconnect', new WalletConnectAdapter()],
    ]);
  }

  async getAvailableWallets(): Promise<Array<{ id: WalletType; name: string; icon: string }>> {
    const available: Array<{ id: WalletType; name: string; icon: string }> = [];

    for (const [id, adapter] of this.adapters) {
      if (await adapter.isAvailable()) {
        available.push({
          id: id as WalletType,
          name: adapter.name,
          icon: adapter.icon,
        });
      }
    }

    return available;
  }

  async connect(walletType: WalletType): Promise<{ publicKey: string; adapter: WalletAdapter }> {
    const adapter = this.adapters.get(walletType);
    if (!adapter) {
      throw new Error(`Wallet type "${walletType}" not found`);
    }

    try {
      const { publicKey } = await adapter.connect();
      this.currentAdapter = adapter;
      this.publicKey = publicKey;
      return { publicKey, adapter };
    } catch (error) {
      throw new Error(
        `Failed to connect ${walletType}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async signTransaction(xdr: string): Promise<string> {
    if (!this.currentAdapter) {
      throw new Error('No wallet connected');
    }
    return this.currentAdapter.signTransaction(xdr);
  }

  async signAuthEntry(base64: string): Promise<string> {
    if (!this.currentAdapter) {
      throw new Error('No wallet connected');
    }
    return this.currentAdapter.signAuthEntry(base64);
  }

  async disconnect(): Promise<void> {
    if (this.currentAdapter) {
      await this.currentAdapter.disconnect();
      this.currentAdapter = null;
      this.publicKey = null;
    }
  }

  getConnectedPublicKey(): string | null {
    return this.publicKey;
  }

  isConnected(): boolean {
    return this.currentAdapter !== null && this.publicKey !== null;
  }

  getCurrentAdapter(): WalletAdapter | null {
    return this.currentAdapter;
  }
}

// Singleton instance
let walletManager: WalletManager | null = null;

export function getWalletManager(options?: WalletAdapterOptions): WalletManager {
  if (!walletManager) {
    walletManager = new WalletManager(options);
  }
  return walletManager;
}
