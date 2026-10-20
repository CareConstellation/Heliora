'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createSep38Quote, fetchSep38Info, fetchSep38Prices } from '@/services/api.service';
import { getSep10Token, resolveAnchor } from '@/lib/sep10';
import { freighterSigner } from '@/lib/stellar';
import { useWalletStore } from '@/store/useWalletStore';
import type { Sep38Asset, Sep38Context, Sep38FirmQuote } from '@/types';

const ANCHOR_DOMAIN = process.env.NEXT_PUBLIC_SEP38_ANCHOR_DOMAIN ?? '';
/** The quote is requested to stay valid for at least this long, which covers the rest of checkout. */
const QUOTE_LOCK_MS = 10 * 60 * 1000;
/** The patient's wallet authenticates, so the quote is for a wallet-initiated SEP-6 exchange. */
const QUOTE_CONTEXT: Sep38Context = 'sep6';

/** True while the anchor still guarantees the quoted rate. */
export const isQuoteActive = (quote: Sep38FirmQuote | null, nowMs = Date.now()) =>
  !!quote && new Date(quote.expires_at).getTime() > nowMs;

/** `stellar:USDC:G…` → `USDC`, `iso4217:BRL` → `BRL`, `stellar:native` → `XLM`. */
const assetCode = (asset: Sep38Asset) => {
  const code = asset.split(':')[1] ?? asset;
  return code === 'native' ? 'XLM' : code;
};

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

interface Props {
  buyAsset: Sep38Asset;
  buyAmount: string;
  quote: Sep38FirmQuote | null;
  onQuote: (quote: Sep38FirmQuote | null) => void;
}

/**
 * SEP-38 checkout step. It lists indicative prices from `GET /prices`, then
 * locks a firm rate with an authenticated `POST /quote`. The quote is held by
 * the parent, so it survives moving between checkout steps. When it expires,
 * it is cleared and the patient must request a new one.
 */
