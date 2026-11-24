import {
  BASE_FEE,
  Claimant,
  Horizon,
  Operation,
  TransactionBuilder,
  type Asset,
  type xdr,
} from '@stellar/stellar-sdk';
import {
  STELLAR_CONFIG,
  callHorizonWithFallback,
  type TransactionSigner,
} from './stellar';

export interface ClaimPredicateConfig {
  type?: 'unconditional' | 'absolute' | 'relative' | 'not' | 'and' | 'or';
  unconditional?: boolean;
  relativeTimestamp?: number; // seconds duration
  absoluteTimestamp?: number; // epoch seconds timestamp
  beforeAbsoluteTime?: number;
  beforeRelativeTime?: number;
  inner?: ClaimPredicateConfig[];
  not?: ClaimPredicateConfig;
  and?: ClaimPredicateConfig[];
  or?: ClaimPredicateConfig[];
}

export interface CreateClaimableBalanceConfig {
  claimant?: string;
  claimants?: Claimant[];
  amount: string;
  asset: Asset;
  predicates?: {
    claimableFor?: number; // relative seconds
    autoClaimAfter?: number; // absolute seconds from now
  };
}

export interface ClaimableBalanceRecord {
  id: string;
  asset: string;
  amount: string;
  sponsor: string;
  lastModifiedLedger: number;
  lastModifiedTime?: string;
  isClaimable: boolean;
  claimants: Array<{
    destination: string;
    predicate: unknown;
  }>;
}

/**
 * Constructs an xdr.ClaimPredicate based on temporal boundaries and boolean combinations (#190).
 *
 * Supports unconditional claims, absolute timestamps (abs_before), relative timeouts (rel_before),
 * negations (NOT), conjunctions (AND), and disjunctions (OR).
 *
 * Time: O(D) where D is the predicate tree depth (typically <= 3)
 * Space: O(D) stack frames
 */
export function createTimeLockedPredicate(config: ClaimPredicateConfig): xdr.ClaimPredicate {
  if (config.type === 'unconditional' || config.unconditional) {
    return Claimant.predicateUnconditional();
  }

  if (config.type === 'not' || config.not) {
    const innerConfig = config.not || (config.inner && config.inner[0]);
    if (!innerConfig) return Claimant.predicateUnconditional();
    return Claimant.predicateNot(createTimeLockedPredicate(innerConfig));
  }

  const andList = config.and || (config.type === 'and' ? config.inner : undefined);
  if (andList && andList.length > 0) {
    if (andList.length === 1) {
      return createTimeLockedPredicate(andList[0]!);
    }
    return andList.reduce((acc, curr, index) => {
      if (index === 0) return createTimeLockedPredicate(curr);
      return Claimant.predicateAnd(acc, createTimeLockedPredicate(curr));
    }, null as unknown as xdr.ClaimPredicate);
  }

  const orList = config.or || (config.type === 'or' ? config.inner : undefined);
  if (orList && orList.length > 0) {
    if (orList.length === 1) {
      return createTimeLockedPredicate(orList[0]!);
    }
    return orList.reduce((acc, curr, index) => {
      if (index === 0) return createTimeLockedPredicate(curr);
      return Claimant.predicateOr(acc, createTimeLockedPredicate(curr));
    }, null as unknown as xdr.ClaimPredicate);
  }

  const absTime = config.beforeAbsoluteTime ?? config.absoluteTimestamp;
  const relTime = config.beforeRelativeTime ?? config.relativeTimestamp;

  if (relTime !== undefined && absTime !== undefined) {
    const rel = Claimant.predicateBeforeRelativeTime(String(relTime));
    const abs = Claimant.predicateBeforeAbsoluteTime(String(absTime));
    return Claimant.predicateAnd(rel, abs);
  }

  if (relTime !== undefined) {
    return Claimant.predicateBeforeRelativeTime(String(relTime));
  }

  if (absTime !== undefined) {
    return Claimant.predicateBeforeAbsoluteTime(String(absTime));
  }

  return Claimant.predicateUnconditional();
}

