import type { WalletAdapter } from './types';

declare global {
  interface Window {
    lobstr?: {
      getPublicKey(): Promise<string>;
      signTransaction(xdr: string): Promise<string>;
      signMessage(message: string): Promise<string>;
      isConnected(): Promise<boolean>;
      disconnect(): Promise<void>;
    };
  }
}

export class LOBSTRAdapter implements WalletAdapter {
  id = 'lobstr';
  name = 'LOBSTR';
  icon = '🔐';

  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && !!window.lobstr;
  }

  async connect(): Promise<{ publicKey: string }> {
    if (!window.lobstr) {
      throw new Error('LOBSTR wallet not found. Please install from lobstr.co');
    }
    const publicKey = await window.lobstr.getPublicKey();
    return { publicKey };
  }

  async signTransaction(xdr: string): Promise<string> {
    if (!window.lobstr) {
      throw new Error('LOBSTR wallet not found');
    }
    return window.lobstr.signTransaction(xdr);
  }

  async signAuthEntry(base64: string): Promise<string> {
    if (!window.lobstr) {
      throw new Error('LOBSTR wallet not found');
    }
    return window.lobstr.signMessage(base64);
  }

  async disconnect(): Promise<void> {
    if (window.lobstr?.disconnect) {
      await window.lobstr.disconnect();
    }
  }
}