export default function AnchorQuote({ buyAsset, buyAmount, quote, onQuote }: Props) {
  const { publicKey } = useWalletStore();
  const [sellAsset, setSellAsset] = useState(quote?.sell_asset ?? '');
  const [deliveryMethod, setDeliveryMethod] = useState(quote?.sell_delivery_method ?? '');
  const [now, setNow] = useState(() => Date.now());
  const [expired, setExpired] = useState(false);

  const market = useQuery({
    queryKey: ['sep38-prices', ANCHOR_DOMAIN, buyAsset, buyAmount],
    enabled: !!ANCHOR_DOMAIN,
    queryFn: async () => {
      const anchor = await resolveAnchor(ANCHOR_DOMAIN);
      const [info, prices] = await Promise.all([
        fetchSep38Info(anchor.quoteServer),
        fetchSep38Prices(anchor.quoteServer, buyAsset, buyAmount),
      ]);
      const methods = new Map(info.map((a) => [a.asset, a.sell_delivery_methods ?? []]));
      return { anchor, prices: prices.map((p) => ({ ...p, methods: methods.get(p.asset) ?? [] })) };
    },
  });

  const selected = market.data?.prices.find((p) => p.asset === sellAsset);
  const needsMethod = (selected?.methods.length ?? 0) > 1;

  const quoteMutation = useMutation({
    mutationFn: async () => {
      if (!market.data || !selected || !publicKey)
        throw new Error('Select a currency to pay with.');
      if (needsMethod && !deliveryMethod) throw new Error('Select how you will send the payment.');
      const method = deliveryMethod || selected.methods[0]?.name;
      const token = await getSep10Token(market.data.anchor, publicKey, freighterSigner);
      const firm = await createSep38Quote(market.data.anchor.quoteServer, token, {
        sell_asset: selected.asset,
        buy_asset: buyAsset,
        buy_amount: buyAmount,
        expire_after: new Date(Date.now() + QUOTE_LOCK_MS).toISOString(),
        context: QUOTE_CONTEXT,
        ...(method ? { sell_delivery_method: method } : {}),
      });
      if (
        firm.sell_asset !== selected.asset ||
        firm.buy_asset !== buyAsset ||
        Number(firm.buy_amount) !== Number(buyAmount)
      ) {
        throw new Error('The anchor returned a quote that does not match this appointment.');
      }
      return firm;
    },
    onSuccess: (firm) => {
      setNow(Date.now());
      setExpired(false);
      onQuote(firm);
    },
  });

  // Tick once a second while a quote is locked, and release it when it expires.
  useEffect(() => {
    if (!quote) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (!isQuoteActive(quote, t)) {
        setExpired(true);
        onQuote(null);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [quote, onQuote]);

  if (!ANCHOR_DOMAIN) {
    return <p className="text-xs text-text-3">Anchor payments are not configured.</p>;
  }
  if (market.isLoading) return <div className="animate-pulse h-20 rounded-lg bg-surface-card" />;
  if (market.isError || !market.data) {
    return (
      <p role="alert" className="text-xs text-red-600">
        Could not load anchor exchange rates.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div>
        <label htmlFor="sep38-sell-asset" className="block text-xs font-medium text-slate-600 mb-1">
          Pay with
        </label>
        <select
          id="sep38-sell-asset"
          value={sellAsset}
          disabled={!!quote}
          onChange={(e) => {
            setSellAsset(e.target.value);
            setDeliveryMethod('');
          }}
          className="w-full rounded-md border border-border bg-surface-inset px-3 py-2 text-sm text-text-1"
        >
          <option value="">Select a currency…</option>
          {market.data.prices.map((p) => (
            <option key={p.asset} value={p.asset}>
              {assetCode(p.asset)} · ≈ {p.price} per {assetCode(buyAsset)}
            </option>
          ))}
        </select>
      </div>

      {needsMethod && selected && (
        <div>
          <label htmlFor="sep38-delivery" className="block text-xs font-medium text-slate-600 mb-1">
            Payment method
          </label>
          <select
            id="sep38-delivery"
            value={deliveryMethod}
            disabled={!!quote}
            onChange={(e) => setDeliveryMethod(e.target.value)}
            className="w-full rounded-md border border-border bg-surface-inset px-3 py-2 text-sm text-text-1"
          >
            <option value="">Select…</option>
            {selected.methods.map((m) => (
              <option key={m.name} value={m.name}>
                {m.description}
              </option>
            ))}
          </select>
        </div>
      )}

      {quote ? (
        <div className="space-y-1 text-xs text-text-2">
          <div className="flex justify-between font-medium text-text-1">
            <span>You pay</span>
            <span>
              {quote.sell_amount} {assetCode(quote.sell_asset)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Doctor receives</span>
            <span>
              {quote.buy_amount} {assetCode(quote.buy_asset)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Rate (excl. / incl. fees)</span>
            <span>
              {quote.price} / {quote.total_price} {assetCode(quote.sell_asset)}
            </span>
          </div>
          {(quote.fee.details ?? []).map((d) => (
            <div key={d.name} className="flex justify-between pl-2 text-text-3">
              <span title={d.description}>{d.name}</span>
              <span>
                {d.amount} {assetCode(quote.fee.asset)}
              </span>
            </div>
          ))}
          <div className="flex justify-between">
            <span>Total fees</span>
            <span>
              {quote.fee.total} {assetCode(quote.fee.asset)}
            </span>
          </div>
          <p className="pt-1 text-green" aria-live="polite">
            Rate locked · expires in {formatCountdown(new Date(quote.expires_at).getTime() - now)}
          </p>
        </div>
      ) : (
        <>
          {expired && (
            <p role="alert" className="text-xs text-red-600">
              Your quote expired. Request a new one to continue.
            </p>
          )}
          {quoteMutation.isError && (
            <p role="alert" className="text-xs text-red-600">
              {quoteMutation.error.message || 'Could not get a quote. Please try again.'}
            </p>
          )}
          <button
            type="button"
            onClick={() => quoteMutation.mutate()}
            disabled={!selected || quoteMutation.isPending}
            className="w-full rounded-md border border-border py-2 text-sm font-medium text-text-1 hover:bg-surface-hover disabled:opacity-50"
          >
            {quoteMutation.isPending ? 'Requesting quote…' : 'Lock in rate'}
          </button>
        </>
      )}
    </div>
  );
}
