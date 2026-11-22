import {
  BASE_FEE,
  hash as sha256,
  Keypair,
  Memo,
  Networks,
  StrKey,
  TransactionBuilder,
  rpc,
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

const TESTNET_ENDPOINTS = [
  'https://horizon-testnet.stellar.org',
  'https://testnet.stellar.lobstr.co',
  'https://stellar-testnet.blockdaemon.com',
];

const MAINNET_ENDPOINTS = [
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
  horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL || endpoints[0]!,
  endpoints,
  passphrase: isMainnet ? Networks.PUBLIC : Networks.TESTNET,
  // SDF hosts a public Soroban RPC for testnet only; mainnet needs a provider URL.
  sorobanRpcUrl:
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || (isMainnet ? '' : 'https://soroban-testnet.stellar.org'),
};

function initializeEndpointHealth() {
  if (endpointHealth.size === 0) {
    STELLAR_CONFIG.endpoints.forEach(url => {
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
    .filter(h => h.isHealthy)
    .sort((a, b) => {
      const aLatency = a.lastLatency ?? LATENCY_THRESHOLD_MS;
      const bLatency = b.lastLatency ?? LATENCY_THRESHOLD_MS;
      return aLatency - bLatency;
    });

  return healthyEndpoints.length > 0
    ? healthyEndpoints[0]!.url
    : STELLAR_CONFIG.endpoints[0]!;
}

export function resetEndpointFailure(url: string) {
  const health = endpointHealth.get(url);
  if (health) {
    health.failureCount = 0;
    health.isHealthy = true;
  }
}

export class HorizonRequestError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
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
    .map(h => h.url);

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
      throw new HorizonRequestError('Unable to reach the Stellar network. Check your connection and try again.', err);
    }
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 429) {
      throw new HorizonRequestError('Stellar network rate limit reached. Please try again shortly.', err);
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
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await callHorizon(fn);
      } catch (err) {
        const message = err instanceof HorizonRequestError ? err.message : 'Failed to communicate with the Stellar network.';
        toast(message, 'error');
        return undefined;
      }
    },
    [toast]
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
export const freighterSigner: TransactionSigner = async (envelopeXdr, networkPassphrase, address) => {
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
  if (!STELLAR_CONFIG.sorobanRpcUrl) throw new Error('NEXT_PUBLIC_SOROBAN_RPC_URL is not configured.');
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
  const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr, STELLAR_CONFIG.passphrase));
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


/* ─── Soroban Admin Protocol Parameters & Fee Adjustment (#163) ───────── */

export interface ProtocolParameters {
  platformFeePercent: number; // e.g. 2.5% (range: 0 to 100)
  platformFeeBps: number; // e.g. 250 bps
  settlementAsset: string; // e.g. 'native', 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
  oracleAddress: string; // Stellar account or contract address
  maxDailyClaimPayout: string; // e.g. '50000'
  emergencyPause: boolean;
  requiredMultisigSigners: number;
}

export const CURRENT_PROTOCOL_PARAMETERS: ProtocolParameters = {
  platformFeePercent: 2.5,
  platformFeeBps: 250,
  settlementAsset: 'native (XLM)',
  oracleAddress: 'CBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  maxDailyClaimPayout: '50000 XLM',
  emergencyPause: false,
  requiredMultisigSigners: 2,
};

export async function assembleAdminConfigEnvelope(
  source: string,
  contractId: string,
  newParams: ProtocolParameters,
): Promise<{ xdr: string; hashPreview: string }> {
  if (typeof newParams.platformFeePercent !== 'number' || newParams.platformFeePercent < 0 || newParams.platformFeePercent > 100) {
    throw new Error('Platform fee must be a number between 0% and 100%.');
  }

  const trimmedOracle = (newParams.oracleAddress || '').trim();
  if (!trimmedOracle || !/^([CG][A-Z2-7]{55})$/.test(trimmedOracle)) {
    throw new Error('Invalid oracle address: must be a 56-character Stellar public key (G...) or contract address (C...).');
  }

  const payload = {
    contractId: contractId || 'CHELIORAPROTOCOLPARAMS110CONTRACTID55CHARS00000000000000',
    method: 'update_protocol_parameters',
    source: source || 'GADMINHELIORA55CHARS0000000000000000000000000000000000000',
    parameters: {
      platform_fee_bps: Math.round(newParams.platformFeePercent * 100),
      settlement_asset: newParams.settlementAsset,
      oracle_address: trimmedOracle,
      max_daily_claim_payout: newParams.maxDailyClaimPayout,
      emergency_pause: newParams.emergencyPause,
    },
    multisig_threshold: newParams.requiredMultisigSigners,
    networkPassphrase: STELLAR_CONFIG.passphrase,
    assembledAt: new Date().toISOString(),
  };

  const jsonStr = JSON.stringify(payload);
  const xdr = typeof window !== 'undefined' ? btoa(jsonStr) : Buffer.from(jsonStr).toString('base64');
  const hashPreview = `tx_${Date.now().toString(16)}${Math.random().toString(36).substring(2, 8)}`;

  return { xdr, hashPreview };
}


