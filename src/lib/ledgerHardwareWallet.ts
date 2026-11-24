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

export const LEDGER_TIMEOUT_MS = 45_000; // 45 seconds user prompt timeout
const BIP44_STELLAR_PATH = "m/44'/148'/0'"; // Standard BIP-44 path for Stellar

/**
 * Wraps an asynchronous operation with a 45-second timeout.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = LEDGER_TIMEOUT_MS,
  timeoutMessage: string = 'Ledger request timed out after 45 seconds. Please ensure your Ledger is unlocked, the Stellar app is open, and try again.',
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(timeoutMessage);
      err.name = 'TimeoutError';
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Detects whether an error corresponds to a Ledger WebHID/WebUSB device disconnection or re-enumeration failure.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function isDisconnectedDeviceError(error: unknown): boolean {
  if (!error) return false;
  const err = error as Record<string, unknown>;
  const name = String(err.name || '');
  const message = String(err.message || '');
  const statusCode = Number(err.statusCode || 0);

  if (
    name === 'DisconnectedDevice' ||
    name === 'DisconnectedDeviceDuringOperation' ||
    name === 'HIDDeviceDisconnected' ||
    name === 'TransportError' ||
    name === 'TransportStatusError' ||
    name === 'TransportListenError'
  ) {
    return true;
  }

  const lowerMsg = message.toLowerCase();
  if (
    lowerMsg.includes('disconnected') ||
    lowerMsg.includes('device was disconnected') ||
    lowerMsg.includes('cannot open device') ||
    lowerMsg.includes('failed to open the device') ||
    lowerMsg.includes('unable to claim interface') ||
    lowerMsg.includes('device not found') ||
    lowerMsg.includes('0x6a15') ||
    lowerMsg.includes('0x6800')
  ) {
    return true;
  }

  return statusCode === 0x6a15 || statusCode === 0x6800;
}

/**
 * Maps Ledger and WebHID error codes/types to clear, actionable instructions for unlocking or opening the Stellar app.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function mapLedgerError(error: unknown): string {
  if (!error) {
    return 'An unknown error occurred while communicating with the Ledger device.';
  }

  const err = error as Record<string, unknown>;
  const name = String(err.name || '');
  const message = String(err.message || '');
  const statusCode = Number(err.statusCode || 0);
  const lowerMsg = message.toLowerCase();

  // 1. Disconnection or Re-enumeration
  if (isDisconnectedDeviceError(error)) {
    return 'Ledger device disconnected. Please reconnect your Ledger, enter your PIN to unlock it, and open the Stellar app.';
  }

  // 2. Timeout
  if (
    (error instanceof Error && error.name === 'TimeoutError') ||
    name === 'TimeoutError' ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('timeout')
  ) {
    return 'Ledger request timed out after 45 seconds. Please ensure your Ledger is unlocked, the Stellar app is open, and try again.';
  }

  // 3. Stellar app not open (0x6e00, 0x6d00, CLA/INS not supported)
  if (
    statusCode === 0x6e00 ||
    statusCode === 0x6d00 ||
    lowerMsg.includes('0x6e00') ||
    lowerMsg.includes('0x6d00') ||
    lowerMsg.includes('app not open') ||
    lowerMsg.includes('cla_not_supported') ||
    lowerMsg.includes('ins_not_supported')
  ) {
    return 'Stellar app is not open on your Ledger. Please unlock your device and open the Stellar app.';
  }

  // 4. User cancelled / condition of use not satisfied (0x6985)
  if (
    statusCode === 0x6985 ||
    lowerMsg.includes('0x6985') ||
    lowerMsg.includes('condition of use not satisfied') ||
    lowerMsg.includes('user denied') ||
    lowerMsg.includes('user rejected')
  ) {
    return 'Transaction rejected on Ledger device.';
  }

  // 5. Device locked / PIN needed (0x6511, 0x5515)
  if (
    statusCode === 0x6511 ||
    statusCode === 0x5515 ||
    lowerMsg.includes('0x6511') ||
    lowerMsg.includes('0x5515') ||
    lowerMsg.includes('device locked') ||
    lowerMsg.includes('locked')
  ) {
    return 'Ledger is locked. Please enter your PIN on your device to unlock it.';
  }

  return message || 'Failed to communicate with Ledger device. Please ensure it is unlocked and the Stellar app is open.';
}

/**
 * Creates transport with automatic reconnection and retry on device re-enumeration.
 * Time Complexity: O(R) where R <= 2 retries.
 * Space Complexity: O(1)
 */
