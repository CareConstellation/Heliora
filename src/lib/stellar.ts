import { Buffer } from 'buffer';
import {
  Account,
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  hash as sha256,
  rpc,
  type FeeBumpTransaction,
  type Transaction,
  type xdr,
} from '@stellar/stellar-sdk';
import { signMessage, signTransaction } from '@stellar/freighter-api';
import { useCallback } from 'react';
import { useToast } from '@/hooks/useToast';

interface EndpointHealth {
  url: string;
  lastLatency: number | null;
  failureCount: number;
  lastChecked: number;
  isHealthy: boolean;
}

const TESTNET_ENDPOINTS: [string, ...string[]] = [
  'https://horizon-testnet.stellar.org',
  'https://testnet.stellar.lobstr.co',
  'https://stellar-testnet.blockdaemon.com',
];

const MAINNET_ENDPOINTS: [string, ...string[]] = [
  'https://horizon.stellar.org',
  'https://stellar-mainnet.blockdaemon.com',
  'https://mainnet.stellar.lobstr.co',
];

const LATENCY_THRESHOLD_MS = 2500;
const MAX_FAILURES = 3;

const endpointHealth: Map<string, EndpointHealth> = new Map();

/**
 * Global Stellar configuration for the application.
 *
 * This object defines the network, Horizon endpoint, and passphrase used by
 * the Stellar SDK in this frontend.
 *
 * Environment Variables (see README.md):
 * - NEXT_PUBLIC_STELLAR_NETWORK: Defines the network ('testnet' or 'mainnet'). Defaults to 'testnet'.
 * - NEXT_PUBLIC_HORIZON_URL: Defines the Horizon API URL. Defaults to the public testnet URL.
 *
 * Note: The passphrase is hardcoded to `Networks.TESTNET` currently. If you need to support
 * mainnet, ensure you map `NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'` to `Networks.PUBLIC`.
 */
const isMainnet = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet';
const endpoints = isMainnet ? MAINNET_ENDPOINTS : TESTNET_ENDPOINTS;

export const STELLAR_CONFIG = {
  network: process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet',
  horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL || endpoints[0],
  endpoints,
  passphrase: isMainnet ? Networks.PUBLIC : Networks.TESTNET,
  // SDF hosts a public Soroban RPC for testnet only; mainnet needs a provider URL.
  sorobanRpcUrl:
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ||
    (isMainnet ? '' : 'https://soroban-testnet.stellar.org'),
};

function initializeEndpointHealth() {
  if (endpointHealth.size === 0) {
    STELLAR_CONFIG.endpoints.forEach((url) => {
      endpointHealth.set(url, {
        url,
        lastLatency: null,
        failureCount: 0,
        lastChecked: 0,
        isHealthy: true,
      });
    });
  }
}

/**
 * Pings a Horizon endpoint and records its latency and failure count so that
 * `getHealthyEndpoint` can prefer the fastest reachable server.
 */