const FEDERATION_DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
const FEDERATED_ADDRESS_PATTERN = /^([A-Za-z0-9_.-]+)\*([A-Za-z0-9.-]+)$/;
const FEDERATION_TIMEOUT_MS = 5000;
const FEDERATION_MEMO_TYPES = ['text', 'id', 'hash', 'return'] as const;
const MAX_FEDERATION_TEXT_MEMO_BYTES = 28;
const MAX_FEDERATION_ID_MEMO = 18446744073709551615n;

const federationServerCache = new Map<string, Promise<string>>();
const reverseFederationCache = new Map<string, Promise<string | null>>();

export type FederationMemoType = (typeof FEDERATION_MEMO_TYPES)[number];

export interface FederatedAddress {
  name: string;
  domain: string;
  address: string;
}

export interface FederationResolution {
  address: string;
  publicKey: string;
  memoType: FederationMemoType | null;
  memo: string | null;
}

export class FederationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FederationError';
  }
}

export function getFederationDomain(): string {
  return (process.env.NEXT_PUBLIC_FEDERATION_DOMAIN || 'heliora.io').trim().toLowerCase();
}

function isValidFederationDomain(value: string): boolean {
  return value === 'localhost' || FEDERATION_DOMAIN_PATTERN.test(value);
}

export function parseFederatedAddress(value: string): FederatedAddress | null {
  const match = FEDERATED_ADDRESS_PATTERN.exec(value.trim());
  if (!match) return null;
  const name = match[1]!;
  const domain = match[2]!.toLowerCase();
  if (!isValidFederationDomain(domain)) return null;
  return { name, domain, address: `${name}*${domain}` };
}

export function isFederatedAddress(value: string): boolean {
  return parseFederatedAddress(value) !== null;
}

function normalizeFederationServerUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
  ) {
    return null;
  }
  return url.toString().replace(/\/+$/, '');
}

export function parseFederationServerFromToml(toml: string): string | null {
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const match = /^FEDERATION_SERVER\s*=\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/.exec(line);
    if (!match) continue;
    const url = normalizeFederationServerUrl((match[1] ?? match[2] ?? match[3] ?? '').trim());
    if (url) return url;
  }
  return null;
}

export async function getFederationServer(domain: string): Promise<string> {
  const normalized = domain.trim().toLowerCase();
  if (!isValidFederationDomain(normalized)) {
    throw new FederationError(`“${domain}” is not a valid federation domain.`);
  }

  let cached = federationServerCache.get(normalized);
  if (!cached) {
    cached = (async () => {
      let response: Response;
      try {
        response = await fetch(`https://${normalized}/.well-known/stellar.toml`, {
          headers: { Accept: 'text/plain' },
          signal: AbortSignal.timeout(FEDERATION_TIMEOUT_MS),
        });
      } catch (err) {
        throw new FederationError(
          `Could not read the federation configuration for ${normalized}.`,
          err,
        );
      }
      if (!response.ok) {
        throw new FederationError(
          `${normalized} does not publish a stellar.toml federation server (HTTP ${response.status}).`,
        );
      }
      let toml: string;
      try {
        toml = await response.text();
      } catch (err) {
        throw new FederationError(
          `Could not read the federation configuration for ${normalized}.`,
          err,
        );
      }
      const server = parseFederationServerFromToml(toml);
      if (!server) {
        throw new FederationError(`${normalized} does not publish a federation server.`);
      }
      return server;
    })();
    cached.catch(() => federationServerCache.delete(normalized));
    federationServerCache.set(normalized, cached);
  }
  return cached;
}

export function clearFederationCache(): void {
  federationServerCache.clear();
  reverseFederationCache.clear();
}

interface FederationResponse {
  stellar_address?: unknown;
  account_id?: unknown;
  memo_type?: unknown;
  memo?: unknown;
}

