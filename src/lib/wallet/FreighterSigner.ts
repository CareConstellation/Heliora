import { getNetworkDetails, signTransaction } from '@stellar/freighter-api';

export interface FreighterNetworkDetails {
  network: string;
  networkUrl?: string;
  networkPassphrase?: string;
}

export interface NetworkMismatchResult {
  isMismatch: boolean;
  walletNetwork: string;
  expectedNetwork: string;
  networkPassphrase?: string;
}

/**
 * Normalizes network identifiers (e.g. "PUBLIC", "mainnet", "TESTNET")
 * into canonical lowercase standard names ("public", "testnet", "futurenet", "standalone").
 */
export function normalizeNetwork(networkStr: string | undefined | null): string {
  if (!networkStr) return '';
  const lower = networkStr.trim().toLowerCase();
  if (lower === 'mainnet' || lower === 'public') return 'public';
  if (lower === 'testnet') return 'testnet';
  if (lower === 'futurenet') return 'futurenet';
  if (lower === 'standalone' || lower === 'local') return 'standalone';
  return lower;
}

/**
 * Retrieves the current network configuration from the Freighter browser extension.
 * Gracefully falls back to window.freighter if the npm package call fails.
 */
export async function getFreighterNetworkDetails(): Promise<FreighterNetworkDetails | null> {
  try {
    const details = await getNetworkDetails();
    if (details && typeof details === 'object' && 'network' in details) {
      return {
        network: String(details.network),
        networkUrl: 'networkUrl' in details ? String(details.networkUrl) : undefined,
        networkPassphrase: 'networkPassphrase' in details ? String(details.networkPassphrase) : undefined,
      };
    }
  } catch (err) {
    // Attempt fallback to window.freighter if available
    if (typeof window !== 'undefined' && window.freighter) {
      if (typeof (window.freighter as any).getNetworkDetails === 'function') {
        try {
          const winDetails = await (window.freighter as any).getNetworkDetails();
          if (winDetails?.network) {
            return {
              network: String(winDetails.network),
              networkUrl: winDetails.networkUrl,
              networkPassphrase: winDetails.networkPassphrase,
            };
          }
        } catch {
          // ignore
        }
      }
      if (typeof window.freighter.getNetwork === 'function') {
        try {
          const net = await window.freighter.getNetwork();
          if (net) {
            return { network: String(net) };
          }
        } catch {
          // ignore
        }
      }
    }
  }
  return null;
}

/**
 * Compares the active Freighter extension network with the configured dApp network.
 * Returns whether a mismatch exists along with both network names.
 */
export async function checkFreighterNetworkMismatch(
  configuredDappNetwork?: string,
): Promise<NetworkMismatchResult> {
  const expectedRaw =
    configuredDappNetwork || process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet';
  const expectedNormalized = normalizeNetwork(expectedRaw);

  const details = await getFreighterNetworkDetails();
  if (!details || !details.network) {
    // If details cannot be queried (e.g. extension not installed or not responding),
    // report no mismatch to prevent blocking non-Freighter or uninitialized flows.
    return {
      isMismatch: false,
      walletNetwork: '',
      expectedNetwork: expectedRaw,
    };
  }

  const walletNormalized = normalizeNetwork(details.network);
  const isMismatch = !!walletNormalized && walletNormalized !== expectedNormalized;

  return {
    isMismatch,
    walletNetwork: details.network,
    expectedNetwork: expectedRaw,
    networkPassphrase: details.networkPassphrase,
  };
}

/**
 * Signer utility wrapping Freighter transactions.
 */
export async function freighterSignTransaction(
  envelopeXdr: string,
  opts?: { networkPassphrase?: string; address?: string },
): Promise<string> {
  const result = await signTransaction(envelopeXdr, opts);
  if (result.error) {
    throw new Error(result.error.message || 'Freighter transaction signing failed');
  }
  return result.signedTxXdr;
}
