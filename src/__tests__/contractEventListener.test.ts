import { xdr } from '@stellar/stellar-sdk';
import {
  decodeXdrTopicSymbol,
  SorobanRpcEventPoller,
  EventType,
  savePersistedCursor,
  loadPersistedCursor,
  TOPIC_SYMBOL_MAP,
} from '@/lib/contractEventListener';

describe('Soroban Contract Event Subscription via getEvents (#193)', () => {
  describe('decodeXdrTopicSymbol', () => {
    it('decodes xdr.ScVal symbol for AppointmentBooked and RecordShared', () => {
      const sym1 = xdr.ScVal.scvSymbol('AppointmentBooked');
      const sym2 = xdr.ScVal.scvSymbol('RecordShared');

      expect(decodeXdrTopicSymbol(sym1)).toBe('AppointmentBooked');
      expect(decodeXdrTopicSymbol(sym2)).toBe('RecordShared');
    });

    it('decodes base64-encoded XDR topic strings', () => {
      const sym1 = xdr.ScVal.scvSymbol('AppointmentBooked');
      const b64 = sym1.toXDR('base64');

      expect(decodeXdrTopicSymbol(b64)).toBe('AppointmentBooked');
    });

    it('falls back to raw string symbol when not base64 XDR', () => {
      expect(decodeXdrTopicSymbol('AppointmentBooked')).toBe('AppointmentBooked');
      expect(decodeXdrTopicSymbol('RecordShared')).toBe('RecordShared');
      expect(decodeXdrTopicSymbol('')).toBe('');
    });

    it('maps topic symbols to domain EventType', () => {
      expect(TOPIC_SYMBOL_MAP.AppointmentBooked).toBe(EventType.AppointmentBooked);
      expect(TOPIC_SYMBOL_MAP.RecordShared).toBe(EventType.RecordShared);
      expect(TOPIC_SYMBOL_MAP.AccessGranted).toBe(EventType.AccessGranted);
    });
  });

  describe('Cursor Persistence', () => {
    it('saves and loads startLedger cursor', async () => {
      const key = 'test-event-cursor';
      await savePersistedCursor(key, 125000);
      const loaded = await loadPersistedCursor(key);

      expect(loaded).toBe(125000);
    });
  });

  describe('SorobanRpcEventPoller', () => {
    let mockGetEvents: jest.Mock;
    let mockGetLatestLedger: jest.Mock;
    let mockServer: any;

    beforeEach(() => {
      mockGetEvents = jest.fn();
      mockGetLatestLedger = jest.fn().mockResolvedValue({ sequence: 1000 });
      mockServer = {
        getEvents: mockGetEvents,
        getLatestLedger: mockGetLatestLedger,
      };
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('initializes with startLedger and polls events', async () => {
      const eventSym = xdr.ScVal.scvSymbol('AppointmentBooked');
      mockGetEvents.mockResolvedValueOnce({
        events: [
          {
            id: 'evt-001',
            ledger: 1005,
            txHash: '0xabc123',
            contractId: 'CCONTRACT_APPT',
            topic: [eventSym],
            value: null,
            ledgerClosedAt: '2026-11-24T00:00:00Z',
          },
        ],
        latestLedger: 1010,
      });

      const poller = new SorobanRpcEventPoller({
        startLedger: 1000,
        storageKey: 'test-poller-key-1',
        server: mockServer,
      });

      const subscriber = jest.fn();
      poller.subscribe(subscriber);

      const events = await poller.pollOnce();

      expect(mockGetEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          startLedger: 1000,
        }),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe(EventType.AppointmentBooked);
      expect(events[0]?.id).toBe('evt-001');
      expect(events[0]?.ledgerSequence).toBe(1005);
      expect(subscriber).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt-001' }));

      // Cursor must advance to highestSeenLedger + 1
      expect(poller.getCurrentCursor()).toBe(1006);
    });

    it('advances cursor even when no events are returned', async () => {
      mockGetEvents.mockResolvedValueOnce({
        events: [],
        latestLedger: 1025,
      });

      const poller = new SorobanRpcEventPoller({
        startLedger: 1000,
        storageKey: 'test-poller-key-2',
        server: mockServer,
      });

      await poller.pollOnce();

      // Advanced to latestLedger
      expect(poller.getCurrentCursor()).toBe(1025);
    });

    it('deduplicates events to prevent duplicate notifications', async () => {
      const eventSym = xdr.ScVal.scvSymbol('RecordShared');
      const rawEvent = {
        id: 'dup-001',
        ledger: 2000,
        txHash: '0xdef456',
        contractId: 'CRECORD_REGISTRY',
        topic: [eventSym],
        value: null,
        ledgerClosedAt: '2026-11-24T00:00:00Z',
      };

      mockGetEvents
        .mockResolvedValueOnce({ events: [rawEvent], latestLedger: 2001 })
        .mockResolvedValueOnce({ events: [rawEvent], latestLedger: 2002 });

      const poller = new SorobanRpcEventPoller({
        startLedger: 2000,
        storageKey: 'test-poller-key-3',
        server: mockServer,
      });

      const subscriber = jest.fn();
      poller.subscribe(subscriber);

      const firstBatch = await poller.pollOnce();
      expect(firstBatch).toHaveLength(1);
      expect(subscriber).toHaveBeenCalledTimes(1);

      const secondBatch = await poller.pollOnce();
      expect(secondBatch).toHaveLength(0); // Deduplicated!
      expect(subscriber).toHaveBeenCalledTimes(1);
    });
  });
});