export async function checkEndpointHealth(url: string): Promise<number> {
  const startTime = performance.now();
  try {
    const response = await fetch(`${url}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    const latency = performance.now() - startTime;

    if (response.ok) {
      const health = endpointHealth.get(url);
      if (health) {
        health.lastLatency = latency;
        health.failureCount = 0;
        health.isHealthy = latency < LATENCY_THRESHOLD_MS;
        health.lastChecked = Date.now();
      }
      return latency;
    }
    throw new Error(`Health check failed: ${response.status}`);
  } catch (err) {
    const health = endpointHealth.get(url);
    if (health) {
      health.failureCount++;
      health.isHealthy = health.failureCount < MAX_FAILURES;
      health.lastChecked = Date.now();
    }
    throw err;
  }
}

export function getHealthyEndpoint(): string {
  initializeEndpointHealth();

  const healthyEndpoints = Array.from(endpointHealth.values())
    .filter((h) => h.isHealthy)
    .sort((a, b) => {
      const aLatency = a.lastLatency ?? LATENCY_THRESHOLD_MS;
      const bLatency = b.lastLatency ?? LATENCY_THRESHOLD_MS;
      return aLatency - bLatency;
    });

  const healthiest = healthyEndpoints[0];
  return healthiest ? healthiest.url : STELLAR_CONFIG.endpoints[0];
}

export function resetEndpointFailure(url: string) {
  const health = endpointHealth.get(url);
  if (health) {
    health.failureCount = 0;
    health.isHealthy = true;
  }
}

export class HorizonRequestError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'HorizonRequestError';
  }
}

/**
 * Attempts a call with automatic fallback to healthy endpoints on failure.
 * Tracks endpoint health and latency for future requests.
 */
export async function callHorizonWithFallback<T>(fn: (url: string) => Promise<T>): Promise<T> {
  initializeEndpointHealth();

  const endpointsToTry = Array.from(endpointHealth.values())
    .sort((a, b) => {
      const aLatency = a.lastLatency ?? LATENCY_THRESHOLD_MS;
      const bLatency = b.lastLatency ?? LATENCY_THRESHOLD_MS;
      return aLatency - bLatency;
    })
    .map((h) => h.url);

  let lastError: unknown;

  for (const url of endpointsToTry) {
    try {
      const result = await fn(url);
      resetEndpointFailure(url);
      return result;
    } catch (err: unknown) {
      lastError = err;
      const health = endpointHealth.get(url);
      if (health) {
        health.failureCount++;
        health.isHealthy = health.failureCount < MAX_FAILURES;
      }
    }
  }

  throw lastError;
}

/**
 * Normalizes Horizon network errors, rate limits, and invalid responses into a
 * single HorizonRequestError instead of letting them throw unhandled/crash the UI.
 */
export async function callHorizon<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await callHorizonWithFallback(() => fn());
  } catch (err: unknown) {
    if (err instanceof TypeError) {
      throw new HorizonRequestError(
        'Unable to reach the Stellar network. Check your connection and try again.',
        err,
      );
    }
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 429) {
      throw new HorizonRequestError(
        'Stellar network rate limit reached. Please try again shortly.',
        err,
      );
    }
    if (status && status >= 500) {
      throw new HorizonRequestError('Stellar Horizon service is temporarily unavailable.', err);
    }
    if (status && status >= 400) {
      throw new HorizonRequestError('Invalid request sent to the Stellar network.', err);
    }
    throw new HorizonRequestError('Unexpected error communicating with the Stellar network.', err);
  }
}

/** Runs a Horizon call and surfaces any failure via the toast system instead of failing silently. */
export function useHorizonCall() {
  const { toast } = useToast();

  return useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await callHorizon(fn);
      } catch (err) {
        const message =
          err instanceof HorizonRequestError
            ? err.message
            : 'Failed to communicate with the Stellar network.';
        toast(message, 'error');
        return undefined;
      }
    },
    [toast],
  );
}

/** Signs a base64 transaction envelope with `address` for `networkPassphrase` and returns the signed envelope. */
export type TransactionSigner = (
  envelopeXdr: string,
  networkPassphrase: string,
  address: string,
) => Promise<string>;

/**
 * {@link TransactionSigner} backed by the Freighter extension through the official
 * `@stellar/freighter-api` (v6: resolves to `{ signedTxXdr, signerAddress, error? }`).
 */
export const freighterSigner: TransactionSigner = async (
  envelopeXdr,
  networkPassphrase,
  address,
) => {
  const { signedTxXdr, signerAddress, error } = await signTransaction(envelopeXdr, {
    networkPassphrase,
    address,
  });
  if (error) throw new Error(error.message || 'Freighter could not sign the transaction.');
  if (signerAddress !== address) throw new Error('Freighter signed with a different account.');
  return signedTxXdr;
};

/** Signs an arbitrary utf-8 message with `address` (SEP-53) and returns the base64 signature. */
export type MessageSigner = (message: string, address: string) => Promise<string>;

const SEP53_PREFIX = 'Stellar Signed Message:\n';

/** SEP-53 digest: `SHA-256("Stellar Signed Message:\n" || message)`. */
export function sep53Digest(message: string): Buffer {
  return sha256(Buffer.concat([Buffer.from(SEP53_PREFIX, 'utf8'), Buffer.from(message, 'utf8')]));
}

/**
 * {@link MessageSigner} backed by Freighter's SEP-53 `signMessage`. Freighter v4+
 * returns the signature as base64; older versions return a `Buffer`.
 */
export const freighterMessageSigner: MessageSigner = async (message, address) => {
  const { signedMessage, signerAddress, error } = await signMessage(message, {
    networkPassphrase: STELLAR_CONFIG.passphrase,
    address,
  });
  if (error) throw new Error(error.message || 'Freighter could not sign the message.');
  if (!signedMessage) throw new Error('Freighter returned an empty signature.');
  if (signerAddress !== address) throw new Error('Freighter signed with a different account.');
  return typeof signedMessage === 'string'
    ? signedMessage
    : Buffer.from(signedMessage).toString('base64');
};

/** Verifies a base64 SEP-53 signature of `message` by the Stellar account `address`. */
export function verifySignedMessage(address: string, message: string, signature: string): boolean {
  try {
    return Keypair.fromPublicKey(address).verify(
      sep53Digest(message),
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

const SOROBAN_TX_TIMEOUT_SECONDS = 300;
const SOROBAN_POLL_ATTEMPTS = 30; // ~1 s apart, i.e. about 5 ledgers

/**
 * Simulates, signs, submits and confirms a single Soroban contract invocation.
 * `prepareTransaction` runs `simulateTransaction` and attaches the footprint,
 * authorization entries and resource fee before the wallet signs.
 * @returns The confirmed transaction hash.
 */
export async function invokeSorobanContract(
  source: string,
  operation: xdr.Operation,
  sign: TransactionSigner,
): Promise<string> {
  if (!STELLAR_CONFIG.sorobanRpcUrl)
    throw new Error('NEXT_PUBLIC_SOROBAN_RPC_URL is not configured.');
  const server = new rpc.Server(STELLAR_CONFIG.sorobanRpcUrl);
  const tx = new TransactionBuilder(await server.getAccount(source), {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_CONFIG.passphrase,
  })
    .addOperation(operation)
    .setTimeout(SOROBAN_TX_TIMEOUT_SECONDS)
    .build();

  const prepared = await server.prepareTransaction(tx);
  const signedXdr = await sign(prepared.toXDR(), STELLAR_CONFIG.passphrase, source);
  const sent = await server.sendTransaction(
    TransactionBuilder.fromXDR(signedXdr, STELLAR_CONFIG.passphrase),
  );
  if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') {
    throw new Error(`Soroban transaction was not accepted (${sent.status}).`);
  }

  const result = await server.pollTransaction(sent.hash, { attempts: SOROBAN_POLL_ATTEMPTS });
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      result.status === rpc.Api.GetTransactionStatus.FAILED
        ? `Soroban transaction ${sent.hash} failed.`
        : `Soroban transaction ${sent.hash} was not confirmed in time.`,
    );
  }
  return sent.hash;
}

export interface StrictReceivePathQuote {
  sourceAsset: Asset;
  sourceAssetCode: string;
  sourceAssetIssuer?: string | undefined;
  sourceAmount: string;
  destAsset: Asset;
  destAssetCode: string;
  destAssetIssuer?: string | undefined;
  destAmount: string;
  path: Asset[];
  conversionRate: number;
  sendMax: string;
  slippageTolerancePercent: number;
}

export interface SupportedPaymentAsset {
  code: string;
  name: string;
  asset: Asset;
}

export const CLINICAL_PAYMENT_ASSETS: Record<'testnet' | 'mainnet', SupportedPaymentAsset[]> = {
  testnet: [
    { code: 'XLM', name: 'Stellar Lumens', asset: Asset.native() },
    { code: 'USDC', name: 'USD Coin', asset: new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5') },
    { code: 'EURC', name: 'Euro Coin', asset: new Asset('EURC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5') },
  ],
  mainnet: [
    { code: 'XLM', name: 'Stellar Lumens', asset: Asset.native() },
    { code: 'USDC', name: 'USD Coin', asset: new Asset('USDC', 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN') },
    { code: 'EURC', name: 'Euro Coin', asset: new Asset('EURC', 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2') },
  ],
};

export function parseStellarAsset(assetStr: string): Asset {
  if (!assetStr || assetStr === 'native' || assetStr === 'XLM' || assetStr === 'stellar:native') {
    return Asset.native();
  }
  const parts = assetStr.split(':');
  if (parts.length === 3 && parts[0] === 'stellar' && parts[1] && parts[2]) {
    return new Asset(parts[1], parts[2]);
  }
  if (parts.length === 2 && parts[0] && parts[1]) {
    return new Asset(parts[0], parts[1]);
  }
  return Asset.native();
}

/**
 * Queries Horizon /paths/strict-receive for source assets and maximum send limits.
 * Computes exact conversion rates and slippage bounds.
 */
export async function findStrictReceivePaymentPaths(options: {
  sourceAccountOrAssets: string | Asset[];
  destAsset: Asset;
  destAmount: string;
  slippageTolerancePercent?: number;
}): Promise<StrictReceivePathQuote[]> {
  const slippagePercent = options.slippageTolerancePercent ?? 1.0;
  const endpoint = getHealthyEndpoint();
  const server = new Horizon.Server(endpoint);

  const response = await callHorizon(async () => {
    return await server
      .strictReceivePaths(options.sourceAccountOrAssets, options.destAsset, options.destAmount)
      .call();
  });

  if (!response || !response.records || response.records.length === 0) {
    return [];
  }

  const destAmountNum = Number(options.destAmount);

  return (response.records as Array<{
    source_asset_type: string;
    source_asset_code: string;
    source_asset_issuer: string;
    source_amount: string;
    path: Array<{ asset_type: string; asset_code: string; asset_issuer: string }>;
  }>).map((record) => {
    const sourceAsset =
      record.source_asset_type === 'native'
        ? Asset.native()
        : new Asset(record.source_asset_code, record.source_asset_issuer);

    const sourceAmountNum = Number(record.source_amount);
    const multiplier = 1 + slippagePercent / 100;
    const sendMaxCalculated = (sourceAmountNum * multiplier).toFixed(7);

    const pathAssets: Asset[] = (record.path || []).map((hop: { asset_type: string; asset_code: string; asset_issuer: string }) =>
      hop.asset_type === 'native' ? Asset.native() : new Asset(hop.asset_code, hop.asset_issuer),
    );

    const conversionRate = destAmountNum > 0 ? sourceAmountNum / destAmountNum : 0;

    return {
      sourceAsset,
      sourceAssetCode: sourceAsset.isNative() ? 'XLM' : sourceAsset.getCode(),
      sourceAssetIssuer: sourceAsset.isNative() ? undefined : sourceAsset.getIssuer(),
      sourceAmount: record.source_amount,
      destAsset: options.destAsset,
      destAssetCode: options.destAsset.isNative() ? 'XLM' : options.destAsset.getCode(),
      destAssetIssuer: options.destAsset.isNative() ? undefined : options.destAsset.getIssuer(),
      destAmount: options.destAmount,
      path: pathAssets,
      conversionRate,
      sendMax: sendMaxCalculated,
      slippageTolerancePercent: slippagePercent,
    };
  });
}

/**
 * Assembles and builds a PathPaymentStrictReceive transaction with strict slippage bounds.
 */
export async function buildPathPaymentStrictReceiveTransaction(options: {
  sourceAddress: string;
  destinationAddress: string;
  sendAsset: Asset;
  sendMax: string;
  destAsset: Asset;
  destAmount: string;
  path?: Asset[];
  fee?: string;
  timeoutSeconds?: number;
}) {
  const endpoint = getHealthyEndpoint();
  const server = new Horizon.Server(endpoint);
  const account = await callHorizon(() => server.loadAccount(options.sourceAddress));

  const tx = new TransactionBuilder(account, {
    fee: options.fee || BASE_FEE,
    networkPassphrase: STELLAR_CONFIG.passphrase,
  })
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: options.sendAsset,
        sendMax: options.sendMax,
        destination: options.destinationAddress,
        destAsset: options.destAsset,
        destAmount: options.destAmount,
        path: options.path || [],
      }),
    )
    .setTimeout(options.timeoutSeconds ?? 30)
    .build();

  return tx;
}


/* ─── Account merge (wallet change) ─────────────────────────────────────────
 *
 * A patient who switches wallets has to move every remaining asset out of the
 * old account before it can be retired. On Stellar that is done with the
 * `AccountMerge` operation: the whole native balance of the source account is
 * transferred to the destination account, every subentry of the source is
 * removed and its base reserve is released back to the destination, and the
 * source account itself is deleted.
 *
 * `AccountMerge` itself fails with `ACCOUNT_MERGE_HAS_SUB_ENTRIES` while the
 * source still owns trustlines, data entries, offers or extra signers. The merge
 * transaction therefore first pays every asset balance to the destination,
 * removes each trustline and data entry, and only then merges — all in one
 * atomic transaction. That only works when the destination already holds an
 * authorized trustline with enough headroom for every asset, which is why the
 * helpers below expose an explicit validation step before anything is signed.
 * Offers, extra signers, liquidity pool shares and sponsorships cannot be
 * unwound safely on the patient's behalf and block the merge instead.
 *
 * On-chain medical record pointers live in the data entries of the account
 * that owns them, so they are destroyed by the merge. They therefore have to be
 * re-created on the destination account — with the value pointing at the new
 * public key — *before* the merge transaction is submitted.
 * ────────────────────────────────────────────────────────────────────────── */

/** Base reserve charged by the network for every account subentry (in XLM). */
export const BASE_RESERVE_XLM = 0.5;

/** Minimum balance an account has to keep in order to stay alive (in XLM). */
export const MINIMUM_ACCOUNT_BALANCE_XLM = 1;

/** Prefix Heliora uses for the on-chain medical record pointers. */
export const MEDICAL_RECORD_DATA_KEY_PREFIX = 'medical_record:';

/** Maximum size (bytes) of a Stellar data entry name and of its value. */
export const DATA_ENTRY_MAX_BYTES = 64;

/** Maximum number of operations the network accepts in one transaction. */
export const MAX_OPERATIONS_PER_TRANSACTION = 100;

/** Number of decimals an XLM amount is expressed with. */
export const XLM_DECIMALS = 7;

const STROOPS_PER_XLM = 10 ** XLM_DECIMALS;

/** A trustline (or liquidity pool share) held by an account. */
export interface AccountTrustline {
  assetCode: string;
  assetIssuer: string | null;
  assetType: string;
  balance: string;
  limit: string;
  sponsored: boolean;
  /** `false` when the issuer has not authorized (or has frozen) the trustline. Unset means authorized. */
  authorized?: boolean;
}

/** A data entry with its name and value decoded from base64 to utf-8. */
export interface AccountDataEntry {
  key: string;
  value: string;
}

/** Everything the merge workflow needs to know about an account. */
export interface MergeAccountSnapshot {
  publicKey: string;
  sequence: string;
  nativeBalance: string;
  subentryCount: number;
  trustlines: AccountTrustline[];
  dataEntries: AccountDataEntry[];
  /** Signers besides the master key; each one is a subentry. */
  extraSignerCount?: number;
  /** Ledger entries this account sponsors for others; a sponsor cannot be merged. */
  numSponsoring?: number;
}

/** Result of looking an account up on Horizon. */
export type AccountLookupResult =
  | { status: 'found'; account: MergeAccountSnapshot }
  | { status: 'not-found' }
  | { status: 'error'; message: string };

/** A medical record pointer that has to be re-created on the destination. */
export interface RecordPointerUpdate {
  /** Name the pointer is stored under on the destination account. */
  key: string;
  /** Name the pointer is currently stored under on the source account. */
  previousKey: string;
  /** Value the pointer will hold once it lives on the destination account. */
  value: string;
  /** Value the pointer currently holds on the source account. */
  previousValue: string;
  /** Whether the current value references the account being merged. */
  referencesSource: boolean;
}

/** Plan describing how the medical record pointers are carried over. */
export interface RecordPointerPlan {
  updates: RecordPointerUpdate[];
  blocked: Array<{ key: string; value: string; reason: string }>;
  count: number;
}

/** Outcome of validating a single asset against the destination account. */
export type MergeAssetStatus =
  | 'ready'
  | 'missing-trustline'
  | 'unauthorized-trustline'
  | 'insufficient-limit'
  | 'zero-balance'
  | 'liquidity-pool';

/** Validation result for one asset held by the account being merged. */
export interface MergeAssetCheck {
  assetCode: string;
  assetIssuer: string | null;
  assetType: string;
  sourceBalance: string;
  destinationBalance: string | null;
  destinationLimit: string | null;
  status: MergeAssetStatus;
  required: boolean;
  message: string;
}

/** One operation of the merge transaction, as shown in the final breakdown. */
export interface MergeOperationSummary {
  type: 'payment' | 'changeTrust' | 'manageData' | 'accountMerge';
  description: string;
}

/** Full breakdown of what an `AccountMerge` will do. */
export interface AccountMergePlan {
  source: MergeAccountSnapshot;
  destination: MergeAccountSnapshot;
  assets: MergeAssetCheck[];
  pointers: RecordPointerPlan;
  /** Every operation of the merge transaction, in submission order. */
  operations: MergeOperationSummary[];
  mergeFeeXlm: string;
  pointerFeeXlm: string;
  xlmTransferredXlm: string;
  reclaimableReserveXlm: string;
  destinationBalanceAfterXlm: string;
  blockers: string[];
  warnings: string[];
}

/** Decodes a base64 payload into a utf-8 string. */
export function decodeBase64Utf8(value: string): string {
  try {
    const binary = typeof atob === 'function' ? atob(value) : '';
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder().decode(bytes);
    }
    let decoded = '';
    for (let i = 0; i < bytes.length; i += 1) {
      decoded += String.fromCharCode(bytes[i] ?? 0);
    }
    return decoded;
  } catch {
    return '';
  }
}

/** Converts an XLM amount into stroops without losing precision. */
export function xlmToStroops(xlm: string): bigint {
  return toScaledAmount(xlm, XLM_DECIMALS);
}

/** Converts stroops into an XLM amount. */
export function stroopsToXlm(stroops: bigint | number): string {
  return formatScaledAmount(BigInt(stroops), XLM_DECIMALS);
}

function toScaledAmount(value: string, decimals: number): bigint {
  const trimmed = (value ?? '').trim();
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [wholeRaw = '0', fractionRaw = ''] = unsigned.split('.');
  const whole = BigInt(wholeRaw || '0');
  const fraction = BigInt((fractionRaw + '0'.repeat(decimals)).slice(0, decimals) || '0');
  const magnitude = whole * 10n ** BigInt(decimals) + fraction;
  return negative ? -magnitude : magnitude;
}

function formatScaledAmount(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const whole = magnitude / divisor;
  const fraction = magnitude % divisor;
  const fractionPart = decimals > 0 ? `.${fraction.toString().padStart(decimals, '0')}` : '';
  return `${negative ? '-' : ''}${whole}${fractionPart}`;
}

/**
 * Compares two decimal amounts. Returns -1, 0 or 1.
 *
 * Stellar classic assets carry at most seven decimals, so seven is used as the
 * default scale for every amount that is compared or subtracted here.
 */
export function compareAmounts(a: string, b: string, decimals = 7): number {
  const diff = toScaledAmount(a, decimals) - toScaledAmount(b, decimals);
  if (diff < 0n) return -1;
  if (diff > 0n) return 1;
  return 0;
}

/** Subtracts `b` from `a`; both are plain decimal strings. */
export function subtractAmounts(a: string, b: string, decimals = 7): string {
  return formatScaledAmount(toScaledAmount(a, decimals) - toScaledAmount(b, decimals), decimals);
}

/** Adds `b` to `a`; both are plain decimal strings. */
export function addAmounts(a: string, b: string, decimals = 7): string {
  return formatScaledAmount(toScaledAmount(a, decimals) + toScaledAmount(b, decimals), decimals);
}

function readDataEntries(account: Horizon.AccountResponse): Record<string, string> {
  const candidate = account as unknown as { data?: unknown; data_attr?: unknown };
  if (candidate.data_attr && typeof candidate.data_attr === 'object') {
    return candidate.data_attr as Record<string, string>;
  }
  if (candidate.data && typeof candidate.data === 'object') {
    return candidate.data as Record<string, string>;
  }
  return {};
}

function toMergeAccountSnapshot(account: Horizon.AccountResponse): MergeAccountSnapshot {
  const trustlines: AccountTrustline[] = [];
  let nativeBalance = '0';

  for (const balance of account.balances) {
    if (balance.asset_type === 'native') {
      nativeBalance = balance.balance;
      continue;
    }
    const isLiquidityPool = balance.asset_type === 'liquidity_pool_shares';
    const line = balance as HorizonApiBalanceLine;
    trustlines.push({
      assetCode: isLiquidityPool ? (line.liquidity_pool_id ?? '') : (line.asset_code ?? ''),
      assetIssuer: isLiquidityPool ? null : (line.asset_issuer ?? null),
      assetType: balance.asset_type,
      balance: balance.balance,
      limit: line.limit ?? '0',
      sponsored: Boolean(line.sponsor),
      authorized: line.is_authorized ?? true,
    });
  }

  const dataEntries: AccountDataEntry[] = Object.entries(readDataEntries(account)).map(
    ([name, value]) => ({
      key: decodeBase64Utf8(name),
      value: decodeBase64Utf8(value),
    }),
  );

  return {
    publicKey: account.account_id,
    sequence: account.sequence,
    nativeBalance,
    subentryCount: account.subentry_count ?? 0,
    trustlines,
    dataEntries,
    extraSignerCount: Math.max(0, (account.signers?.length ?? 1) - 1),
    numSponsoring: account.num_sponsoring ?? 0,
  };
}

type HorizonApiBalanceLine = {
  asset_code?: string;
  asset_issuer?: string;
  liquidity_pool_id?: string;
  limit?: string;
  sponsor?: string;
  is_authorized?: boolean;
};

const utf8ByteLength = (value: string) => new TextEncoder().encode(value).length;
const isPoolShare = (line: AccountTrustline) => line.assetType === 'liquidity_pool_shares';

/** Looks an account up on Horizon, falling back across the configured endpoints. */
export async function lookupMergeAccount(publicKey: string): Promise<AccountLookupResult> {
  let lastError: unknown;

  for (const url of STELLAR_CONFIG.endpoints) {
    try {
      const account = await new Horizon.Server(url).loadAccount(publicKey);
      return { status: 'found', account: toMergeAccountSnapshot(account) };
    } catch (err: unknown) {
      lastError = err;
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        return { status: 'not-found' };
      }
    }
  }

  return {
    status: 'error',
    message:
      lastError instanceof Error
        ? lastError.message
        : 'Unable to reach the Stellar network. Check your connection and try again.',
  };
}

/**
 * Works out which medical record pointers have to be carried over to the
 * destination account before the source account is merged.
 *
 * A data entry is treated as a medical record pointer when it is stored under
 * the Heliora record prefix or when its value references the account that is
 * about to be closed. The pointer is rewritten so that it references the new
 * public key instead of the old one.
 */
export function buildRecordPointerPlan(
  source: MergeAccountSnapshot,
  sourcePublicKey: string,
  destinationPublicKey: string,
): RecordPointerPlan {
  const updates: RecordPointerUpdate[] = [];
  const blocked: Array<{ key: string; value: string; reason: string }> = [];

  for (const entry of source.dataEntries) {
    const referencesSource = entry.value.includes(sourcePublicKey);
    const isRecordPointer = entry.key.startsWith(MEDICAL_RECORD_DATA_KEY_PREFIX);
    if (!referencesSource && !isRecordPointer) continue;

    const nextKey = entry.key.split(sourcePublicKey).join(destinationPublicKey);
    const nextValue = entry.value.split(sourcePublicKey).join(destinationPublicKey);

    if (utf8ByteLength(nextKey) > DATA_ENTRY_MAX_BYTES) {
      blocked.push({
        key: entry.key,
        value: entry.value,
        reason:
          'The pointer name is longer than 64 bytes and cannot be rewritten on the new account.',
      });
      continue;
    }

    if (utf8ByteLength(nextValue) > DATA_ENTRY_MAX_BYTES) {
      blocked.push({
        key: entry.key,
        value: entry.value,
        reason:
          'The pointer value is longer than 64 bytes and cannot be rewritten on the new account.',
      });
      continue;
    }

    updates.push({
      key: nextKey,
      previousKey: entry.key,
      value: nextValue,
      previousValue: entry.value,
      referencesSource,
    });
  }

  return { updates, blocked, count: updates.length };
}

/**
 * Validates that the destination account can receive every asset of the source
 * account and computes the final transaction breakdown.
 */
export function planAccountMerge(
  source: MergeAccountSnapshot,
  destination: MergeAccountSnapshot,
  sourcePublicKey: string,
  destinationPublicKey: string,
): AccountMergePlan {
  const assets: MergeAssetCheck[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const line of source.trustlines) {
    const destinationLine = destination.trustlines.find(
      (candidate) =>
        candidate.assetCode === line.assetCode && candidate.assetIssuer === line.assetIssuer,
    );
    const assetLabel = line.assetIssuer ? `${line.assetCode}:${line.assetIssuer}` : line.assetCode;
    const hasBalance = compareAmounts(line.balance, '0') > 0;

    if (isPoolShare(line)) {
      assets.push({
        assetCode: line.assetCode,
        assetIssuer: null,
        assetType: line.assetType,
        sourceBalance: line.balance,
        destinationBalance: null,
        destinationLimit: null,
        status: 'liquidity-pool',
        required: true,
        message: `Withdraw from liquidity pool ${line.assetCode} and remove its trustline before merging.`,
      });
      blockers.push(`Withdraw your liquidity pool shares (${line.assetCode}) before merging.`);
      continue;
    }

    if (line.authorized === false && hasBalance) {
      blockers.push(
        `The issuer of ${assetLabel} has frozen the old account's trustline, so its balance cannot be moved.`,
      );
    }

    if (!destinationLine) {
      assets.push({
        assetCode: line.assetCode,
        assetIssuer: line.assetIssuer,
        assetType: line.assetType,
        sourceBalance: line.balance,
        destinationBalance: null,
        destinationLimit: null,
        status: hasBalance ? 'missing-trustline' : 'zero-balance',
        required: hasBalance,
        message: hasBalance
          ? `The new account has no trustline for ${assetLabel}. Add one with a limit of at least ${line.balance} before merging.`
          : `The new account has no trustline for ${assetLabel}. The old balance is 0, so nothing is transferred.`,
      });

      if (hasBalance) {
        blockers.push(`The new account has no trustline for ${assetLabel}.`);
      } else {
        warnings.push(`The new account has no trustline for ${assetLabel} (old balance is 0).`);
      }
      continue;
    }

    const available = subtractAmounts(destinationLine.limit, destinationLine.balance);
    const sufficient = compareAmounts(available, line.balance) >= 0;
    const active = destinationLine.authorized !== false;

    assets.push({
      assetCode: line.assetCode,
      assetIssuer: line.assetIssuer,
      assetType: line.assetType,
      sourceBalance: line.balance,
      destinationBalance: destinationLine.balance,
      destinationLimit: destinationLine.limit,
      status: !active ? 'unauthorized-trustline' : sufficient ? 'ready' : 'insufficient-limit',
      required: hasBalance,
      message: !active
        ? `The issuer of ${assetLabel} has not authorized the new account's trustline yet.`
        : sufficient
          ? `${assetLabel} can be transferred. The new account has ${available} ${assetLabel} of headroom left.`
          : `The trustline limit for ${assetLabel} on the new account only leaves room for ${available}, but ${line.balance} has to be transferred.`,
    });

    if (hasBalance && !active) {
      blockers.push(`The new account's trustline for ${assetLabel} is not authorized by the issuer.`);
    } else if (!sufficient) {
      blockers.push(`The trustline limit for ${assetLabel} on the new account is too low.`);
    }
  }

  if ((source.numSponsoring ?? 0) > 0) {
    blockers.push(
      `The old account sponsors ${source.numSponsoring} ledger entr${source.numSponsoring === 1 ? 'y' : 'ies'} for other accounts. Transfer or revoke those sponsorships first.`,
    );
  }

  const extraSigners = source.extraSignerCount ?? 0;
  if (extraSigners > 0) {
    blockers.push(
      `Remove the ${extraSigners} additional signer(s) from the old account before merging.`,
    );
  }

  // Pool share trustlines hold two subentries each; whatever is left over are open DEX offers.
  const explainedSubentries =
    source.trustlines.reduce((sum, line) => sum + (isPoolShare(line) ? 2 : 1), 0) +
    source.dataEntries.length +
    extraSigners;
  const openOffers = source.subentryCount - explainedSubentries;
  if (openOffers > 0) {
    blockers.push(`Cancel the ${openOffers} open DEX offer(s) of the old account before merging.`);
  }

  const pointers = buildRecordPointerPlan(source, sourcePublicKey, destinationPublicKey);
  if (pointers.blocked.length > 0) {
    blockers.push(
      `${pointers.blocked.length} medical record pointer(s) cannot be reassigned automatically.`,
    );
  }

  const operations = describeMergeOperations(source, destinationPublicKey);
  if (operations.length > MAX_OPERATIONS_PER_TRANSACTION) {
    blockers.push(
      `Closing the old account needs ${operations.length} operations, more than the ${MAX_OPERATIONS_PER_TRANSACTION} allowed in one transaction.`,
    );
  }

  const mergeFeeStroops = BigInt(BASE_FEE) * BigInt(operations.length);
  const pointerFeeStroops = BigInt(BASE_FEE) * BigInt(pointers.updates.length);
  const sourceStroops = xlmToStroops(source.nativeBalance);
  const minimumBalanceStroops =
    xlmToStroops(String(MINIMUM_ACCOUNT_BALANCE_XLM)) + reserveStroops(source.subentryCount);

  if (sourceStroops < mergeFeeStroops) {
    blockers.push('The old account does not hold enough XLM to pay the transaction fee.');
  } else if (sourceStroops < minimumBalanceStroops) {
    warnings.push(
      'The old account is close to the minimum balance. The network may reject the merge until it is funded.',
    );
  }

  if (pointers.updates.length > 0) {
    const pointerReserveStroops = reserveStroops(pointers.updates.length) + pointerFeeStroops;
    if (xlmToStroops(destination.nativeBalance) < pointerReserveStroops) {
      warnings.push(
        'The new account may not hold enough XLM to store the reassigned record pointers and pay their fee.',
      );
    }
  }

  // The native balance already includes the reserve locked by subentries, so the
  // reclaimed reserve is part of the transferred amount, not an extra credit.
  const transferredStroops = sourceStroops > mergeFeeStroops ? sourceStroops - mergeFeeStroops : 0n;
  const reclaimableStroops = reserveStroops(source.subentryCount);

  return {
    source,
    destination,
    assets,
    pointers,
    operations,
    mergeFeeXlm: stroopsToXlm(mergeFeeStroops),
    pointerFeeXlm: stroopsToXlm(pointerFeeStroops),
    xlmTransferredXlm: stroopsToXlm(transferredStroops),
    reclaimableReserveXlm: stroopsToXlm(reclaimableStroops),
    destinationBalanceAfterXlm: stroopsToXlm(
      xlmToStroops(destination.nativeBalance) + transferredStroops,
    ),
    blockers,
    warnings,
  };
}

