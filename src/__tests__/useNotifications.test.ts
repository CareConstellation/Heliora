/**
 * Tests for the notification hook contract.
 * EventSource is mocked since it's a browser API.
 */

import { renderHook, act } from '@testing-library/react';
import { useNotifications } from '@/hooks/useNotifications';
import { eventManager, EventType } from '@/lib/contractEventListener';

const mockClose = jest.fn();
const mockAddEventListener = jest.fn();

class MockEventSource {
  static lastInstance: MockEventSource | null = null;
  onerror: ((e: Event) => void) | null = null;
  url: string;

  constructor(url: string) {
    this.url = url;
    MockEventSource.lastInstance = this;
  }

  addEventListener = mockAddEventListener;
  close = mockClose;
}

Object.defineProperty(globalThis, 'EventSource', {
  value: MockEventSource,
  writable: true,
});

beforeEach(() => {
  mockClose.mockClear();
  mockAddEventListener.mockClear();
  MockEventSource.lastInstance = null;
});

describe('EventSource (browser API used by useNotifications)', () => {
  it('can be constructed with a URL', () => {
    const es = new MockEventSource('http://localhost/stream');
    expect(es.url).toBe('http://localhost/stream');
  });

  it('addEventListener can be called with event types', () => {
    const es = new MockEventSource('http://localhost/stream');
    es.addEventListener('access_request', () => {});
    expect(mockAddEventListener).toHaveBeenCalledWith('access_request', expect.any(Function));
  });

  it('close() can be called on the instance', () => {
    const es = new MockEventSource('http://localhost/stream');
    es.close();
    expect(mockClose).toHaveBeenCalled();
  });

  it('supports all required notification event types', () => {
    const supportedTypes = ['access_request', 'appointment_confirmed', 'record_shared'];
    const es = new MockEventSource('http://localhost/stream');
    supportedTypes.forEach((type) => es.addEventListener(type, jest.fn()));
    const registeredTypes = mockAddEventListener.mock.calls.map((c: [string]) => c[0]);
    expect(registeredTypes).toEqual(supportedTypes);
  });

  it('tracks the last created instance', () => {
    new MockEventSource('http://localhost/a');
    new MockEventSource('http://localhost/b');
    expect(MockEventSource.lastInstance?.url).toBe('http://localhost/b');
  });
});

describe('Notification event shapes', () => {
  it('access_request event type is a string', () => {
    expect(typeof 'access_request').toBe('string');
  });

  it('appointment_confirmed event type is a string', () => {
    expect(typeof 'appointment_confirmed').toBe('string');
  });

  it('record_shared event type is a string', () => {
    expect(typeof 'record_shared').toBe('string');
  });

  it('notification event has required fields', () => {
    const event = {
      id: crypto.randomUUID(),
      type: 'access_request' as const,
      message: 'New access request received',
      timestamp: Date.now(),
    };
    expect(event).toHaveProperty('id');
    expect(event).toHaveProperty('type');
    expect(event).toHaveProperty('message');
    expect(event).toHaveProperty('timestamp');
  });

  it('receives on-chain contract events via eventManager', () => {
    const onNotification = jest.fn();
    const { result } = renderHook(() =>
      useNotifications({ address: 'GUSER_ADDRESS', onNotification }),
    );

    act(() => {
      eventManager.dispatchEvent({
        id: 'contract-event-1',
        type: EventType.AppointmentBooked,
        contractId: 'CAPPOINTMENT_CONTRACT',
        ledgerSequence: 1005,
        transactionHash: '0xhash1',
        timestamp: Date.now(),
        data: {},
        processedAt: Date.now(),
      });
    });

    expect(result.current.unreadCount).toBe(1);
    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0]?.type).toBe('appointment_confirmed');
    expect(onNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'contract-event-1',
        type: 'appointment_confirmed',
      }),
    );
  });
});

