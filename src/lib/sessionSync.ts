export type SessionEventType = 'AUTH_LOGOUT' | 'WALLET_CHANGED' | 'SESSION_TIMEOUT';

export interface SessionEvent {
  type: SessionEventType;
  timestamp: number;
  walletAddress?: string;
  data?: Record<string, unknown>;
}

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
let channel: BroadcastChannel | null = null;
let inactivityTimer: NodeJS.Timeout | null = null;

export const sessionSync = {
  initialize(onEvent: (event: SessionEvent) => void) {
    if (typeof window === 'undefined') return;

    try {
      channel = new BroadcastChannel('heliora-session');
      channel.onmessage = (evt) => {
        const event = evt.data as SessionEvent;
        onEvent(event);
      };
    } catch (err) {
      console.warn('BroadcastChannel not supported:', err);
    }

    this.resetInactivityTimer(onEvent);
  },

  resetInactivityTimer(onEvent: (event: SessionEvent) => void) {
    if (inactivityTimer) clearTimeout(inactivityTimer);

    inactivityTimer = setTimeout(() => {
      this.broadcastSessionTimeout();
      onEvent({
        type: 'SESSION_TIMEOUT',
        timestamp: Date.now(),
      });
    }, INACTIVITY_TIMEOUT_MS);
  },

  broadcastLogout(walletAddress?: string) {
    const event: SessionEvent = {
      type: 'AUTH_LOGOUT',
      timestamp: Date.now(),
      ...(walletAddress ? { walletAddress } : {}),
    };
    this.broadcast(event);
  },

  broadcastWalletChange(walletAddress: string) {
    const event: SessionEvent = {
      type: 'WALLET_CHANGED',
      timestamp: Date.now(),
      walletAddress,
    };
    this.broadcast(event);
  },

  broadcastSessionTimeout() {
    const event: SessionEvent = {
      type: 'SESSION_TIMEOUT',
      timestamp: Date.now(),
    };
    this.broadcast(event);
  },

  broadcast(event: SessionEvent) {
    if (!channel) return;
    try {
      channel.postMessage(event);
    } catch (err) {
      console.warn('Failed to broadcast session event:', err);
    }
  },

  cleanup() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (channel) channel.close();
  },
};