/** Base reserve held by `subentries` subentries, expressed in stroops. */
function reserveStroops(subentries: number): bigint {
  return BigInt(Math.round(subentries * BASE_RESERVE_XLM * STROOPS_PER_XLM));
}

const lineAsset = (line: AccountTrustline) => new Asset(line.assetCode, line.assetIssuer ?? undefined);
const lineLabel = (line: AccountTrustline) =>
  line.assetIssuer ? `${line.assetCode}:${line.assetIssuer}` : line.assetCode;

/**
 * Lists the operations of the merge transaction in submission order: pay out
 * every asset balance, remove every trustline and data entry, then merge.
 */
export function describeMergeOperations(
  source: Pick<MergeAccountSnapshot, 'trustlines' | 'dataEntries' | 'nativeBalance'>,
  destinationPublicKey: string,
): MergeOperationSummary[] {
  const lines = source.trustlines.filter((line) => !isPoolShare(line));
  return [
    ...lines
      .filter((line) => compareAmounts(line.balance, '0') > 0)
      .map((line) => ({
        type: 'payment' as const,
        description: `Send ${line.balance} ${lineLabel(line)} to the new wallet`,
      })),
    ...lines.map((line) => ({
      type: 'changeTrust' as const,
      description: `Remove the ${lineLabel(line)} trustline`,
    })),
    ...source.dataEntries.map((entry) => ({
      type: 'manageData' as const,
      description: `Delete data entry ${entry.key}`,
    })),
    {
      type: 'accountMerge' as const,
      description: `Merge ${source.nativeBalance} XLM into ${destinationPublicKey}`,
    },
  ];
}

