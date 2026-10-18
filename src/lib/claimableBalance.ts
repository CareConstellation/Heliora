import {
  Operation,
  Asset,
  Keypair,
  TransactionBuilder,
  Networks,
} from '@stellar/stellar-sdk';

export interface ClaimPredicateConfig {
  relativeTimestamp?: number;
  absoluteTimestamp?: number;
}

export interface CreateClaimableBalanceConfig {
  claimant: string;
  amount: string;
  asset: Asset;
  predicates?: {
    claimableFor?: number;
    autoClaimAfter?: number;
  };
}

export function createTimeLockedPredicate(config: ClaimPredicateConfig): any {
  const predicates = [];

  if (config.relativeTimestamp) {
    predicates.push({
      kind: 'predicate_unconditional_after_relative_time',
      seconds: config.relativeTimestamp,
    });
  }

  if (config.absoluteTimestamp) {
    predicates.push({
      kind: 'predicate_before_absolute_time',
      timestamp: config.absoluteTimestamp,
    });
  }

  if (predicates.length === 0) {
    return {
      kind: 'predicate_unconditional',
    };
  }

  if (predicates.length === 1) {
    return predicates[0];
  }

  return {
    kind: 'predicate_and',
    leftPredicate: predicates[0],
    rightPredicate: predicates[1],
  };
}

export function createClaimableBalanceOperation(
  config: CreateClaimableBalanceConfig
): any {
  const now = Math.floor(Date.now() / 1000);
  const claimableWindow = config.predicates?.claimableFor ?? 7 * 24 * 60 * 60;
  const autoReclaimTime = config.predicates?.autoClaimAfter ?? 14 * 24 * 60 * 60;

  const predicate = createTimeLockedPredicate({
    relativeTimestamp: claimableWindow,
    absoluteTimestamp: now + autoReclaimTime,
  });

  return Operation.createClaimableBalance({
    claimant: config.claimant,
    amount: config.amount,
    asset: config.asset,
    claimPredicates: [predicate],
  });
}

export async function buildClaimableBalanceTransaction(
  sourceAccount: any,
  configs: CreateClaimableBalanceConfig[],
  networkPassphrase: string
): Promise<string> {
  const builder = new TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase,
    timebounds: {
      minTime: 0,
      maxTime: Math.floor(Date.now() / 1000) + 30 * 60,
    },
  });

  configs.forEach(config => {
    const op = createClaimableBalanceOperation(config);
    builder.addOperation(op);
  });

  const transaction = builder.build();
  return transaction.toXDR();
}

export function createClaimOperation(balanceId: string): any {
  return Operation.claimClaimableBalance({
    balanceId,
  });
}

export function isClaimableNow(predicates: any[]): boolean {
  if (!predicates || predicates.length === 0) {
    return true;
  }

  const now = Math.floor(Date.now() / 1000);

  return predicates.every(pred => {
    switch (pred.kind) {
      case 'predicate_unconditional':
        return true;
      case 'predicate_before_absolute_time':
        return now < pred.timestamp;
      default:
        return true;
    }
  });
}
