'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Asset } from '@stellar/stellar-sdk';
import {
  findStrictReceivePaymentPaths,
  CLINICAL_PAYMENT_ASSETS,
  STELLAR_CONFIG,
  type StrictReceivePathQuote,
  type SupportedPaymentAsset,
} from '@/lib/stellar';
import { useWalletStore } from '@/store/useWalletStore';
import { RefreshCw, TrendingDown, Clock, ShieldCheck, AlertCircle } from 'lucide-react';

interface Props {
  destAsset?: Asset;
  destAmount: string;
  selectedQuote: StrictReceivePathQuote | null;
  onQuoteSelect: (quote: StrictReceivePathQuote | null) => void;
  slippageTolerancePercent?: number;
  disabled?: boolean;
}

const REFRESH_INTERVAL_SECONDS = 15;

export default function PathPaymentSelector({
  destAsset = Asset.native(),
  destAmount,
  selectedQuote,
  onQuoteSelect,
  slippageTolerancePercent = 1.0,
  disabled = false,
}: Props) {
  const { publicKey } = useWalletStore();
  const network = STELLAR_CONFIG.network === 'mainnet' ? 'mainnet' : 'testnet';
  const supportedAssets = CLINICAL_PAYMENT_ASSETS[network];

  const [selectedAssetCode, setSelectedAssetCode] = useState<string>('XLM');
  const [availableQuotes, setAvailableQuotes] = useState<StrictReceivePathQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(REFRESH_INTERVAL_SECONDS);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const destAssetCode = destAsset.isNative() ? 'XLM' : destAsset.getCode();

  const fetchPaths = useCallback(async () => {
    if (!destAmount || Number(destAmount) <= 0) {
      setAvailableQuotes([]);
      onQuoteSelect(null);
      return;
    }

    const chosenAssetObj = supportedAssets.find((a) => a.code === selectedAssetCode);
    if (!chosenAssetObj) return;

    if (chosenAssetObj.asset.equals(destAsset)) {
      setAvailableQuotes([]);
      onQuoteSelect(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const sourceAssetsToSearch = [chosenAssetObj.asset];
      const paths = await findStrictReceivePaymentPaths({
        sourceAccountOrAssets: sourceAssetsToSearch,
        destAsset,
        destAmount,
        slippageTolerancePercent,
      });

      const matchingPaths = paths.filter((p) => p.sourceAssetCode === selectedAssetCode);

      if (matchingPaths.length === 0) {
        setError(`No liquidity path found on Horizon for ${selectedAssetCode} to ${destAssetCode}.`);
        setAvailableQuotes([]);
        onQuoteSelect(null);
      } else {
        matchingPaths.sort((a, b) => Number(a.sourceAmount) - Number(b.sourceAmount));
        setAvailableQuotes(matchingPaths);
        onQuoteSelect(matchingPaths[0] ?? null);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to query Horizon path payment paths.';
      setError(msg);
      setAvailableQuotes([]);
      onQuoteSelect(null);
    } finally {
      setLoading(false);
      setSecondsRemaining(REFRESH_INTERVAL_SECONDS);
    }
  }, [destAmount, selectedAssetCode, destAsset, destAssetCode, supportedAssets, publicKey, slippageTolerancePercent, onQuoteSelect]);

  useEffect(() => {
    fetchPaths();
  }, [fetchPaths]);

  useEffect(() => {
    if (selectedAssetCode === destAssetCode) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setSecondsRemaining((prev: number) => {
        if (prev <= 1) {
          fetchPaths();
          return REFRESH_INTERVAL_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [selectedAssetCode, destAssetCode, fetchPaths]);

  const handleAssetChange = (code: string) => {
    setSelectedAssetCode(code);
    setSecondsRemaining(REFRESH_INTERVAL_SECONDS);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs space-y-3 shadow-xs">
      <div className="flex items-center justify-between">
        <label className="font-semibold text-slate-900 flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-green" />
          Clinical Payment Asset (Cross-Asset Pathfinding)
        </label>
        {selectedAssetCode !== destAssetCode && (
          <div className="flex items-center gap-2 text-slate-500">
            <span className="flex items-center gap-1 font-mono text-2xs bg-slate-100 px-2 py-0.5 rounded-full">
              <Clock className="h-3 w-3 text-slate-400" />
              Quote refetches in {secondsRemaining}s
            </span>
            <button
              type="button"
              onClick={fetchPaths}
              disabled={loading || disabled}
              className="p-1 hover:bg-slate-100 rounded-md text-slate-600 disabled:opacity-40"
              title="Refresh Path Payment Quote"
              aria-label="Refresh Quote"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-green' : ''}`} />
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {supportedAssets.map((assetItem: SupportedPaymentAsset) => {
          const isSelected = selectedAssetCode === assetItem.code;
          return (
            <button
              key={assetItem.code}
              type="button"
              disabled={disabled}
              onClick={() => handleAssetChange(assetItem.code)}
              className={`flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all ${
                isSelected
                  ? 'border-green bg-green/10 text-slate-900 font-semibold ring-1 ring-green'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
              } disabled:opacity-50`}
            >
              <span className="text-sm font-bold">{assetItem.code}</span>
              <span className="text-2xs text-slate-500 truncate w-full">{assetItem.name}</span>
            </button>
          );
        })}
      </div>

      {selectedAssetCode === destAssetCode ? (
        <div className="rounded-md bg-slate-50 p-2.5 text-slate-600 flex items-center justify-between">
          <span>Direct payment without cross-currency conversion:</span>
          <span className="font-bold text-slate-900">
            {destAmount} {destAssetCode}
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          {loading && !selectedQuote && (
            <div className="p-3 text-center text-slate-500">
              <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-1 text-green" />
              Finding best payment path on Horizon SDEX...
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 p-2 text-red-600 text-2xs flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {selectedQuote && !loading && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="text-slate-600">Expected Send Amount:</span>
                <span className="font-bold text-slate-900 text-sm">
                  {Number(selectedQuote.sourceAmount).toFixed(4)} {selectedQuote.sourceAssetCode}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-2xs text-slate-600">
                <div>
                  <span className="block text-slate-400">Conversion Rate:</span>
                  <span className="font-mono font-medium text-slate-800">
                    1 {selectedQuote.sourceAssetCode} ≈{' '}
                    {(1 / selectedQuote.conversionRate).toFixed(4)} {destAssetCode}
                  </span>
                </div>
                <div>
                  <span className="block text-slate-400">Strict Slippage Limit:</span>
                  <span className="font-mono font-medium text-slate-800">
                    Max {selectedQuote.sendMax} {selectedQuote.sourceAssetCode} (+{selectedQuote.slippageTolerancePercent}%)
                  </span>
                </div>
              </div>

              {selectedQuote.path.length > 0 && (
                <div className="text-2xs text-slate-500 pt-1 flex items-center gap-1">
                  <TrendingDown className="h-3 w-3 text-slate-400" />
                  Routing via {selectedQuote.path.length} intermediary asset hop(s).
                </div>
              )}

              <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden">
                <div
                  className="bg-green h-full transition-all duration-1000"
                  style={{ width: `${(secondsRemaining / REFRESH_INTERVAL_SECONDS) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