/**
 * Constructs a CreateClaimableBalanceOperation for Stellar Horizon (#190).
 */
export function createClaimableBalanceOperation(
  config: CreateClaimableBalanceConfig,
): xdr.Operation {
  if (!config.amount || Number(config.amount) <= 0 || isNaN(Number(config.amount))) {
    throw new Error('Claimable balance must have a positive numerical amount.');
  }

  let claimants: Claimant[];
  if (config.claimants && config.claimants.length > 0) {
    claimants = config.claimants;
  } else if (config.claimant) {
    const now = Math.floor(Date.now() / 1000);
    const claimableWindow = config.predicates?.claimableFor ?? 7 * 24 * 60 * 60; // 7 days default
    const autoReclaimTime = config.predicates?.autoClaimAfter ?? 14 * 24 * 60 * 60; // 14 days default

    const predicate = createTimeLockedPredicate({
      relativeTimestamp: claimableWindow,
      absoluteTimestamp: now + autoReclaimTime,
    });
    claimants = [new Claimant(config.claimant, predicate)];
  } else {
    throw new Error('At least one claimant must be specified for claimable balance creation.');
  }

  return Operation.createClaimableBalance({
    claimants,
    amount: config.amount,
    asset: config.asset,
  });
}

/**
 * Builds the transaction operation to claim a claimable balance.
 */
export function createClaimOperation(balanceId: string): xdr.Operation {
  const cleanId = balanceId.trim().replace(/^0x/i, '');
  if (!cleanId || cleanId.length < 64) {
    throw new Error('Balance ID must be a valid 64-character hexadecimal string.');
  }

  return Operation.claimClaimableBalance({
    balanceId: cleanId,
  });
}

/**
 * Evaluates whether a claim predicate is satisfied given current time in seconds (#190).
 * Handles both Horizon REST JSON representation and native xdr.ClaimPredicate instances.
 *
 * Time: O(P) where P is the number of predicate sub-nodes
 * Space: O(P) recursion depth
 */
export function isClaimableNow(predicate: unknown, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!predicate) return true;

  // 1. Native XDR ClaimPredicate object
  if (typeof predicate === 'object' && predicate !== null && 'switch' in predicate) {
    const xdrPred = predicate as xdr.ClaimPredicate;
    const switchName = xdrPred.switch().name;

    switch (switchName) {
      case 'claimPredicateUnconditional':
        return true;
      case 'claimPredicateBeforeAbsoluteTime':
        return nowSeconds < Number(xdrPred.absBefore());
      case 'claimPredicateBeforeRelativeTime':
        return Number(xdrPred.relBefore()) > 0;
      case 'claimPredicateNot':
        return !isClaimableNow(xdrPred.notPredicate(), nowSeconds);
      case 'claimPredicateAnd':
        return xdrPred.andPredicates().every((p) => isClaimableNow(p, nowSeconds));
      case 'claimPredicateOr':
        return xdrPred.orPredicates().some((p) => isClaimableNow(p, nowSeconds));
      default:
        return true;
    }
  }

  // 2. Horizon JSON REST representation
  if (typeof predicate === 'object' && predicate !== null) {
    const json = predicate as Record<string, unknown>;

    if (json.unconditional === true) {
      return true;
    }

    if (json.abs_before !== undefined) {
      const absTime =
        typeof json.abs_before === 'string'
          ? json.abs_before.includes('T') || json.abs_before.includes('-')
            ? Math.floor(new Date(json.abs_before).getTime() / 1000)
            : parseInt(json.abs_before, 10)
          : Number(json.abs_before);
      return nowSeconds < absTime;
    }

    if (json.abs_after !== undefined) {
      const absTime =
        typeof json.abs_after === 'string'
          ? json.abs_after.includes('T') || json.abs_after.includes('-')
            ? Math.floor(new Date(json.abs_after).getTime() / 1000)
            : parseInt(json.abs_after, 10)
          : Number(json.abs_after);
      return nowSeconds >= absTime;
    }

    if (json.not !== undefined) {
      return !isClaimableNow(json.not, nowSeconds);
    }

    if (Array.isArray(json.and)) {
      return json.and.every((p) => isClaimableNow(p, nowSeconds));
    }

    if (Array.isArray(json.or)) {
      return json.or.some((p) => isClaimableNow(p, nowSeconds));
    }
  }

  // 3. Array of claimants or predicates
  if (Array.isArray(predicate)) {
    if (predicate.length === 0) return true;
    return predicate.some((p) => {
      const sub = typeof p === 'object' && p !== null && 'predicate' in p ? p.predicate : p;
      return isClaimableNow(sub, nowSeconds);
    });
  }

  return true;
}

