'use client';

import { useState, useEffect } from 'react';
import { WifiOff, Wifi, CloudOff } from 'lucide-react';

export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    // Initialize state from navigator
    if (typeof navigator !== 'undefined') {
      setIsOffline(!navigator.onLine);
    }

    const handleOnline = () => {
      setIsOffline(false);
      setShowReconnected(true);
      const timer = setTimeout(() => {
        setShowReconnected(false);
      }, 4000);
      return () => clearTimeout(timer);
    };

    const handleOffline = () => {
      setIsOffline(true);
      setShowReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (showReconnected) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full bg-emerald-600/90 text-white text-xs px-4 py-2 flex items-center justify-center gap-2 shadow-sm transition-all animate-fadeIn"
      >
        <Wifi className="w-3.5 h-3.5 shrink-0" />
        <span className="font-medium">Internet connection restored. Synchronizing clinical data...</span>
      </div>
    );
  }

  if (!isOffline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full bg-amber-600/95 text-white text-xs px-4 py-2 flex items-center justify-center gap-2 shadow-sm transition-all"
    >
      <WifiOff className="w-4 h-4 shrink-0 text-amber-200 animate-pulse" />
      <span className="font-semibold">Offline Mode Active:</span>
      <span className="opacity-95">
        Operating on client-side encrypted local cache. Decrypted record snapshots remain accessible; modifications will sync upon reconnection.
      </span>
      <div className="hidden sm:flex items-center gap-1.5 ml-2 pl-2 border-l border-white/20 text-2xs text-amber-100">
        <CloudOff className="w-3 h-3" />
        <span>Encrypted IndexedDB</span>
      </div>
    </div>
  );
}