/**
 * Builds the transaction that closes the source account and funds the destination.
 * Pass the source's current `trustlines` and `dataEntries`: they are emptied in the
 * same transaction, because `AccountMerge` rejects an account that still has subentries.
 * `fee` is the per-operation base fee.
 */
export function buildAccountMergeTransaction(options: {
  sourcePublicKey: string;
  sourceSequence: string;
  destinationPublicKey: string;
  trustlines?: AccountTrustline[];
  dataEntries?: AccountDataEntry[];
  fee?: string;
}) {
  const source = new Account(options.sourcePublicKey, options.sourceSequence);
  const builder = new TransactionBuilder(source, {
    fee: options.fee ?? String(BASE_FEE),
    networkPassphrase: STELLAR_CONFIG.passphrase,
  });
  const lines = (options.trustlines ?? []).filter((line) => !isPoolShare(line));

  for (const line of lines) {
    if (compareAmounts(line.balance, '0') > 0) {
      builder.addOperation(
        Operation.payment({
          destination: options.destinationPublicKey,
          asset: lineAsset(line),
          amount: line.balance,
        }),
      );
    }
  }
  for (const line of lines) {
    builder.addOperation(Operation.changeTrust({ asset: lineAsset(line), limit: '0' }));
  }
  for (const entry of options.dataEntries ?? []) {
    builder.addOperation(Operation.manageData({ name: entry.key, value: null }));
  }

  return builder
    .addOperation(Operation.accountMerge({ destination: options.destinationPublicKey }))
    .setTimeout(SOROBAN_TX_TIMEOUT_SECONDS)
    .build();
}

