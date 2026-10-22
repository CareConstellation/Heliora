export interface LedgerTransportError extends Error {
  statusCode?: number;
}

export interface LedgerAccount {
  publicKey: string;
  path: string;
}

export interface LedgerSignResult {
  publicKey: string;
  signature: string;
}

const BIP44_STELLAR_PATH = "m/44'/148'/0'"; // Standard BIP-44 path for Stellar

export const ledgerHardwareWallet = {
  async checkWebUSBSupport(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    return 'usb' in navigator || 'hid' in navigator;
  },

  async listAccounts(derivationPath: string = BIP44_STELLAR_PATH): Promise<LedgerAccount[]> {
    try {
      if (!window.USBTransport && !window.HIDTransport) {
        throw new Error('Ledger transport not available. Ensure WebUSB or WebHID is supported.');
      }

      // Dynamic import to avoid build-time dependency issues
      const { default: TransportWebUSB } = await import('@ledgerhq/hw-transport-webusb').catch(
        () => ({ default: null }),
      );
      const { default: TransportWebHID } = await import('@ledgerhq/hw-transport-webhid').catch(
        () => ({ default: null }),
      );

      let transport = null;

      // Try WebHID first (more widely supported)
      if (TransportWebHID) {
        try {
          transport = await TransportWebHID.create();
        } catch (err) {
          console.warn('WebHID transport failed:', err);
        }
      }

      // Fall back to WebUSB
      if (!transport && TransportWebUSB) {
        try {
          transport = await TransportWebUSB.create();
        } catch (err) {
          console.warn('WebUSB transport failed:', err);
        }
      }

      if (!transport) {
        throw new Error('Failed to establish connection with Ledger device');
      }

      const { default: StrApp } = await import('@ledgerhq/hw-app-str');
      const app = new StrApp(transport);

      const accounts: LedgerAccount[] = [];
      for (let i = 0; i < 5; i++) {
        const path = `${derivationPath}/${i}'`;
        const result = await app.getPublicKey(path);
        accounts.push({
          publicKey: result.publicKey,
          path,
        });
      }

      await transport.close();
      return accounts;
    } catch (err) {
      console.error('Failed to list Ledger accounts:', err);
      throw err;
    }
  },

  async signTransaction(
    transactionXdr: string,
    accountPath: string = `${BIP44_STELLAR_PATH}/0'`,
  ): Promise<LedgerSignResult> {
    try {
      const { default: TransportWebHID } = await import('@ledgerhq/hw-transport-webhid').catch(
        () => ({ default: null }),
      );
      const { default: TransportWebUSB } = await import('@ledgerhq/hw-transport-webusb').catch(
        () => ({ default: null }),
      );

      let transport = null;

      if (TransportWebHID) {
        try {
          transport = await TransportWebHID.create();
        } catch (err) {
          console.warn('WebHID transport failed:', err);
        }
      }

      if (!transport && TransportWebUSB) {
        try {
          transport = await TransportWebUSB.create();
        } catch (err) {
          console.warn('WebUSB transport failed:', err);
        }
      }

      if (!transport) {
        throw new Error('Failed to connect to Ledger device');
      }

      const { default: StrApp } = await import('@ledgerhq/hw-app-str');
      const app = new StrApp(transport);

      // Get public key for the account
      const accountResult = await app.getPublicKey(accountPath);
      const publicKey = accountResult.publicKey;

      // Sign the transaction
      const signResult = await app.signTransaction(accountPath, transactionXdr);

      await transport.close();

      return {
        publicKey,
        signature: signResult.signature,
      };
    } catch (err) {
      console.error('Ledger transaction signing failed:', err);
      throw err;
    }
  },

  async validateLedgerConnection(): Promise<boolean> {
    try {
      const accounts = await this.listAccounts();
      return accounts.length > 0;
    } catch {
      return false;
    }
  },
};

declare global {
  interface Window {
    USBTransport?: any;
    HIDTransport?: any;
  }
}
