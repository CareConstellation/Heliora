import { setupAutomatedReconnection } from '@/lib/video';
import type { ReconnectionStatus } from '@/types';

describe('feat(video): automated reconnection handler with state recovery (#66)', () => {
  let mockPc: Partial<RTCPeerConnection> & {
    restartIce: jest.Mock;
    getSenders: jest.Mock;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
  };
  let listeners: Record<string, EventListener>;

  beforeEach(() => {
    jest.useFakeTimers();
    listeners = {};

    mockPc = {
      connectionState: 'connected',
      iceConnectionState: 'connected',
      restartIce: jest.fn(),
      getSenders: jest.fn().mockReturnValue([]),
      addEventListener: jest.fn((event: string, cb: EventListener) => {
        listeners[event] = cb;
      }),
      removeEventListener: jest.fn((event: string) => {
        delete listeners[event];
      }),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('detects connection drop, initiates ICE restart, and emits reconnecting status with 30s countdown', () => {
    const statusHistory: ReconnectionStatus[] = [];
    const handler = setupAutomatedReconnection({
      peerConnection: mockPc as unknown as RTCPeerConnection,
      onStatusChange: (status) => statusHistory.push({ ...status }),
      timeoutMs: 30000,
    });

    // Simulate connection drop
    (mockPc as any).connectionState = 'disconnected';
    listeners['connectionstatechange']?.(new Event('connectionstatechange'));

    expect(mockPc.restartIce).toHaveBeenCalledTimes(1);
    expect(statusHistory.length).toBeGreaterThan(0);
    expect(statusHistory[0]!.state).toBe('reconnecting');
    expect(statusHistory[0]!.remainingSeconds).toBe(30);

    // Advance 5 seconds
    jest.advanceTimersByTime(5000);
    const latestStatus = statusHistory[statusHistory.length - 1];
    expect(latestStatus!.remainingSeconds).toBe(25);

    handler.cleanup();
  });

  it('triggers onTimeout and emits failed state when reconnection exceeds 30-second window', () => {
    const statusHistory: ReconnectionStatus[] = [];
    const onTimeout = jest.fn();

    const handler = setupAutomatedReconnection({
      peerConnection: mockPc as unknown as RTCPeerConnection,
      onStatusChange: (status) => statusHistory.push({ ...status }),
      onTimeout,
      timeoutMs: 30000,
    });

    // Trigger offline event
    window.dispatchEvent(new Event('offline'));
    expect(mockPc.restartIce).toHaveBeenCalledTimes(1);

    // Fast-forward 30 seconds
    jest.advanceTimersByTime(30000);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    const finalStatus = statusHistory[statusHistory.length - 1];
    expect(finalStatus!.state).toBe('failed');
    expect(finalStatus!.remainingSeconds).toBe(0);

    handler.cleanup();
  });

  it('restores state to connected when WebRTC route recovers', () => {
    const statusHistory: ReconnectionStatus[] = [];
    const onReconnected = jest.fn();

    const handler = setupAutomatedReconnection({
      peerConnection: mockPc as unknown as RTCPeerConnection,
      onStatusChange: (status) => statusHistory.push({ ...status }),
      onReconnected,
      timeoutMs: 30000,
    });

    // Disconnect
    (mockPc as any).connectionState = 'disconnected';
    listeners['connectionstatechange']?.(new Event('connectionstatechange'));

    // Reconnected
    (mockPc as any).connectionState = 'connected';
    listeners['connectionstatechange']?.(new Event('connectionstatechange'));

    expect(onReconnected).toHaveBeenCalledTimes(1);
    const finalStatus = statusHistory[statusHistory.length - 1];
    expect(finalStatus!.state).toBe('connected');

    handler.cleanup();
  });
});
