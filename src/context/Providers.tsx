'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, type ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/Toast';
import { useAuthStore } from '@/store/authStore';
import { setSentryUser, clearSentryUser } from '@/lib/sentry';
import { useSessionSync } from '@/hooks/useSessionSync';

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

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SentryUserSync />
        <SessionSyncProvider />
        {children}
      </ToastProvider>
    </QueryClientProvider>
  );
}
