'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, type ReactNode } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/ui/Toast';
import OfflineBanner from '@/components/ui/OfflineBanner';
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

function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/service-worker.js')
        .catch(() => {
          // Non-fatal if unsupported or blocked by environment
        });
    }
  }, []);

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
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <OfflineBanner />
          <ServiceWorkerRegistration />
          <SentryUserSync />
          <SessionSyncProvider />
          <QueryCacheCleanup />
          {children}
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
