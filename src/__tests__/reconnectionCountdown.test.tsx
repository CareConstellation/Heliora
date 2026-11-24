import { render, screen, fireEvent } from '@testing-library/react';
import ReconnectionOverlay from '@/components/consultation/ReconnectionOverlay';
import { setupAutomatedReconnection } from '@/lib/video';
import type { ReconnectionStatus } from '@/types';

type Listener = (event: Event) => void;

function createMockPeer() {
  const listeners: Record<string, Listener[]> = {};
  const pc = {
    connectionState: 'connected' as RTCPeerConnectionState,
    iceConnectionState: 'connected' as RTCIceConnectionState,
    restartIce: jest.fn(),
    getSenders: jest.fn().mockReturnValue([]),
    addEventListener: jest.fn((type: string, cb: Listener) => {
      listeners[type] = [...(listeners[type] ?? []), cb];
    }),
    removeEventListener: jest.fn((type: string, cb: Listener) => {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== cb);
    }),
  };
  const emit = (type: string) => {
    for (const cb of listeners[type] ?? []) {
      cb(new Event(type));
    }
  };
  return { pc, emit };
}

describe('feat(telemedicine): reconnection countdown banner with ICE restart trigger (#270)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('reconnection timer ticks', () => {
    it('restarts ICE immediately and then every 5 seconds while reconnecting', () => {
      const { pc, emit } = createMockPeer();
      const manager = setupAutomatedReconnection({
        peerConnection: pc as unknown as RTCPeerConnection,
        onStatusChange: () => {},
      });

      pc.connectionState = 'disconnected';
      emit('connectionstatechange');
      expect(pc.restartIce).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(4999);
      expect(pc.restartIce).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1);
      expect(pc.restartIce).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(10_000);
      expect(pc.restartIce).toHaveBeenCalledTimes(4);

      manager.cleanup();
    });

    it('ticks the countdown every second from 30 and stops restarting after the timeout', () => {
      const { pc } = createMockPeer();
      const statusHistory: ReconnectionStatus[] = [];
      const onTimeout = jest.fn();

      const manager = setupAutomatedReconnection({
        peerConnection: pc as unknown as RTCPeerConnection,
        onStatusChange: (status) => statusHistory.push({ ...status }),
        onTimeout,
      });

      window.dispatchEvent(new Event('offline'));
      expect(statusHistory[0]?.remainingSeconds).toBe(30);

      jest.advanceTimersByTime(1000);
      expect(statusHistory[statusHistory.length - 1]?.remainingSeconds).toBe(29);

      jest.advanceTimersByTime(9000);
      expect(statusHistory[statusHistory.length - 1]?.remainingSeconds).toBe(20);

      jest.advanceTimersByTime(20_000);
      const finalStatus = statusHistory[statusHistory.length - 1];
      expect(finalStatus?.state).toBe('failed');
      expect(finalStatus?.remainingSeconds).toBe(0);
      expect(onTimeout).toHaveBeenCalledTimes(1);

      const restartsAtTimeout = pc.restartIce.mock.calls.length;
      jest.advanceTimersByTime(15_000);
      expect(pc.restartIce).toHaveBeenCalledTimes(restartsAtTimeout);

      manager.cleanup();
    });

    it('stops the ICE restart cadence once the connection recovers', () => {
      const { pc, emit } = createMockPeer();
      const onReconnected = jest.fn();

      const manager = setupAutomatedReconnection({
        peerConnection: pc as unknown as RTCPeerConnection,
        onStatusChange: () => {},
        onReconnected,
      });

      pc.connectionState = 'disconnected';
      emit('connectionstatechange');
      jest.advanceTimersByTime(5000);
      const restartsBeforeRecovery = pc.restartIce.mock.calls.length;

      pc.connectionState = 'connected';
      emit('connectionstatechange');
      expect(onReconnected).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(20_000);
      expect(pc.restartIce).toHaveBeenCalledTimes(restartsBeforeRecovery);

      manager.cleanup();
    });
  });

  describe('ReconnectionOverlay', () => {
    const noop = () => {};

    it('renders nothing while the call is connected', () => {
      const { container } = render(
        <ReconnectionOverlay
          status={{ state: 'connected', remainingSeconds: 30, attemptCount: 0 }}
          onRetry={noop}
        />,
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('shows the countdown while reconnecting and updates each tick', () => {
      const { rerender } = render(
        <ReconnectionOverlay
          status={{ state: 'reconnecting', remainingSeconds: 30, attemptCount: 1 }}
          onRetry={noop}
        />,
      );

      expect(screen.getByText('Timeout in 30s')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

      rerender(
        <ReconnectionOverlay
          status={{ state: 'reconnecting', remainingSeconds: 25, attemptCount: 2 }}
          onRetry={noop}
        />,
      );

      expect(screen.getByText('Timeout in 25s')).toBeInTheDocument();
      expect(screen.getByText('25s')).toBeInTheDocument();
    });

    it('offers Retry and Switch to Audio-Only once the timeout expires', () => {
      const onRetry = jest.fn();
      const onSwitchToAudioOnly = jest.fn();

      render(
        <ReconnectionOverlay
          status={{
            state: 'failed',
            remainingSeconds: 0,
            attemptCount: 3,
            message: 'Reconnection timed out.',
          }}
          onRetry={onRetry}
          onSwitchToAudioOnly={onSwitchToAudioOnly}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      fireEvent.click(screen.getByRole('button', { name: 'Switch to Audio-Only' }));

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onSwitchToAudioOnly).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Reconnection timed out.')).toBeInTheDocument();
    });
  });
});
