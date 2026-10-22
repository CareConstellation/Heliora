'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Anchor,
  CheckCircle2,
  Compass,
  Feather,
  Flame,
  Gem,
  Heart,
  KeyRound,
  Leaf,
  Loader2,
  Moon,
  Mountain,
  ShieldCheck,
  ShieldQuestion,
  Star,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { SHIELD_ICONS, SHIELD_PHRASE_MAX_LENGTH } from '@/lib/antiPhishing';
import {
  useAntiPhishingShield,
  type UseAntiPhishingShieldOptions,
} from '@/hooks/useAntiPhishingShield';
import type { ShieldIcon, ShieldVerificationStatus } from '@/types';

const ICON_GLYPHS: Record<ShieldIcon, LucideIcon> = {
  anchor: Anchor,
  compass: Compass,
  feather: Feather,
  flame: Flame,
  gem: Gem,
  heart: Heart,
  key: KeyRound,
  leaf: Leaf,
  moon: Moon,
  mountain: Mountain,
  star: Star,
  sun: Sun,
};

type Tone = 'ok' | 'info' | 'warn' | 'danger';

const STATUS_COPY: Record<ShieldVerificationStatus, { tone: Tone; text: string }> = {
  verified: { tone: 'ok', text: 'Verified: Heliora confirmed this shield for this site.' },
  'not-configured': {
    tone: 'info',
    text: 'Server cross-check is not configured here. Rely on the shield you set up.',
  },
  unavailable: {
    tone: 'warn',
    text: 'Heliora could not be reached to cross-check your shield. Only continue if it is exactly the one you chose.',
  },
  'not-enrolled': {
    tone: 'warn',
    text: 'Heliora has no record of this shield. If you did not just set it up, do not continue.',
  },
  mismatch: {
    tone: 'danger',
    text: 'This shield does not match the one Heliora has on record. Do not connect your wallet.',
  },
  'invalid-signature': {
    tone: 'danger',
    text: 'The shield confirmation was not signed by Heliora. This may be a phishing site. Do not connect your wallet.',
  },
  'wrong-origin': {
    tone: 'danger',
    text: 'The shield confirmation was issued for a different website. Do not connect your wallet.',
  },
  stale: {
    tone: 'danger',
    text: 'The shield confirmation has expired or was replayed. Reload the page; if this persists, do not continue.',
  },
};

const TONE_STYLE: Record<Tone, { color: string; background: string; border: string }> = {
  ok: { color: '#00C896', background: 'rgba(0,200,150,0.06)', border: 'rgba(0,200,150,0.2)' },
  info: { color: 'var(--text-2)', background: 'var(--bg-inset)', border: 'rgba(255,255,255,0.08)' },
  warn: { color: '#FBBF24', background: 'rgba(251,191,36,0.07)', border: 'rgba(251,191,36,0.25)' },
  danger: {
    color: '#F87171',
    background: 'rgba(248,113,113,0.08)',
    border: 'rgba(248,113,113,0.3)',
  },
};

interface Props extends UseAntiPhishingShieldOptions {
  publicKey: string;
}

/**
 * Personalised anti-phishing shield shown once a wallet public key is entered.
 * Offers to set one up when the account has none on this device.
 */
