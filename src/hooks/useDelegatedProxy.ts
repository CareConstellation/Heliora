'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { proxyBannerLabel } from '@/lib/delegatedProxy';
import { revokeDelegatedProxyToken } from '@/services/api.service';
import { useProxyStore } from '@/store/proxyStore';

/**
 * Active delegated proxy session, if any. Leaves proxy mode automatically when
 * the token expires; `exit` also revokes the token on the server.
 */
export function useDelegatedProxy() {
  const router = useRouter();
  const token = useProxyStore((s) => s.activeToken);
  const exitProxyMode = useProxyStore((s) => s.exitProxyMode);

  const exit = useCallback(() => {
    if (!token) return;
    exitProxyMode();
    // Best effort: the token expires on its own if the revocation does not reach the server.
    revokeDelegatedProxyToken(token.tokenId).catch(() => undefined);
    router.push('/dashboard/doctor');
  }, [token, exitProxyMode, router]);

  useEffect(() => {
    if (!token) return;
    const remaining = Date.parse(token.expiresAt) - Date.now();
    const timer = setTimeout(exitProxyMode, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [token, exitProxyMode]);

  return {
    token,
    active: token !== null,
    label: token ? proxyBannerLabel(token) : null,
    exit,
  };
}
