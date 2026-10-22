'use client';

import { LogOut, UserCheck } from 'lucide-react';
import { useDelegatedProxy } from '@/hooks/useDelegatedProxy';
import { proxyMinutesRemaining } from '@/lib/delegatedProxy';

/** Single-click button that leaves delegated resident mode. Renders nothing outside it. */
export function ExitProxyModeButton({ className = '' }: { className?: string }) {
  const { active, exit } = useDelegatedProxy();
  if (!active) return null;
  return (
    <button
      type="button"
      onClick={exit}
      className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-semibold ${className}`}
      style={{ background: '#F59E0B', color: '#1C1206' }}
    >
      <LogOut className="w-3.5 h-3.5" />
      Exit Proxy Mode
    </button>
  );
}

/**
 * Full-width banner shown while a supervisor is viewing a resident's work
 * under a delegated proxy token.
 */
export default function DelegatedProxyBanner({ showExit = true }: { showExit?: boolean }) {
  const { token, label } = useDelegatedProxy();
  if (!token || !label) return null;

  const minutes = proxyMinutesRemaining(token);

  return (
    <div
      role="status"
      aria-label="Delegated proxy mode"
      className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5"
      style={{
        background:
          'repeating-linear-gradient(135deg, rgba(245,158,11,0.16) 0 12px, rgba(245,158,11,0.1) 12px 24px)',
        borderBottom: '1px solid rgba(245,158,11,0.45)',
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <UserCheck className="w-4 h-4 shrink-0" style={{ color: '#F59E0B' }} />
        <p className="text-sm font-semibold truncate" style={{ color: '#FCD34D' }}>
          {label}
        </p>
        <span className="text-2xs text-text-2 hidden sm:inline">
          Supervising as {token.supervisorName} · {minutes} min left
        </span>
      </div>
      {showExit && <ExitProxyModeButton />}
    </div>
  );
}
