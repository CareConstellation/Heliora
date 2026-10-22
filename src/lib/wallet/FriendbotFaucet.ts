import { STELLAR_CONFIG } from '@/lib/stellar';

interface FaucetResponse {
  id: string;
  paging_token: string;
  hash: string;
  ledger: number;
  created_at: string;
  source_account: string;
  source_account_sequence: string;
  fee_paid: number;
  operation_count: number;
  transaction_count: number;
}

interface FaucetError {
  detail: string;
  extras?: Record<string, unknown>;
}

export class FriendbotFaucet {
  private static readonly FRIENDBOT_TESTNET = 'https://friendbot.stellar.org';
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY_MS = 1000;
  private static readonly DAILY_LIMIT_PER_ACCOUNT = 1; // Friendbot limits to 1 request per account per day

  static async fundAccount(publicKey: string, network: string = 'testnet'): Promise<FaucetResponse> {
    if (network !== 'testnet') {
      throw new Error('Friendbot faucet is only available for testnet');
    }

    if (!this.isValidPublicKey(publicKey)) {
      throw new Error('Invalid Stellar public key format');
    }

    return this.requestWithRetry(publicKey, 0);
  }

  private static async requestWithRetry(
    publicKey: string,
    attempt: number,
  ): Promise<FaucetResponse> {
    try {
      const response = await fetch(`${this.FRIENDBOT_TESTNET}?addr=${encodeURIComponent(publicKey)}`, {
        method: 'GET',
        timeout: 30000,
      });

      if (!response.ok) {
        const errorData = (await response.json()) as FaucetError;
        throw new Error(`Friendbot error: ${errorData.detail}`);
      }

      return (await response.json()) as FaucetResponse;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Don't retry on validation errors or rate limiting
      if (errorMsg.includes('already') || errorMsg.includes('rate limit')) {
        throw error;
      }

      if (attempt < this.MAX_RETRIES) {
        await this.delay(this.RETRY_DELAY_MS * Math.pow(2, attempt));
        return this.requestWithRetry(publicKey, attempt + 1);
      }

      throw new Error(
        `Failed to fund account after ${this.MAX_RETRIES} attempts: ${errorMsg}`,
      );
    }
  }

  static async checkAccountBalance(publicKey: string): Promise<{ native: number; isActive: boolean }> {
    try {
      const horizonUrl = STELLAR_CONFIG.horizonUrl;
      const response = await fetch(`${horizonUrl}/accounts/${publicKey}`, {
        timeout: 10000,
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { native: 0, isActive: false };
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        balances?: Array<{ asset_type: string; balance: string }>;
      };
      const nativeBalance = data.balances?.find(b => b.asset_type === 'native')?.balance || '0';

      return { native: parseFloat(nativeBalance), isActive: true };
    } catch (error) {
      throw new Error(
        `Failed to check account balance: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  static async fundAccountIfNeeded(
    publicKey: string,
    minimumBalance: number = 2,
  ): Promise<{ funded: boolean; balance: number; transactionHash?: string }> {
    try {
      const { native, isActive } = await this.checkAccountBalance(publicKey);

      // If balance is sufficient, no need to fund
      if (native >= minimumBalance) {
        return { funded: false, balance: native };
      }

      // Try to fund the account
      const response = await this.fundAccount(publicKey);
      return { funded: true, balance: 10, transactionHash: response.hash };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // If account already funded or rate limited, return current balance
      if (errorMsg.includes('already') || errorMsg.includes('rate limit')) {
        try {
          const { native } = await this.checkAccountBalance(publicKey);
          return { funded: false, balance: native };
        } catch {
          return { funded: false, balance: 0 };
        }
      }

      throw error;
    }
  }

  private static isValidPublicKey(publicKey: string): boolean {
    // Stellar public keys start with 'G' and are 56 characters long (base32)
    return /^G[A-Z2-7]{55}$/.test(publicKey);
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