export default function AntiPhishingShield({ publicKey, ...options }: Props) {
  const { loading, shield, status, error, enrolling, enroll, remove } = useAntiPhishingShield(
    publicKey,
    options,
  );
  const [icon, setIcon] = useState<ShieldIcon | null>(null);
  const [phrase, setPhrase] = useState('');

  if (loading && !shield) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-3 py-3" role="status">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking your security shield…
      </div>
    );
  }

  if (shield) {
    const Glyph = ICON_GLYPHS[shield.icon];
    const copy = status ? STATUS_COPY[status] : null;
    const tone = TONE_STYLE[copy?.tone ?? 'info'];
    const dangerous = copy?.tone === 'danger';

    return (
      <section
        aria-label="Your security shield"
        className="rounded-[12px] p-4"
        style={{ background: tone.background, border: `1px solid ${tone.border}` }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-[12px] flex items-center justify-center shrink-0"
            style={{ background: 'var(--bg-card)', border: `1px solid ${tone.border}` }}
          >
            <Glyph className="w-6 h-6" style={{ color: tone.color }} aria-label={shield.icon} />
          </div>
          <div className="min-w-0">
            <p className="text-2xs uppercase tracking-widest text-text-3">Your security shield</p>
            <p
              className="text-sm font-semibold text-text-1 break-words"
              data-testid="shield-phrase"
            >
              {shield.phrase}
            </p>
          </div>
        </div>

        {copy && (
          <p
            role={dangerous ? 'alert' : 'status'}
            className="flex items-start gap-1.5 text-xs mt-3 leading-relaxed"
            style={{ color: tone.color }}
          >
            {dangerous || copy.tone === 'warn' ? (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            ) : copy.tone === 'ok' ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            ) : (
              <ShieldQuestion className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            )}
            {copy.text}
          </p>
        )}

        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

        <div className="flex items-center justify-between gap-3 mt-3">
          <p className="text-2xs text-text-3">
            Not the icon and phrase you chose? Close this tab — you may be on a fake site.
          </p>
          {status === 'not-enrolled' && (
            <button
              type="button"
              onClick={() => void enroll(shield.icon, shield.phrase)}
              disabled={enrolling}
              className="text-2xs font-semibold shrink-0 disabled:opacity-50"
              style={{ color: '#00C896' }}
            >
              {enrolling ? 'Registering…' : 'Register shield'}
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            className="text-2xs text-text-3 hover:text-text-1 shrink-0"
          >
            Reset shield
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Set up your security shield"
      className="rounded-[12px] p-4"
      style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="flex items-start gap-2.5 mb-3">
        <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#00C896' }} />
        <div>
          <p className="text-sm font-semibold text-text-1">Set up your security shield</p>
          <p className="text-xs text-text-2 leading-relaxed">
            Pick a secret icon and phrase. We will show them every time you sign in here, so you
            know you are on the genuine Heliora site. Fake sites cannot show them.
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (icon) void enroll(icon, phrase);
        }}
      >
        <div role="radiogroup" aria-label="Shield icon" className="grid grid-cols-6 gap-2 mb-3">
          {SHIELD_ICONS.map((id) => {
            const Glyph = ICON_GLYPHS[id];
            const selected = icon === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={id}
                onClick={() => setIcon(id)}
                className="h-10 rounded-[9px] flex items-center justify-center transition-colors"
                style={{
                  background: selected ? 'rgba(0,200,150,0.12)' : 'var(--bg-inset)',
                  border: `1px solid ${selected ? 'rgba(0,200,150,0.45)' : 'rgba(255,255,255,0.07)'}`,
                }}
              >
                <Glyph
                  className="w-4 h-4"
                  style={{ color: selected ? '#00C896' : 'var(--text-2)' }}
                />
              </button>
            );
          })}
        </div>

        <label htmlFor="shield-phrase" className="block text-xs text-text-2 mb-1">
          Security phrase
        </label>
        <input
          id="shield-phrase"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          maxLength={SHIELD_PHRASE_MAX_LENGTH}
          autoComplete="off"
          placeholder="e.g. blue heron at dawn"
          className="w-full rounded-[9px] px-3 py-2 text-sm text-text-1 mb-2"
          style={{ background: 'var(--bg-inset)', border: '1px solid rgba(255,255,255,0.08)' }}
        />
        <p className="text-2xs text-text-3 mb-3">
          Don&apos;t reuse a password or your wallet recovery phrase. You will be asked to sign a
          message with your wallet to register the shield.
        </p>

        {error && (
          <p role="alert" className="text-xs text-red-400 mb-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!icon || !phrase.trim() || enrolling}
          className="btn-primary rounded-[9px] text-xs py-2 px-3.5 disabled:opacity-50"
        >
          {enrolling ? 'Saving…' : 'Save security shield'}
        </button>
      </form>
    </section>
  );
}
