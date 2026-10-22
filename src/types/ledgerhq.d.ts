declare module '@ledgerhq/hw-app-str' {
  export interface LedgerStrTransport {
    close(): Promise<void>;
  }

  export default class Str {
    constructor(transport: LedgerStrTransport);
    getPublicKey(path: string, display?: boolean): Promise<{ publicKey: string }>;
    signTransaction(
      path: string,
      transaction: string,
      options?: { ed25519?: boolean },
    ): Promise<{ signature: string }>;
  }
}
