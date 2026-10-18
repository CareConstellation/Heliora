import { Networks } from '@stellar/stellar-sdk';
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

const HEALTH_CHECK_INTERVAL = 30000;
const LATENCY_THRESHOLD_MS = 2500;
const MAX_FAILURES = 3;

let endpointHealth: Map<string, EndpointHealth> = new Map();

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

async function checkEndpointHealth(url: string): Promise<number> {
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
    ? healthyEndpoints[0].url
    : STELLAR_CONFIG.endpoints[0];
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
