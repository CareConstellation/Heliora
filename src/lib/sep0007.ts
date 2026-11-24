import QRCode from 'qrcode';
import { TransactionBuilder } from '@stellar/stellar-sdk';
import { STELLAR_CONFIG, callHorizonWithFallback } from './stellar';

export interface SEP0007TransactionRequest {
  xdr: string;
  callback?: string;
  chainId?: string;
  networkPassphrase?: string;
  pubkey?: string;
  message?: string;
}

export interface QRCodeData {
  uri: string;
  dataUrl: string;
}

export interface StreamConfirmationOptions {
  hash: string;
  horizonUrl?: string;
  onConfirmed: (tx: { hash: string; ledger: number }) => void;
  onError?: (error: Error) => void;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

/**
 * Generates a SEP-0007 compliant transaction URI.
 * Format: web+stellar:tx?xdr=<base64-xdr>&callback=<url>&chain_id=<network>&msg=<message>&pubkey=<pubkey>
 */
export function generateSEP0007URI(request: SEP0007TransactionRequest): string {
  const params = new URLSearchParams();
  params.append('xdr', request.xdr);

  if (request.callback) {
    params.append('callback', request.callback);
  }
  if (request.chainId) {
    params.append('chain_id', request.chainId);
  }
  if (request.networkPassphrase) {
    params.append('network_passphrase', request.networkPassphrase);
  }
  if (request.pubkey) {
    params.append('pubkey', request.pubkey);
  }
  if (request.message) {
    params.append('msg', request.message);
  }

  return `web+stellar:tx?${params.toString()}`;
}

/**
 * Parses a SEP-0007 transaction URI into a structured request object.
 * Validates presence of the mandatory `xdr` parameter.
 */
export function parseSEP0007URI(uriString: string): SEP0007TransactionRequest {
  const trimmed = uriString.trim();
  const txPrefixPattern = /^(web\+stellar|stellar):(?:\/\/)?tx\?(.*)$/i;
  const match = trimmed.match(txPrefixPattern);

  if (!match || !match[2]) {
    throw new Error('SEP-0007: Invalid URI scheme. Expected web+stellar:tx?... or stellar:tx?...');
  }

  const searchParams = new URLSearchParams(match[2]);
  const xdr = searchParams.get('xdr');

  if (!xdr) {
    throw new Error('SEP-0007: Missing required "xdr" parameter in URI.');
  }

  const callback = searchParams.get('callback') || searchParams.get('url:callback') || undefined;
  const chainId = searchParams.get('chain_id') || undefined;
  const networkPassphrase = searchParams.get('network_passphrase') || undefined;
  const pubkey = searchParams.get('pubkey') || undefined;
  const message = searchParams.get('msg') || searchParams.get('message') || undefined;

  return {
    xdr,
    ...(callback ? { callback } : {}),
    ...(chainId ? { chainId } : {}),
    ...(networkPassphrase ? { networkPassphrase } : {}),
    ...(pubkey ? { pubkey } : {}),
    ...(message ? { message } : {}),
  };
}

/**
 * Computes the transaction hash from an unsigned or signed transaction envelope XDR.
 */
export function getTransactionHashFromXDR(
  xdrString: string,
  networkPassphrase = STELLAR_CONFIG.passphrase,
): string {
  const tx = TransactionBuilder.fromXDR(xdrString, networkPassphrase);
  return tx.hash().toString('hex');
}

/**
 * Generates a high-density QR code containing the SEP-0007 URI.
 */
export async function generateQRCode(
  request: SEP0007TransactionRequest,
  options: { width?: number; errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' } = {},
): Promise<QRCodeData> {
  const uri = generateSEP0007URI(request);
  const dataUrl = await QRCode.toDataURL(uri, {
    width: options.width ?? 320,
    errorCorrectionLevel: options.errorCorrectionLevel ?? 'H',
    margin: 2,
    color: {
      dark: '#030D09',
      light: '#FFFFFF',
    },
  });

  return { uri, dataUrl };
}

/**
 * Streams Horizon transaction events via Server-Sent Events (SSE) with fallback polling
 * to confirm transaction submission on-chain.
 */
export function streamHorizonTransaction(options: StreamConfirmationOptions): () => void {
  const {
    hash,
    horizonUrl = STELLAR_CONFIG.horizonUrl,
    onConfirmed,
    onError,
    timeoutMs = 120_000,
    pollIntervalMs = 2_000,
  } = options;

  const targetHash = hash.toLowerCase();
  let isDone = false;
  let eventSource: EventSource | null = null;
  let pollIntervalId: ReturnType<typeof setInterval> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    isDone = true;
    if (eventSource) {
      try {
        eventSource.close();
      } catch {
        // Ignore close errors
      }
      eventSource = null;
    }
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const handleSuccess = (txHash: string, ledger: number) => {
    if (isDone) return;
    cleanup();
    onConfirmed({ hash: txHash, ledger });
  };

  // 1. Direct query helper
  const checkTransactionDirectly = async () => {
    if (isDone) return;
    try {
      const response = await fetch(`${horizonUrl.replace(/\/+$/, '')}/transactions/${targetHash}`);
      if (response.ok) {
        const data = await response.json();
        const ledger = Number(data.ledger_attr || data.ledger || 0);
        handleSuccess(data.hash || targetHash, ledger);
      }
    } catch {
      // Continue polling silently
    }
  };

  // Initial check immediately
  void checkTransactionDirectly();

  // 2. Setup Server-Sent Events stream from Horizon
  if (typeof window !== 'undefined' && typeof window.EventSource !== 'undefined') {
    try {
      const streamEndpoint = `${horizonUrl.replace(/\/+$/, '')}/transactions?cursor=now`;
      eventSource = new EventSource(streamEndpoint);

      eventSource.onmessage = (event: MessageEvent) => {
        if (isDone) return;
        try {
          const data = JSON.parse(event.data);
          if (data && typeof data.hash === 'string' && data.hash.toLowerCase() === targetHash) {
            const ledger = Number(data.ledger_attr || data.ledger || 0);
            handleSuccess(data.hash, ledger);
          }
        } catch {
          // Ignore malformed SSE payload
        }
      };

      eventSource.onerror = () => {
        // SSE connection dropped; fallback polling continues running
      };
    } catch {
      // EventSource instantiation failed; fallback polling handles it
    }
  }

  // 3. Fallback interval polling
  pollIntervalId = setInterval(() => {
    void checkTransactionDirectly();
  }, pollIntervalMs);

  // 4. Timeout safeguard
  timeoutId = setTimeout(() => {
    if (isDone) return;
    cleanup();
    const timeoutErr = new Error(`Transaction confirmation timed out after ${timeoutMs}ms.`);
    onError?.(timeoutErr);
  }, timeoutMs);

  return cleanup;
}


/**
 * Polls Horizon for a transaction by hash with timeout
 */
export async function pollTransactionByHash(
  hash: string,
  maxAttempts = 30,
  intervalMs = 1000
): Promise<{ hash: string; ledger: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await callHorizonWithFallback(async (horizonUrl) => {
        const response = await fetch(`${horizonUrl}/transactions/${hash}`);
        if (response.ok) {
          const data = await response.json();
          return {
            hash: data.hash,
            ledger: data.ledger_attr,
          };
        }
        return null;
      });

      if (result) {
        return result;
      }
    } catch {
      // Continue polling
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Transaction ${hash} not found after ${maxAttempts} attempts`);
}

/**
 * Checks if the application is running on a mobile device
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

/**
 * Attempts to open a mobile wallet application with the transaction
 */
export function openMobileWallet(uri: string): boolean {
  if (!isMobileDevice()) {
    return false;
  }

  try {
    window.location.href = uri;
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a deep link for mobile wallet submission
 */
export function createDeepLink(
  xdr: string,
  callbackUrl?: string,
  message?: string
): SEP0007TransactionRequest {
  return {
    xdr,
    ...(callbackUrl ? { callback: callbackUrl } : {}),
    ...(message ? { message } : {}),
    chainId: process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet' ? 'public' : 'testnet',
  };
}
