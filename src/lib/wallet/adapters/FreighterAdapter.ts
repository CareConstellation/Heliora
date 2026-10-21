import type { WalletAdapter } from './types';

declare global {
  interface Window {
    freighter?: {
      getPublicKey(): Promise<string>;
      getNetwork(): Promise<string>;
      signTransaction(xdr: string): Promise<string>;
      signAuthEntry(base64: string): Promise<string>;
      isConnected(): Promise<boolean>;
    };
  }
}

export class FreighterAdapter implements WalletAdapter {
  id = 'freighter';
  name = 'Freighter';
  icon = '🔑';

  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && !!window.freighter;
  }

  async connect(): Promise<{ publicKey: string }> {
    if (!window.freighter) {
      throw new Error('Freighter wallet not found. Please install the extension from freighter.app');
    }
    const publicKey = await window.freighter.getPublicKey();
    return { publicKey };
  }

  async signTransaction(xdr: string): Promise<string> {
    if (!window.freighter) {
      throw new Error('Freighter wallet not found');
    }
    return window.freighter.signTransaction(xdr);
  }

  async signAuthEntry(base64: string): Promise<string> {
    if (!window.freighter) {
      throw new Error('Freighter wallet not found');
    }
    return window.freighter.signAuthEntry(base64);
  }

  async disconnect(): Promise<void> {
    // Freighter doesn't expose disconnect, handle client-side
  }
}
