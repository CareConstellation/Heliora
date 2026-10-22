import {
  type Transaction,
  type FeeBumpTransaction,
  type Keypair,
  StrKey,
  BASE_FEE,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

interface FeeBumpConfig {
  baseTransaction: Transaction;
  feeAccount: Keypair;
  baseFee: number;
  networkPassphrase: string;
}

interface SponsorshipConfig {
  sponsorAccount: Keypair;
  sponsorThreshold: number;
  sponsorFeePerOperation: number;
  networkPassphrase: string;
}

interface SponsoredOperation {
  operationIndex: number;
  sponsoredBy: string;
  sponsorshipType: 'full' | 'partial';
  fee?: number;
}

interface FeeBumpMetadata {
  originalFee: number;
  newFee: number;
  feeBumpAccount: string;
  createdAt: number;
  reason?: string;
}

class SEP0029FeeBumpSponsorship {
  createFeeBumpTransaction(config: FeeBumpConfig): {
    transaction: FeeBumpTransaction;
    metadata: FeeBumpMetadata;
  } {
    const originalFee = Number(config.baseTransaction.fee);
    const newFee = this.calculateOptimalFee(originalFee, config.baseFee);

    const feeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
      config.feeAccount,
      newFee.toString(),
      config.baseTransaction,
      config.networkPassphrase,
    );

    const metadata: FeeBumpMetadata = {
      originalFee,
      newFee,
      feeBumpAccount: config.feeAccount.publicKey(),
      createdAt: Math.floor(Date.now() / 1000),
      reason: 'Fee bump increase for transaction acceleration',
    };

    return {
      transaction: feeBumpTransaction,
      metadata,
    };
  }

  private calculateOptimalFee(baseFee: number, perOperationFee: number): number {
    const networkLoadFactor = 1.5;
    return Math.ceil(baseFee * networkLoadFactor + perOperationFee * 10);
  }

  createSponsoredTransaction(
    baseTransaction: Transaction,
    sponsor: Keypair,
    networkPassphrase: string,
  ): {
    transaction: Transaction;
    sponsorshipMetadata: {
      sponsor: string;
      sponsorFee: number;
      transactionHash: string;
    };
  } {
    const sponsorFee = Math.ceil(Number(baseTransaction.fee) * 1.2);

    const sponsoredTransaction = TransactionBuilder.cloneFrom(baseTransaction, {
      fee: sponsorFee.toString(),
      networkPassphrase,
    }).build();

    return {
      transaction: sponsoredTransaction,
      sponsorshipMetadata: {
        sponsor: sponsor.publicKey(),
        sponsorFee,
        transactionHash: sponsoredTransaction.hash().toString('hex'),
      },
    };
  }

  sponsorOperations(
    transaction: Transaction,
    sponsor: Keypair,
    operationIndices: number[],
    _networkPassphrase: string,
  ): {
    transaction: Transaction;
    sponsoredOperations: SponsoredOperation[];
  } {
    const sponsorFeePerOp = Math.ceil(
      Number(transaction.fee) / Math.max(1, transaction.operations.length),
    );

    const sponsoredOps: SponsoredOperation[] = operationIndices.map((index) => ({
      operationIndex: index,
      sponsoredBy: sponsor.publicKey(),
      sponsorshipType: 'partial',
      fee: sponsorFeePerOp,
    }));

    return {
      transaction,
      sponsoredOperations: sponsoredOps,
    };
  }

  validateFeeBumpTransaction(
    feeBumpTx: FeeBumpTransaction,
    minFeeIncrease: number = Number(BASE_FEE),
  ): {
    valid: boolean;
    reason?: string;
  } {
    const innerTx = feeBumpTx.innerTransaction;
    const feeIncrease = Number(feeBumpTx.fee) - Number(innerTx.fee);

    if (feeIncrease < minFeeIncrease) {
      return {
        valid: false,
        reason: `Fee increase (${feeIncrease}) below minimum required (${minFeeIncrease})`,
      };
    }

    if (!StrKey.isValidEd25519PublicKey(feeBumpTx.feeSource)) {
      return {
        valid: false,
        reason: 'Invalid fee account public key',
      };
    }

    return {
      valid: true,
    };
  }

  estimateTransactionCost(
    transaction: Transaction,
    baseFee: number,
    expectedLoadFactor: number = 1.0,
  ): {
    baseCost: number;
    withLoadFactor: number;
    withBuffer: number;
  } {
    const baseCost = Number(transaction.fee) * baseFee;
    const withLoadFactor = Math.ceil(baseCost * expectedLoadFactor);
    const withBuffer = Math.ceil(withLoadFactor * 1.5);

    return {
      baseCost,
      withLoadFactor,
      withBuffer,
    };
  }

  serializeFeeBumpTransaction(feeBumpTx: FeeBumpTransaction): string {
    return feeBumpTx.toEnvelope().toXDR('base64');
  }

  deserializeFeeBumpTransaction(xdr: string, networkPassphrase: string): FeeBumpTransaction {
    return TransactionBuilder.fromXDR(xdr, networkPassphrase) as FeeBumpTransaction;
  }

  canSponsor(
    sponsorAccountBalance: number,
    requiredFee: number,
    reserveRequirement: number = 2.0,
  ): boolean {
    const minimumBalance = reserveRequirement + requiredFee;
    return sponsorAccountBalance >= minimumBalance;
  }

  estimateConfirmationTime(
    feePaid: number,
    baseNetworkFee: number,
  ): {
    estimatedSeconds: number;
    priority: 'low' | 'medium' | 'high' | 'critical';
  } {
    const feeRatio = feePaid / baseNetworkFee;

    if (feeRatio < 1.2) {
      return {
        estimatedSeconds: 300,
        priority: 'low',
      };
    } else if (feeRatio < 1.5) {
      return {
        estimatedSeconds: 180,
        priority: 'medium',
      };
    } else if (feeRatio < 2.0) {
      return {
        estimatedSeconds: 60,
        priority: 'high',
      };
    } else {
      return {
        estimatedSeconds: 10,
        priority: 'critical',
      };
    }
  }

  calculateSponsorshipCoverage(
    sponsorFee: number,
    totalTransactionFee: number,
  ): {
    percentage: number;
    sponsorCoverage: number;
    userCoverage: number;
  } {
    const percentage = Math.round((sponsorFee / totalTransactionFee) * 100);
    const userCoverage = totalTransactionFee - sponsorFee;

    return {
      percentage,
      sponsorCoverage: sponsorFee,
      userCoverage,
    };
  }

  prepareHealthcareFeeBumpTransaction(
    baseTransaction: Transaction,
    feeAccount: Keypair,
    networkPassphrase: string,
    isUrgent: boolean = false,
  ): {
    transaction: FeeBumpTransaction;
    metadata: FeeBumpMetadata;
  } {
    const baseFee = isUrgent ? Number(BASE_FEE) * 2 : Number(BASE_FEE);
    const operationCount = baseTransaction.operations.length;
    const priorityMultiplier = isUrgent ? 2.0 : 1.2;

    return this.createFeeBumpTransaction({
      baseTransaction,
      feeAccount,
      baseFee: baseFee * operationCount * priorityMultiplier,
      networkPassphrase,
    });
  }
}

export { SEP0029FeeBumpSponsorship };
export type { FeeBumpConfig, SponsorshipConfig, SponsoredOperation, FeeBumpMetadata };
