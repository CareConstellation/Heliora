import {
  buildTurnFailoverConfiguration,
  setupAutomatedReconnection,
  TURN_TLS_PORT,
  type ReconnectionManager,
} from '@/lib/video';
import type { ReconnectionStatus } from '@/types';

type Listener = (event: Event) => void;

interface MockPeer {
  pc: {
    connectionState: RTCPeerConnectionState;
    iceConnectionState: RTCIceConnectionState;
    restartIce: jest.Mock;
    getSenders: jest.Mock;
    close: jest.Mock;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
  };
  emit: (type: string) => void;
}

function createMockPeer(iceConnectionState: RTCIceConnectionState = 'connected'): MockPeer {
  const listeners: Record<string, Listener[]> = {};

  const pc: MockPeer['pc'] = {
    connectionState: 'connected',
    iceConnectionState,
    restartIce: jest.fn(),
    getSenders: jest.fn().mockReturnValue([]),
    close: jest.fn(),
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

describe('feat(webrtc): ICE failure handling with TURN relay failover (#264)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('buildTurnFailoverConfiguration', () => {
    it('builds a relay-only configuration that reaches TURN over TLS on port 443', () => {
      const config = buildTurnFailoverConfiguration([
        { host: ' turn.heliora.test ', username: 'user-1', credential: 'secret-1' },
      ]);

      expect(TURN_TLS_PORT).toBe(443);
      expect(config).toEqual({
        iceServers: [
          {
            urls: 'turns:turn.heliora.test:443?transport=tcp',
            username: 'user-1',
            credential: 'secret-1',
          },
        ],
        iceTransportPolicy: 'relay',
      });
    });

    it('omits credential fields that were not provided', () => {
      const config = buildTurnFailoverConfiguration([{ host: 'turn.heliora.test' }]);

      expect(config?.iceServers?.[0]).toEqual({
        urls: 'turns:turn.heliora.test:443?transport=tcp',
      });
      expect(config?.iceServers?.[0]).not.toHaveProperty('username');
      expect(config?.iceServers?.[0]).not.toHaveProperty('credential');
    });

    it('returns null when no usable TURN host is supplied', () => {
      expect(buildTurnFailoverConfiguration([])).toBeNull();
      expect(buildTurnFailoverConfiguration([{ host: '   ' }])).toBeNull();
    });

    it('skips blank hosts and keeps the usable ones', () => {
      const config = buildTurnFailoverConfiguration([
        { host: '' },
        { host: 'turn-b.heliora.test' },
      ]);

      expect(config?.iceServers).toHaveLength(1);
      expect(config?.iceServers?.[0]?.urls).toBe('turns:turn-b.heliora.test:443?transport=tcp');
    });
  });

  describe('setupAutomatedReconnection ICE failure path', () => {
    const turnServers = [{ host: 'turn.heliora.test', username: 'user-1', credential: 'secret-1' }];

    it('re-initializes the peer connection with relay-only ICE after an ICE failure', () => {
      const first = createMockPeer('connected');
      const second = createMockPeer('new');
      const createRelayPeerConnection = jest.fn(
        () => second.pc as unknown as RTCPeerConnection,
      );
      const onPeerConnectionReplaced = jest.fn();
      const statusHistory: ReconnectionStatus[] = [];

      const manager: ReconnectionManager = setupAutomatedReconnection({
        peerConnection: first.pc as unknown as RTCPeerConnection,
        onStatusChange: (status) => statusHistory.push({ ...status }),
        turnServers,
        createRelayPeerConnection,
        onPeerConnectionReplaced,
      });

      first.pc.iceConnectionState = 'failed';
      first.emit('iceconnectionstatechange');

      expect(createRelayPeerConnection).toHaveBeenCalledTimes(1);
      expect(createRelayPeerConnection).toHaveBeenCalledWith({
        iceServers: [
          {
            urls: 'turns:turn.heliora.test:443?transport=tcp',
            username: 'user-1',
            credential: 'secret-1',
          },
        ],
        iceTransportPolicy: 'relay',
      });

      // The failed connection is detached and closed, and the replacement is installed.
      expect(first.pc.close).toHaveBeenCalledTimes(1);
      expect(first.pc.removeEventListener).toHaveBeenCalledWith(
        'iceconnectionstatechange',
        expect.any(Function),
      );
      expect(onPeerConnectionReplaced).toHaveBeenCalledWith(second.pc);
      expect(manager.getPeerConnection()).toBe(second.pc);

      // The replacement is restarted and the overlay reports the relay fallback.
      expect(second.pc.restartIce).toHaveBeenCalledTimes(1);
      expect(statusHistory[0]?.state).toBe('reconnecting');
      expect(statusHistory[0]?.message).toContain('TURN relay');

      manager.cleanup();
      expect(second.pc.removeEventListener).toHaveBeenCalledWith(
        'iceconnectionstatechange',
        expect.any(Function),
      );
    });

    it('attempts the relay failover only once per manager', () => {
      const first = createMockPeer('connected');
      const second = createMockPeer('connected');
      const createRelayPeerConnection = jest.fn(
        () => second.pc as unknown as RTCPeerConnection,
      );

      const manager = setupAutomatedReconnection({
        peerConnection: first.pc as unknown as RTCPeerConnection,
        onStatusChange: () => {},
        turnServers,
        createRelayPeerConnection,
      });

      first.pc.iceConnectionState = 'failed';
      first.emit('iceconnectionstatechange');

      // Recovery returns the state to connected, then the relay connection fails too.
      second.pc.iceConnectionState = 'connected';
      second.emit('iceconnectionstatechange');
      second.pc.iceConnectionState = 'failed';
      second.emit('iceconnectionstatechange');

      expect(createRelayPeerConnection).toHaveBeenCalledTimes(1);
      expect(manager.getPeerConnection()).toBe(second.pc);
      manager.cleanup();
    });

    it('falls back to a plain ICE restart when no TURN servers are configured', () => {
      const createRelayPeerConnection = jest.fn();
      const { pc, emit } = createMockPeer('connected');
      const statusHistory: ReconnectionStatus[] = [];

      const manager = setupAutomatedReconnection({
        peerConnection: pc as unknown as RTCPeerConnection,
        onStatusChange: (status) => statusHistory.push({ ...status }),
        turnServers: [],
        createRelayPeerConnection,
      });

      pc.iceConnectionState = 'failed';
      emit('iceconnectionstatechange');

      expect(createRelayPeerConnection).not.toHaveBeenCalled();
      expect(pc.restartIce).toHaveBeenCalledTimes(1);
      expect(manager.getPeerConnection()).toBe(pc);
      expect(statusHistory[0]?.state).toBe('reconnecting');
      expect(statusHistory[0]?.message).toContain('ICE transport failed');
      manager.cleanup();
    });

    it('keeps the original connection and still reconnects when the relay factory throws', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const { pc, emit } = createMockPeer('connected');
      const createRelayPeerConnection = jest.fn(() => {
        throw new Error('relay unavailable');
      });

      const manager = setupAutomatedReconnection({
        peerConnection: pc as unknown as RTCPeerConnection,
        onStatusChange: () => {},
        turnServers,
        createRelayPeerConnection,
      });

      pc.iceConnectionState = 'failed';
      emit('iceconnectionstatechange');

      expect(createRelayPeerConnection).toHaveBeenCalledTimes(1);
      expect(manager.getPeerConnection()).toBe(pc);
      expect(pc.restartIce).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalled();
      manager.cleanup();
    });
  });
});
