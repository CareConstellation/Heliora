import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWalletStore } from '@/store/useWalletStore';
import { useAuthStore } from '@/store/authStore';
import { sessionSync, type SessionEvent } from '@/lib/sessionSync';

export function useSessionSync() {
  const router = useRouter();
  const { publicKey, disconnect } = useWalletStore();
  const { clearAuth } = useAuthStore();

  useEffect(() => {
    const handleSessionEvent = (event: SessionEvent) => {
      switch (event.type) {
        case 'AUTH_LOGOUT':
          clearAuth();
          disconnect();
          router.replace('/login');
          break;

        case 'WALLET_CHANGED':
          if (event.walletAddress && event.walletAddress !== publicKey) {
            disconnect();
            router.replace('/login');
          }
          break;

        case 'SESSION_TIMEOUT':
          clearAuth();
          disconnect();
          router.replace('/login');
          break;
      }
    };

    sessionSync.initialize(handleSessionEvent);

    // Reset inactivity timer on user interaction
    const resetTimer = () => {
      sessionSync.resetInactivityTimer(handleSessionEvent);
    };

    document.addEventListener('mousemove', resetTimer);
    document.addEventListener('keydown', resetTimer);
    document.addEventListener('click', resetTimer);

    return () => {
      sessionSync.cleanup();
      document.removeEventListener('mousemove', resetTimer);
      document.removeEventListener('keydown', resetTimer);
      document.removeEventListener('click', resetTimer);
    };
  }, [publicKey, router, disconnect, clearAuth]);
}