/**
 * Returns the pointer updates that are not (yet) stored on `destination` with
 * their expected value. The merge must not run while this list is non-empty,
 * because the merge deletes the source's copies of the pointers.
 */
export function findMissingRecordPointers(
  destination: MergeAccountSnapshot,
  updates: RecordPointerUpdate[],
): RecordPointerUpdate[] {
  const stored = new Map(destination.dataEntries.map((entry) => [entry.key, entry.value]));
  return updates.filter((update) => stored.get(update.key) !== update.value);
}

/**
 * Builds the transaction that re-creates the medical record pointers on the
 * destination account. It is signed by the destination account, so it has to be
 * submitted before the merge transaction.
 */
export function buildRecordPointerTransaction(options: {
  destinationPublicKey: string;
  destinationSequence: string;
  updates: RecordPointerUpdate[];
  fee?: string;
}) {
  const source = new Account(options.destinationPublicKey, options.destinationSequence);
  const builder = new TransactionBuilder(source, {
    fee: options.fee ?? String(BASE_FEE),
    networkPassphrase: STELLAR_CONFIG.passphrase,
  });

  for (const update of options.updates) {
    builder.addOperation(Operation.manageData({ name: update.key, value: update.value }));
  }

  return builder.setTimeout(SOROBAN_TX_TIMEOUT_SECONDS).build();
}

/** Submits a signed transaction to Horizon and returns its hash. */
export async function submitTransaction(
  transaction: Transaction | FeeBumpTransaction,
): Promise<string> {
  const server = new Horizon.Server(getHealthyEndpoint());
  const result = await server.submitTransaction(transaction);
  return result.hash;
}

/** Polls Horizon until the transaction is confirmed (or the attempts run out). */
export async function waitForTransactionConfirmation(
  hash: string,
  options: { attempts?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const attempts = options.attempts ?? 30;
  const intervalMs = options.intervalMs ?? 2000;
  const server = new Horizon.Server(getHealthyEndpoint());

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const transaction = await server.transactions().transaction(hash).call();
      return transaction.successful;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return false;
}

/**
 * Confirms that an account has been closed: a merged account no longer exists
 * on the ledger, so Horizon answers with a 404.
 */
export async function confirmAccountClosed(publicKey: string): Promise<boolean> {
  const result = await lookupMergeAccount(publicKey);
  return result.status === 'not-found';
}
