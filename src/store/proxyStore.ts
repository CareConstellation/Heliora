import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { isProxyTokenActive } from '@/lib/delegatedProxy';
import type { DelegatedProxyToken, SupervisorCosignature } from '@/types';

interface ProxyState {
  /** Proxy token of the resident being supervised, or `null` outside proxy mode. */
  activeToken: DelegatedProxyToken | null;
  /** Co-signatures made in this proxy session, newest first. */
  cosignatureLog: SupervisorCosignature[];
  /** Enters proxy mode. Returns `false` (and stays out) when the token is not currently valid. */
  enterProxyMode: (token: DelegatedProxyToken) => boolean;
  exitProxyMode: () => void;
  logCosignature: (cosignature: SupervisorCosignature) => void;
}

/**
 * Delegated proxy session. Kept in `sessionStorage`, so it survives a reload
 * but ends with the tab, and never outlives the token's own expiry.
 */
export const useProxyStore = create<ProxyState>()(
  persist(
    (set) => ({
      activeToken: null,
      cosignatureLog: [],
      enterProxyMode: (token) => {
        if (!isProxyTokenActive(token)) return false;
        set({ activeToken: token, cosignatureLog: [] });
        return true;
      },
      exitProxyMode: () => set({ activeToken: null, cosignatureLog: [] }),
      logCosignature: (cosignature) =>
        set((state) => ({ cosignatureLog: [cosignature, ...state.cosignatureLog] })),
    }),
    {
      name: 'heliora-proxy-session',
      storage: createJSONStorage(() => sessionStorage),
      onRehydrateStorage: () => (state) => {
        if (state?.activeToken && !isProxyTokenActive(state.activeToken)) state.exitProxyMode();
      },
    },
  ),
);
