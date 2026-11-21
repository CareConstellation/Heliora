import { BASE_FEE, Networks, TransactionBuilder, rpc, type xdr } from '@stellar/stellar-sdk';
import { signTransaction } from '@stellar/freighter-api';
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
