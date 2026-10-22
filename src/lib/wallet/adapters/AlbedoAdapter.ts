import type { WalletAdapter } from './types';

declare global {
  interface Window {
    albedo?: {
      publicKey(opts: { token?: string }): Promise<{ pubkey: string }>;
      tx(opts: { xdr: string; description?: string }): Promise<{ signedXDR: string }>;
      signMessage(opts: { message: string; description?: string }): Promise<{ signature: string }>;
    };
  }
}

export class AlbedoAdapter implements WalletAdapter {
  id = 'albedo';
  name = 'Albedo';
  icon = '🌐';

  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && !!window.albedo;
  }

  async connect(): Promise<{ publicKey: string }> {
    if (!window.albedo) {
      throw new Error('Albedo wallet not found. Please visit albedo.link');
    }
    const result = await window.albedo.publicKey({});
    return { publicKey: result.pubkey };
  }

  async signTransaction(xdr: string): Promise<string> {
    if (!window.albedo) {
      throw new Error('Albedo wallet not found');
    }
    const result = await window.albedo.tx({
      xdr,
      description: 'Sign transaction with Albedo',
    });
    return result.signedXDR;
  }

  async signAuthEntry(base64: string): Promise<string> {
    if (!window.albedo) {
      throw new Error('Albedo wallet not found');
    }
    const result = await window.albedo.signMessage({
      message: base64,
      description: 'Sign authentication entry',
    });
    return result.signature;
  }

  async disconnect(): Promise<void> {
    // Albedo doesn't expose disconnect, handle client-side
  }
}
