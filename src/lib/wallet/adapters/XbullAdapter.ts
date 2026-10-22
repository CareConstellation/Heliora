import type { WalletAdapter } from './types';

declare global {
  interface Window {
    xBull?: {
      publicKey?: {
        request(): Promise<{ publicKey: string }>;
      };
      signTransaction: {
        request(opts: { transaction: string; publicKey: string }): Promise<{ signedTransaction: string }>;
      };
      signMessage: {
        request(opts: { message: string; publicKey: string }): Promise<{ signedMessage: string }>;
      };
    };
  }
}

export class XbullAdapter implements WalletAdapter {
  id = 'xbull';
  name = 'xBull';
  icon = '💧';
  private publicKey: string | null = null;

  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && !!window.xBull;
  }

  async connect(): Promise<{ publicKey: string }> {
    if (!window.xBull?.publicKey) {
      throw new Error('xBull wallet not found. Please install the xBull browser extension');
    }
    const result = await window.xBull.publicKey.request();
    this.publicKey = result.publicKey;
    return { publicKey: result.publicKey };
  }

  async signTransaction(xdr: string): Promise<string> {
    if (!window.xBull?.signTransaction || !this.publicKey) {
      throw new Error('xBull wallet not found or not connected');
    }
    const result = await window.xBull.signTransaction.request({
      transaction: xdr,
      publicKey: this.publicKey,
    });
    return result.signedTransaction;
  }

  async signAuthEntry(base64: string): Promise<string> {
    if (!window.xBull?.signMessage || !this.publicKey) {
      throw new Error('xBull wallet not found or not connected');
    }
    const result = await window.xBull.signMessage.request({
      message: base64,
      publicKey: this.publicKey,
    });
    return result.signedMessage;
  }

  async disconnect(): Promise<void> {
    this.publicKey = null;
  }
}
