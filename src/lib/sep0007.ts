import QRCode from 'qrcode';
import { callHorizonWithFallback } from './stellar';

export interface SEP0007TransactionRequest {
  xdr: string;
  callback?: string;
  chainId?: string;
  message?: string;
}

export interface QRCodeData {
  uri: string;
  dataUrl: string;
}

/**
 * Generates a SEP-0007 compliant transaction URI
 * Format: web+stellar:tx?xdr=<base64-encoded-xdr>&callback=<url>&chain_id=<network>&msg=<message>
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
  if (request.message) {
    params.append('msg', request.message);
  }

  return `web+stellar:tx?${params.toString()}`;
}

/**
 * Generates a QR code containing the SEP-0007 URI
 */
export async function generateQRCode(request: SEP0007TransactionRequest): Promise<QRCodeData> {
  const uri = generateSEP0007URI(request);
  const dataUrl = await QRCode.toDataURL(uri, {
    width: 300,
    errorCorrectionLevel: 'H',
  });

  return { uri, dataUrl };
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
