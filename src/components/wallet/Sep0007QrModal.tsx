'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  QrCode,
  X,
  CheckCircle2,
  Copy,
  Check,
  Loader2,
  Smartphone,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import {
  generateQRCode,
  getTransactionHashFromXDR,
  streamHorizonTransaction,
  isMobileDevice,
  openMobileWallet,
  type SEP0007TransactionRequest,
} from '@/lib/sep0007';
import { useFocusTrap } from '@/hooks/useFocusTrap';

export interface Sep0007QrModalProps {
  isOpen: boolean;
  onClose: () => void;
  xdr: string;
  callbackUrl?: string;
  message?: string;
  networkPassphrase?: string;
  onConfirmed?: (tx: { hash: string; ledger: number }) => void;
  onError?: (error: Error) => void;
}

export default function Sep0007QrModal({
  isOpen,
  onClose,
  xdr,
  callbackUrl,
  message,
  networkPassphrase,
  onConfirmed,
  onError,
}: Sep0007QrModalProps) {
  const containerRef = useFocusTrap<HTMLDivElement>(isOpen, onClose);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [status, setStatus] = useState<'generating' | 'awaiting_signature' | 'confirmed' | 'error'>('generating');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmedLedger, setConfirmedLedger] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  // Generate QR Code and initialize transaction details
  useEffect(() => {
    if (!isOpen || !xdr) return;

    setStatus('generating');
    setErrorMessage(null);
    setConfirmedLedger(null);

    try {
      const computedHash = getTransactionHashFromXDR(xdr, networkPassphrase);
      setTxHash(computedHash);

      const request: SEP0007TransactionRequest = {
        xdr,
        callback: callbackUrl,
        message,
        networkPassphrase,
      };

      generateQRCode(request, { width: 320, errorCorrectionLevel: 'H' })
        .then(({ uri: generatedUri, dataUrl }) => {
          setUri(generatedUri);
          setQrDataUrl(dataUrl);
          setStatus('awaiting_signature');
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : 'Failed to generate QR code';
          setErrorMessage(msg);
          setStatus('error');
          onError?.(err instanceof Error ? err : new Error(msg));
        });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse transaction envelope';
      setErrorMessage(msg);
      setStatus('error');
      onError?.(err instanceof Error ? err : new Error(msg));
    }
  }, [isOpen, xdr, callbackUrl, message, networkPassphrase, onError]);

  // Stream transaction events for real-time confirmation
  useEffect(() => {
    if (!isOpen || !txHash || status === 'confirmed' || status === 'error') return;

    const stopStreaming = streamHorizonTransaction({
      hash: txHash,
      onConfirmed: (tx) => {
        setStatus('confirmed');
        setConfirmedLedger(tx.ledger);
        onConfirmed?.(tx);
      },
      onError: (err) => {
        // Log timeout or streaming error without breaking the display
        console.warn('Horizon streaming warning:', err.message);
      },
      timeoutMs: 180_000,
    });

    return () => {
      stopStreaming();
    };
  }, [isOpen, txHash, status, onConfirmed]);

  const handleCopyUri = useCallback(() => {
    if (!uri) return;
    void navigator.clipboard.writeText(uri).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [uri]);

  const handleOpenMobileWallet = useCallback(() => {
    if (!uri) return;
    openMobileWallet(uri);
  }, [uri]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sep7-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(3, 13, 9, 0.85)', backdropFilter: 'blur(8px)' }}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-2xl p-6 sm:p-7 shadow-2xl transition-all outline-none"
        style={{
          background: 'var(--bg-raised, #0B1E17)',
          border: '1px solid rgba(0, 200, 150, 0.2)',
          boxShadow: '0 20px 40px -15px rgba(0, 200, 150, 0.15)',
        }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close QR signing modal"
          className="absolute top-4 right-4 p-2 rounded-xl text-text-3 hover:text-text-1 hover:bg-white/5 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{
              background: 'rgba(0, 200, 150, 0.1)',
              border: '1px solid rgba(0, 200, 150, 0.25)',
            }}
          >
            <QrCode className="w-5 h-5" style={{ color: '#00C896' }} />
          </div>
          <div>
            <h2 id="sep7-modal-title" className="text-lg font-bold text-text-1">
              Sign with Mobile Wallet
            </h2>
            <p className="text-xs text-text-3">SEP-0007 Delegated Transaction Signing</p>
          </div>
        </div>

        {/* Message Banner */}
        {message && (
          <div
            className="mb-4 rounded-xl p-3 text-xs"
            style={{
              background: 'rgba(0, 200, 150, 0.06)',
              border: '1px solid rgba(0, 200, 150, 0.15)',
              color: 'var(--text-1)',
            }}
          >
            <span className="font-semibold text-emerald-400">Action: </span>
            {message}
          </div>
        )}

        {/* QR Code Container */}
        <div className="flex flex-col items-center justify-center my-4">
          <div
            className="relative p-3.5 rounded-2xl bg-white flex items-center justify-center shadow-inner"
            style={{ minHeight: '260px', minWidth: '260px' }}
          >
            {status === 'generating' && (
              <div className="flex flex-col items-center gap-2 text-slate-800">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
                <span className="text-xs font-medium">Generating high-density QR...</span>
              </div>
            )}

            {status === 'error' && (
              <div className="flex flex-col items-center gap-2 text-red-600 p-4 text-center">
                <AlertCircle className="w-8 h-8" />
                <span className="text-xs font-medium">{errorMessage || 'Error generating QR'}</span>
              </div>
            )}

            {qrDataUrl && status !== 'error' && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={qrDataUrl}
                alt="SEP-0007 Transaction QR Code"
                className="w-64 h-64 object-contain"
              />
            )}
          </div>
        </div>

        {/* Status Indicators */}
        <div className="my-4">
          {status === 'awaiting_signature' && (
            <div
              className="flex items-center justify-center gap-2.5 rounded-xl p-2.5 text-xs"
              style={{
                background: 'rgba(0, 200, 150, 0.08)',
                border: '1px solid rgba(0, 200, 150, 0.2)',
                color: '#00C896',
              }}
            >
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>Awaiting mobile wallet signature & confirmation...</span>
            </div>
          )}

          {status === 'confirmed' && (
            <div
              className="flex items-center justify-center gap-2.5 rounded-xl p-2.5 text-xs text-emerald-300"
              style={{
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
              }}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>
                Transaction Confirmed!{' '}
                {confirmedLedger ? `(Ledger #${confirmedLedger})` : ''}
              </span>
            </div>
          )}
        </div>

        {/* Transaction Hash */}
        {txHash && (
          <div className="mb-5 flex items-center justify-between text-2xs font-mono text-text-3 px-1">
            <span>Tx Hash:</span>
            <span className="truncate max-w-[220px]" title={txHash}>
              {txHash.slice(0, 10)}...{txHash.slice(-8)}
            </span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-2">
          {isMobile && (
            <button
              onClick={handleOpenMobileWallet}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold text-slate-950 transition-all hover:opacity-95"
              style={{ background: '#00C896' }}
            >
              <Smartphone className="w-4 h-4" />
              Open in Mobile Wallet
            </button>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleCopyUri}
              disabled={!uri}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-medium text-text-1 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors disabled:opacity-40"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Copied URI
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy URI
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="py-2.5 px-4 rounded-xl text-xs font-medium text-text-2 bg-transparent hover:text-text-1 transition-colors"
            >
              {status === 'confirmed' ? 'Done' : 'Cancel'}
            </button>
          </div>
        </div>

        {/* Security Note */}
        <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-center gap-1.5 text-2xs text-text-3">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Non-custodial. Your keys never leave your mobile wallet.</span>
        </div>
      </div>
    </div>
  );
}