/**
 * Queries active claimable balances for a given claimant from Horizon (#190).
 *
 * Time: O(1) RPC call + O(N) mapping over N claimable balances
 * Space: O(N) returned balance array
 */
export async function queryClaimableBalances(
  claimantAddress: string,
  _horizonUrl = STELLAR_CONFIG.horizonUrl,
): Promise<ClaimableBalanceRecord[]> {
  const result = await callHorizonWithFallback(async (url) => {
    const server = new Horizon.Server(url);
    return await server.claimableBalances().claimant(claimantAddress).call();
  });

  const rawRecords: any[] = Array.isArray(result)
    ? result
    : result?.records ?? result?._embedded?.records ?? [];

  const now = Math.floor(Date.now() / 1000);

  return rawRecords.map((record: any) => {
    const assetString =
      record.asset === 'native'
        ? 'XLM'
        : String(record.asset ?? 'XLM');

    const claimantsList = Array.isArray(record.claimants) ? record.claimants : [];

    return {
      id: record.id,
      asset: assetString,
      amount: record.amount,
      sponsor: record.sponsor || '',
      lastModifiedLedger: record.last_modified_ledger,
      lastModifiedTime: record.last_modified_time,
      isClaimable: isClaimableNow(claimantsList, now),
      claimants: claimantsList.map((c: any) => ({
        destination: c.destination,
        predicate: c.predicate,
      })),
    };
  });
}

/**
 * Builds an envelope to claim a claimable balance on Stellar (#190).
 */
export async function buildClaimClaimableBalanceTransaction(
  sourceAccount: Horizon.ServerApi.AccountRecord | { accountId: string; sequence: string } | string,
  balanceId: string,
  networkPassphrase = STELLAR_CONFIG.passphrase,
): Promise<string> {
  let accountObj: any;
  if (typeof sourceAccount === 'string') {
    accountObj = new Horizon.AccountResponse({
      account_id: sourceAccount,
      sequence: '100',
    } as any);
  } else if ('sequenceNumber' in sourceAccount) {
    accountObj = sourceAccount;
  } else {
    const accountId = 'accountId' in sourceAccount ? sourceAccount.accountId : (sourceAccount as any).id;
    const sequence = 'sequence' in sourceAccount ? sourceAccount.sequence : (sourceAccount as any).sequenceNumber?.() ?? '100';
    accountObj = new Horizon.AccountResponse({
      account_id: accountId,
      sequence,
    } as any);
  }

  const builder = new TransactionBuilder(accountObj, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(createClaimOperation(balanceId))
    .setTimeout(30);

  const tx = builder.build();
  return tx.toXDR();
}

/**
 * Submits an on-chain transaction to claim an insurance payout claimable balance (#190).
 */
export async function claimClaimableBalance(
  balanceId: string,
  claimantAddress: string,
  signer: TransactionSigner,
): Promise<{ txHash: string }> {
  return callHorizonWithFallback(async (url) => {
    const server = new Horizon.Server(url);
    const account = await server.loadAccount(claimantAddress);
    const xdrEnvelope = await buildClaimClaimableBalanceTransaction(
      account,
      balanceId,
      STELLAR_CONFIG.passphrase,
    );

    const signedXdr = await signer(xdrEnvelope, STELLAR_CONFIG.passphrase, claimantAddress);
    const tx = TransactionBuilder.fromXDR(signedXdr, STELLAR_CONFIG.passphrase);
    const response = await server.submitTransaction(tx);

    return { txHash: response.hash };
  });
}
