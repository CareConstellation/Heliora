'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/Toast';
import { useAuthStore } from '@/store/authStore';
import { setSentryUser, clearSentryUser } from '@/lib/sentry';
import { useSessionSync } from '@/hooks/useSessionSync';
import { createPersistedQueryClient, cleanupPersistedQueryCache } from '@/services/persistentQueryCache';

function SentryUserSync() {
  const { walletAddress, role } = useAuthStore();

  useEffect(() => {
    if (walletAddress && role) {
      setSentryUser(walletAddress, role);
    } else {
      clearSentryUser();
    }
  }, [walletAddress, role]);

  return null;
}

function SessionSyncProvider() {
  useSessionSync();
  return null;
}

function QueryCacheCleanup() {
  useEffect(() => {
    return () => {
      cleanupPersistedQueryCache();
    };
  }, []);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createPersistedQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SentryUserSync />
        <SessionSyncProvider />
        <QueryCacheCleanup />
        {children}
      </ToastProvider>
    </QueryClientProvider>
  );
}
