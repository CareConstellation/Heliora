export interface WalletAdapter {
  id: string;
  name: string;
  icon: string;
  isAvailable(): Promise<boolean>;
  connect(): Promise<{ publicKey: string }>;
  signTransaction(xdr: string): Promise<string>;
  signAuthEntry(base64: string): Promise<string>;
  disconnect(): Promise<void>;
}

export interface WalletAdapterOptions {
  timeout?: number;
  network?: string;
}

export type WalletType = 'freighter' | 'albedo' | 'xbull' | 'lobstr' | 'walletconnect';
