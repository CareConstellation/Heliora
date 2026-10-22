'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Transaction } from '@stellar/stellar-sdk';
import { CheckCircle2, Circle, Copy, Loader2, PenLine, Send, Upload } from 'lucide-react';
import {
  STELLAR_CONFIG,
  collectedSignatures,
  fetchSignerConfig,
  freighterSigner,
  mergeSignatures,
  parseStagedTx,
  requiredThreshold,
  submitStagedTx,
  type SignerConfig,
} from '@/lib/stellar';

const short = (k: string) => `${k.slice(0, 6)}…${k.slice(-6)}`;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Unexpected error.');

/**
 * Stage a hospital admin transaction, share it by deep link (`?xdr=`), collect
 * co-signatures from connected wallets and broadcast once the threshold is met.
 */
export default function MultisigStaging({ signerAddress }: { signerAddress: string }) {
  const [input, setInput] = useState('');
  const [tx, setTx] = useState<Transaction | null>(null);
  const [config, setConfig] = useState<SignerConfig | null>(null);
  const [busy, setBusy] = useState<'load' | 'sign' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const stage = useCallback(async (envelope: string, current: Transaction | null) => {
    setBusy('load');
    setError(null);
    setNotice(null);
    try {
      const incoming = parseStagedTx(envelope);
      const next = current ? mergeSignatures(parseStagedTx(current.toXDR()), incoming) : incoming;
      if (!current || current.source !== next.source)
        setConfig(await fetchSignerConfig(next.source));
      setTx(next);
      setInput('');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }, []);

  // Deep link: /dashboard/hospital?xdr=<envelope>
  useEffect(() => {
    const xdr = new URLSearchParams(window.location.search).get('xdr');
    if (xdr) void stage(xdr, null);
  }, [stage]);

  async function importFile(file: File) {
    await stage(await file.text(), tx);
  }

  async function sign() {
    if (!tx) return;
    setBusy('sign');
    setError(null);
    try {
      const signed = await freighterSigner(tx.toXDR(), STELLAR_CONFIG.passphrase, signerAddress);
      setTx(mergeSignatures(parseStagedTx(tx.toXDR()), parseStagedTx(signed)));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function broadcast() {
    if (!tx) return;
    setBusy('submit');
    setError(null);
    try {
      setNotice(`Broadcast succeeded: ${await submitStagedTx(tx)}`);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    if (!tx) return;
    const url = `${window.location.origin}${window.location.pathname}?xdr=${encodeURIComponent(tx.toXDR())}`;
    await navigator.clipboard.writeText(url);
    setNotice('Share link copied.');
  }

  const status = tx && config ? collectedSignatures(tx, config) : null;
  const required = tx && config ? requiredThreshold(tx, config) : 0;
  const ready = !!status && status.weight >= required;
  const isSigner = !!config?.signers.some((s) => s.key === signerAddress);
  const alreadySigned = !!status?.signedBy.includes(signerAddress);

  return (
    <div
      className="rounded-[14px] p-5 space-y-4"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div>
        <h2 className="text-sm font-semibold text-text-1">Multisig Transaction Staging</h2>
        <p className="text-xs text-text-3 mt-0.5">
          Paste or import a transaction envelope, or a co-signer&apos;s signed copy to merge their
          signature.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="multisig-xdr" className="sr-only">
          Transaction XDR
        </label>
        <textarea
          id="multisig-xdr"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="AAAAAgAAAAB…"
          className="w-full rounded-md border border-border px-3 py-2 font-mono text-xs bg-surface-inset text-text-1 focus:outline-none focus:ring-2 focus:ring-border-focus"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!input.trim() || !!busy}
            onClick={() => stage(input, tx)}
            className="btn-icon inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {busy === 'load' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <PenLine className="w-3.5 h-3.5" />
            )}
            {tx ? 'Merge signatures' : 'Stage transaction'}
          </button>
          <label className="btn-icon inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> Import file
            <input
              type="file"
              accept=".xdr,.txt"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-xs text-green-600 break-all" aria-live="polite">
          {notice}
        </p>
      )}

      {tx && config && status && (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-text-3">
              Source <span className="font-mono text-text-2">{short(tx.source)}</span> ·{' '}
              {tx.operations.length} op
              {tx.operations.length === 1 ? '' : 's'} · hash{' '}
              <span className="font-mono">{short(tx.hash().toString('hex'))}</span>
            </div>
            <span
              className={`rounded-md px-2 py-1 text-xs font-semibold ${ready ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}
              aria-live="polite"
            >
              {status.signedBy.length} of {config.signers.length} signed · weight {status.weight}/
              {required}
            </span>
          </div>

          <ul className="space-y-1">
            {config.signers.map((s) => {
              const signed = status.signedBy.includes(s.key);
              return (
                <li key={s.key} className="flex items-center gap-2 text-xs">
                  {signed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" aria-label="Signed" />
                  ) : (
                    <Circle className="w-3.5 h-3.5 text-text-3" aria-label="Not signed" />
                  )}
                  <span className="font-mono">{short(s.key)}</span>
                  <span className="text-text-3">weight {s.weight}</span>
                  {s.key === signerAddress && <span className="text-text-3">(you)</span>}
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={sign}
              disabled={!isSigner || alreadySigned || !!busy}
              title={!isSigner ? 'Your wallet is not a signer on this account.' : undefined}
              className="btn-icon inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {busy === 'sign' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <PenLine className="w-3.5 h-3.5" />
              )}
              {alreadySigned ? 'Signed' : 'Sign with wallet'}
            </button>
            <button
              type="button"
              onClick={copyLink}
              className="btn-icon inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs"
            >
              <Copy className="w-3.5 h-3.5" /> Copy share link
            </button>
            <button
              type="button"
              onClick={broadcast}
              disabled={!ready || !!busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-green px-3 py-1.5 text-xs font-semibold text-[#030D09] disabled:opacity-50"
            >
              {busy === 'submit' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              Broadcast
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