async function createTransportWithRetry(maxRetries: number = 2): Promise<any> {
  const { default: TransportWebHID } = await import('@ledgerhq/hw-transport-webhid').catch(
    () => ({ default: null }),
  );
  const { default: TransportWebUSB } = await import('@ledgerhq/hw-transport-webusb').catch(
    () => ({ default: null }),
  );

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Prefer WebHID
      if (TransportWebHID) {
        try {
          const transport = await withTimeout(
            TransportWebHID.create(),
            LEDGER_TIMEOUT_MS,
            'Ledger connection timed out after 45 seconds while opening WebHID.',
          );
          if (transport) return transport;
        } catch (hidErr) {
          lastError = hidErr;
          console.warn(`WebHID transport attempt ${attempt + 1} failed:`, hidErr);
        }
      }

      // Fallback to WebUSB
      if (TransportWebUSB) {
        try {
          const transport = await withTimeout(
            TransportWebUSB.create(),
            LEDGER_TIMEOUT_MS,
            'Ledger connection timed out after 45 seconds while opening WebUSB.',
          );
          if (transport) return transport;
        } catch (usbErr) {
          lastError = usbErr;
          console.warn(`WebUSB transport attempt ${attempt + 1} failed:`, usbErr);
        }
      }
    } catch (err) {
      lastError = err;
    }

    if (attempt < maxRetries && isDisconnectedDeviceError(lastError)) {
      // Brief pause to allow OS/browser to complete device re-enumeration
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  throw new Error(
    mapLedgerError(lastError || new Error('Failed to establish connection with Ledger device')),
  );
}

export const ledgerHardwareWallet = {
  mapLedgerError,
  isDisconnectedDeviceError,
  withTimeout,

  async checkWebUSBSupport(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    return 'usb' in navigator || 'hid' in navigator;
  },

  async listAccounts(derivationPath: string = BIP44_STELLAR_PATH): Promise<LedgerAccount[]> {
    let transport: any = null;
    try {
      transport = await createTransportWithRetry(2);

      const { default: StrApp } = await import('@ledgerhq/hw-app-str');
      const app = new StrApp(transport);

      const fetchAccounts = async () => {
        const accounts: LedgerAccount[] = [];
        for (let i = 0; i < 5; i++) {
          const path = `${derivationPath}/${i}'`;
          const result = await app.getPublicKey(path);
          accounts.push({
            publicKey: result.publicKey,
            path,
          });
        }
        return accounts;
      };

      return await withTimeout(
        fetchAccounts(),
        LEDGER_TIMEOUT_MS,
        'Ledger request timed out after 45 seconds while listing accounts. Please ensure your device is unlocked and the Stellar app is open.',
      );
    } catch (err) {
      // If disconnected during list, attempt one reconnection recovery
      if (isDisconnectedDeviceError(err)) {
        try {
          if (transport) {
            await transport.close().catch(() => {});
          }
          transport = await createTransportWithRetry(1);
          const { default: StrApp } = await import('@ledgerhq/hw-app-str');
          const app = new StrApp(transport);
          const accounts: LedgerAccount[] = [];
          for (let i = 0; i < 5; i++) {
            const path = `${derivationPath}/${i}'`;
            const result = await withTimeout(app.getPublicKey(path), 10_000);
            accounts.push({
              publicKey: result.publicKey,
              path,
            });
          }
          return accounts;
        } catch (retryErr) {
          const mapped = mapLedgerError(retryErr);
          const finalErr = new Error(mapped);
          console.error('Failed to list Ledger accounts after retry:', finalErr);
          throw finalErr;
        }
      }

      const mapped = mapLedgerError(err);
      const finalErr = new Error(mapped);
      console.error('Failed to list Ledger accounts:', finalErr);
      throw finalErr;
    } finally {
      if (transport) {
        await transport.close().catch(() => {});
      }
    }
  },

  async signTransaction(
    transactionXdr: string,
    accountPath: string = `${BIP44_STELLAR_PATH}/0'`,
  ): Promise<LedgerSignResult> {
    let transport: any = null;
    try {
      transport = await createTransportWithRetry(2);

      const { default: StrApp } = await import('@ledgerhq/hw-app-str');
      const app = new StrApp(transport);

      const executeSign = async () => {
        const accountResult = await app.getPublicKey(accountPath);
        const publicKey = accountResult.publicKey;
        const signResult = await app.signTransaction(accountPath, transactionXdr);
        return {
          publicKey,
          signature: signResult.signature,
        };
      };

      return await withTimeout(
        executeSign(),
        LEDGER_TIMEOUT_MS,
        'Ledger request timed out after 45 seconds while waiting for transaction signature. Please confirm the transaction on your Ledger device.',
      );
    } catch (err) {
      // If disconnected during signing, attempt automatic reconnection and retry
      if (isDisconnectedDeviceError(err)) {
        try {
          if (transport) {
            await transport.close().catch(() => {});
          }
          transport = await createTransportWithRetry(1);
          const { default: StrApp } = await import('@ledgerhq/hw-app-str');
          const app = new StrApp(transport);

          const executeSignRetry = async () => {
            const accountResult = await app.getPublicKey(accountPath);
            const publicKey = accountResult.publicKey;
            const signResult = await app.signTransaction(accountPath, transactionXdr);
            return {
              publicKey,
              signature: signResult.signature,
            };
          };

          return await withTimeout(
            executeSignRetry(),
            LEDGER_TIMEOUT_MS,
            'Ledger request timed out after 45 seconds on reconnected session.',
          );
        } catch (retryErr) {
          const mapped = mapLedgerError(retryErr);
          const finalErr = new Error(mapped);
          console.error('Ledger transaction signing failed after reconnection attempt:', finalErr);
          throw finalErr;
        }
      }

      const mapped = mapLedgerError(err);
      const finalErr = new Error(mapped);
      console.error('Ledger transaction signing failed:', finalErr);
      throw finalErr;
    } finally {
      if (transport) {
        await transport.close().catch(() => {});
      }
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
