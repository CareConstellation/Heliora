'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Info, Lock } from 'lucide-react';
import { checkOfficialDomain, type DomainCheck } from '@/lib/antiPhishing';

const TIPS = [
  'Check that the address bar shows the exact Heliora domain before connecting your wallet.',
  'Heliora never asks for your secret key or wallet recovery phrase.',
  'Your personal security shield only appears on the genuine site.',
];

function headline(check: DomainCheck): { tone: 'ok' | 'warn' | 'danger'; text: string } {
  switch (check.status) {
    case 'official':
      return { tone: 'ok', text: `You are on the official Heliora domain: ${check.hostname}` };
    case 'development':
      return {
        tone: 'warn',
        text: `Development build on ${check.hostname}. Use test wallets only.`,
      };
    case 'insecure':
      return {
        tone: 'danger',
        text: `${check.hostname} is not using HTTPS. Do not connect your wallet.`,
      };
    case 'unofficial':
      return {
        tone: 'danger',
        text: `${check.hostname} is not an official Heliora domain. Official: ${check.officialDomains.join(', ')}.`,
      };
    case 'unconfigured':
      return {
        tone: 'warn',
        text: `This deployment (${check.hostname}) does not declare its official domains.`,
      };
  }
}

const TONE = {
  ok: { color: '#00C896', background: 'rgba(0,200,150,0.05)', border: 'rgba(0,200,150,0.15)' },
  warn: { color: '#FBBF24', background: 'rgba(251,191,36,0.06)', border: 'rgba(251,191,36,0.2)' },
  danger: {
    color: '#F87171',
    background: 'rgba(248,113,113,0.08)',
    border: 'rgba(248,113,113,0.3)',
  },
};

/** Educational security banner with a check of the domain the page is served from. */
export default function OfficialDomainBanner() {
  const [check, setCheck] = useState<DomainCheck | null>(null);

  useEffect(() => {
    setCheck(checkOfficialDomain(window.location));
  }, []);

  if (!check) return null;
  const { tone, text } = headline(check);
  const style = TONE[tone];
  const Icon = tone === 'ok' ? Lock : tone === 'danger' ? AlertTriangle : Info;

  return (
    <aside
      aria-label="Domain security check"
      className="rounded-[10px] p-3.5 mb-6"
      style={{ background: style.background, border: `1px solid ${style.border}` }}
    >
      <p
        role={tone === 'danger' ? 'alert' : undefined}
        className="flex items-start gap-2 text-xs font-semibold"
        style={{ color: style.color }}
      >
        <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        {text}
      </p>
      <ul className="mt-2 space-y-1 pl-5 list-disc">
        {TIPS.map((tip) => (
          <li key={tip} className="text-2xs text-text-2 leading-relaxed">
            {tip}
          </li>
        ))}
      </ul>
    </aside>
  );
}
