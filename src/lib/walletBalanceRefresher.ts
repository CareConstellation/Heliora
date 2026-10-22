import { Horizon } from '@stellar/stellar-sdk';
import { STELLAR_CONFIG } from '@/lib/stellar';

export interface AccountBalance {
  nativeBalance: number;
  minimumBalance: number;
  isLowBalance: boolean;
}

export interface AccountDetails {
  publicKey: string;
  sequence: number;
  nativeBalance: number;
  lastUpdate: number;
}

const POLL_INTERVAL_MS = 30 * 1000; // 30 seconds
const MINIMUM_RESERVE_XLM = 1.5; // 1 XLM base + 0.5 XLM for subentry reserves

const pollIntervals: Map<string, NodeJS.Timeout> = new Map();

export const walletBalanceRefresher = {
  async fetchAccountDetails(publicKey: string): Promise<AccountDetails | null> {
    try {
      const server = new Horizon.Server(STELLAR_CONFIG.horizonUrl);
      const account = await server.loadAccount(publicKey);

      const nativeBalance = parseFloat(
        account.balances.find(
          (b: { asset_type: string; balance: string }) => b.asset_type === 'native',
        )?.balance || '0',
      );

      return {
        publicKey,
        sequence: parseInt(account.sequence, 10),
        nativeBalance,
        lastUpdate: Date.now(),
      };
    } catch (err) {
      console.error('Failed to fetch account details:', err);
      return null;
    }
  },

  checkBalanceSufficiency(nativeBalance: number): AccountBalance {
    return {
      nativeBalance,
      minimumBalance: MINIMUM_RESERVE_XLM,
      isLowBalance: nativeBalance < MINIMUM_RESERVE_XLM,
    };
  },

  startPolling(publicKey: string, onUpdate: (details: AccountDetails) => void) {
    // Clear existing interval if any
    if (pollIntervals.has(publicKey)) {
      clearInterval(pollIntervals.get(publicKey));
    }

    // Initial fetch
    void this.fetchAccountDetails(publicKey).then((details) => {
      if (details) onUpdate(details);
    });

    // Set up polling
    const interval = setInterval(() => {
      void this.fetchAccountDetails(publicKey).then((details) => {
        if (details) onUpdate(details);
      });
    }, POLL_INTERVAL_MS);

    pollIntervals.set(publicKey, interval);
  },

  stopPolling(publicKey: string) {
    const interval = pollIntervals.get(publicKey);
    if (interval) {
      clearInterval(interval);
      pollIntervals.delete(publicKey);
    }
  },

  stopAllPolling() {
    pollIntervals.forEach((interval) => clearInterval(interval));
    pollIntervals.clear();
  },

  formatBalance(balance: number): string {
    return balance.toFixed(2) + ' XLM';
  },
};