async function queryFederationServer(
  server: string,
  query: string,
  type: 'name' | 'id',
): Promise<FederationResponse | null> {
  const url = new URL(server);
  url.searchParams.set('q', query);
  url.searchParams.set('type', type);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FEDERATION_TIMEOUT_MS),
    });
  } catch (err) {
    throw new FederationError('Could not reach the federation server.', err);
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new FederationError(`Federation server returned HTTP ${response.status}.`);
  }
  try {
    return (await response.json()) as FederationResponse;
  } catch (err) {
    throw new FederationError('Federation server returned invalid JSON.', err);
  }
}

function normalizeFederationMemo(
  memoType: unknown,
  memo: unknown,
): Pick<FederationResolution, 'memoType' | 'memo'> {
  if (memoType == null && memo == null) return { memoType: null, memo: null };
  if (
    typeof memoType !== 'string' ||
    !FEDERATION_MEMO_TYPES.includes(memoType as FederationMemoType) ||
    typeof memo !== 'string' ||
    !memo
  ) {
    throw new FederationError('The federation server returned an invalid memo requirement.');
  }

  let valid = false;
  switch (memoType) {
    case 'text':
      valid = new TextEncoder().encode(memo).length <= MAX_FEDERATION_TEXT_MEMO_BYTES;
      break;
    case 'id':
      valid = /^\d+$/.test(memo) && BigInt(memo) <= MAX_FEDERATION_ID_MEMO;
      break;
    case 'hash':
    case 'return':
      valid = /^[0-9a-fA-F]{64}$/.test(memo);
      break;
  }
  if (!valid)
    throw new FederationError('The federation server returned an invalid memo requirement.');
  return { memoType: memoType as FederationMemoType, memo };
}

export async function resolveFederatedAddress(address: string): Promise<FederationResolution> {
  const parsed = parseFederatedAddress(address);
  if (!parsed) {
    throw new FederationError('Enter a federated address in the format name*domain.com.');
  }

  const server = await getFederationServer(parsed.domain);
  const record = await queryFederationServer(server, parsed.address, 'name');
  if (!record) throw new FederationError(`No Stellar account is registered for ${parsed.address}.`);
  if (typeof record.account_id !== 'string' || !StrKey.isValidEd25519PublicKey(record.account_id)) {
    throw new FederationError('The federation server returned an invalid Stellar public key.');
  }
  if (
    typeof record.stellar_address === 'string' &&
    record.stellar_address.toLowerCase() !== parsed.address.toLowerCase()
  ) {
    throw new FederationError('The federation server returned a different federated address.');
  }

  return {
    address: parsed.address,
    publicKey: record.account_id,
    ...normalizeFederationMemo(record.memo_type, record.memo),
  };
}

export async function resolveWalletAddress(value: string): Promise<FederationResolution> {
  const input = value.trim();
  if (!input) throw new FederationError('Enter a Stellar address.');
  if (StrKey.isValidEd25519PublicKey(input)) {
    return { address: input, publicKey: input, memoType: null, memo: null };
  }
  return resolveFederatedAddress(input);
}

export function createFederationMemo(resolution: FederationResolution): Memo | undefined {
  if (!resolution.memoType || !resolution.memo) return undefined;
  switch (resolution.memoType) {
    case 'text':
      return Memo.text(resolution.memo);
    case 'id':
      return Memo.id(resolution.memo);
    case 'hash':
      return Memo.hash(resolution.memo);
    case 'return':
      return Memo.return(resolution.memo);
  }
}

export async function lookupFederationByAccount(
  publicKey: string,
  domain: string = getFederationDomain(),
): Promise<string | null> {
  if (!StrKey.isValidEd25519PublicKey(publicKey.trim())) {
    throw new FederationError('Reverse federation requires a valid Stellar public key.');
  }
  const account = publicKey.trim();
  const normalizedDomain = domain.trim().toLowerCase();
  const cacheKey = `${normalizedDomain}|${account}`;
  let cached = reverseFederationCache.get(cacheKey);
  if (!cached) {
    cached = (async () => {
      const server = await getFederationServer(normalizedDomain);
      const record = await queryFederationServer(server, account, 'id');
      if (!record) return null;
      if (record.account_id !== account) {
        throw new FederationError('The federation server returned a different Stellar account.');
      }
      if (typeof record.stellar_address !== 'string') return null;
      return parseFederatedAddress(record.stellar_address)?.address ?? null;
    })();
    cached.catch(() => reverseFederationCache.delete(cacheKey));
    reverseFederationCache.set(cacheKey, cached);
  }
  return cached;
}
