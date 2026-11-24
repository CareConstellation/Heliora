/**
 * Soroban contract event ingestion, RPC getEvents polling, and real-time event streaming.
 * (Issues #3, #193)
 */

import { rpc, xdr, scValToNative } from '@stellar/stellar-sdk';
import { get, set } from 'idb-keyval';
import { STELLAR_CONFIG } from './stellar';

export interface ContractEvent {
  id: string;
  type: EventType;
  contractId: string;
  ledgerSequence: number;
  transactionHash: string;
  timestamp: number;
  data: Record<string, unknown>;
  processedAt: number;
}

export enum EventType {
  AccessGranted = 'access_granted',
  AccessRevoked = 'access_revoked',
  RecordShared = 'record_shared',
  EscrowReleased = 'escrow_released',
  ConsultationCompleted = 'consultation_completed',
  PaymentProcessed = 'payment_processed',
  DelegationCreated = 'delegation_created',
  DelegationExpired = 'delegation_expired',
  AppointmentBooked = 'appointment_booked',
}

export interface EventListener {
  id: string;
  contractId: string;
  eventTypes: EventType[];
  callback: (event: ContractEvent) => void;
  isActive: boolean;
}

export interface WebSocketConfig {
  url: string;
  reconnectAttempts: number;
  reconnectDelay: number;
}

export interface SorobanPollerConfig {
  rpcUrl?: string;
  contractIds?: string[];
  pollIntervalMs?: number;
  storageKey?: string;
  startLedger?: number;
  maxEventsPerPoll?: number;
  server?: any;
}

const DEFAULT_EVENT_CURSOR_STORAGE_KEY = 'heliora-soroban-event-cursor';
const inMemoryCursorStore = new Map<string, number>();

/**
 * Decodes an XDR topic element into a string symbol.
 * Handles xdr.ScVal (scvSymbol), base64 XDR strings, and raw string symbols.
 */
export function decodeXdrTopicSymbol(topic: unknown): string {
  if (!topic) return '';

  // 1. Direct xdr.ScVal
  if (typeof topic === 'object' && typeof (topic as any).switch === 'function') {
    const scVal = topic as xdr.ScVal;
    try {
      if (scVal.switch().name === 'scvSymbol') {
        return scVal.sym().toString();
      }
      const native = scValToNative(scVal);
      return typeof native === 'string' ? native : String(native);
    } catch {
      return '';
    }
  }

  // 2. Base64-encoded XDR string or plain string
  if (typeof topic === 'string') {
    const trimmed = topic.trim();
    try {
      const scVal = xdr.ScVal.fromXDR(trimmed, 'base64');
      if (scVal.switch().name === 'scvSymbol') {
        return scVal.sym().toString();
      }
      const native = scValToNative(scVal);
      return typeof native === 'string' ? native : String(native);
    } catch {
      // Fallback: If not valid base64 XDR, return trimmed string
      return trimmed;
    }
  }

  return String(topic);
}

/**
 * Maps decoded XDR topic symbols to domain EventType.
 */
export const TOPIC_SYMBOL_MAP: Record<string, EventType> = {
  AppointmentBooked: EventType.AppointmentBooked,
  appointment_booked: EventType.AppointmentBooked,
  RecordShared: EventType.RecordShared,
  record_shared: EventType.RecordShared,
  AccessGranted: EventType.AccessGranted,
  access_granted: EventType.AccessGranted,
  AccessRevoked: EventType.AccessRevoked,
  access_revoked: EventType.AccessRevoked,
  EscrowReleased: EventType.EscrowReleased,
  escrow_released: EventType.EscrowReleased,
  ConsultationCompleted: EventType.ConsultationCompleted,
  consultation_completed: EventType.ConsultationCompleted,
  PaymentProcessed: EventType.PaymentProcessed,
  payment_processed: EventType.PaymentProcessed,
  DelegationCreated: EventType.DelegationCreated,
  delegation_created: EventType.DelegationCreated,
  DelegationExpired: EventType.DelegationExpired,
  delegation_expired: EventType.DelegationExpired,
};

/**
 * Loads the persisted startLedger cursor from IndexedDB with safe in-memory fallback.
 */
export async function loadPersistedCursor(storageKey: string): Promise<number | null> {
  try {
    const val = await get(storageKey);
    if (typeof val === 'number' && !isNaN(val)) return val;
    if (typeof val === 'string') {
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed)) return parsed;
    }
  } catch {
    // Non-fatal: IndexedDB might be unavailable
  }
  return inMemoryCursorStore.get(storageKey) ?? null;
}

/**
 * Persists the cursor in IndexedDB with safe in-memory fallback.
 */
export async function savePersistedCursor(storageKey: string, cursor: number): Promise<void> {
  inMemoryCursorStore.set(storageKey, cursor);
  try {
    await set(storageKey, cursor);
  } catch {
    // Non-fatal: IndexedDB might be unavailable
  }
}

/**
 * Real-time polling worker for Soroban RPC getEvents.
 * Tracks startLedger, decodes topics, deduplicates event processing, and advances cursor.
 */
export class SorobanRpcEventPoller {
  private rpcUrl: string;
  private contractIds: string[];
  private pollIntervalMs: number;
  private storageKey: string;
  private maxEventsPerPoll: number;
  private currentLedger: number;
  private isRunning = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private seenEventIds = new Set<string>();
  private maxSeenIds = 2000;
  private listeners: Set<(event: ContractEvent) => void> = new Set();
  private server: rpc.Server | null = null;

  constructor(config: SorobanPollerConfig = {}) {
    this.rpcUrl = config.rpcUrl || STELLAR_CONFIG.sorobanRpcUrl || 'https://soroban-testnet.stellar.org';
    this.contractIds = config.contractIds || [];
    this.pollIntervalMs = config.pollIntervalMs || 3000;
    this.storageKey = config.storageKey || DEFAULT_EVENT_CURSOR_STORAGE_KEY;
    this.maxEventsPerPoll = config.maxEventsPerPoll || 100;
    this.currentLedger = config.startLedger ?? 0;
    if (config.server) {
      this.server = config.server;
    }
  }

  public subscribe(callback: (event: ContractEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    if (!this.server) {
      this.server = new rpc.Server(this.rpcUrl);
    }

    // Initialize startLedger cursor from IndexedDB if not explicitly set
    if (!this.currentLedger) {
      const persisted = await loadPersistedCursor(this.storageKey);
      if (persisted && persisted > 0) {
        this.currentLedger = persisted;
      } else {
        try {
          const latest = await this.server.getLatestLedger();
          this.currentLedger = latest.sequence;
          await savePersistedCursor(this.storageKey, this.currentLedger);
        } catch {
          this.currentLedger = 1;
        }
      }
    }

    this.scheduleNextPoll(0);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public getCurrentCursor(): number {
    return this.currentLedger;
  }

  public async advanceCursor(nextLedger: number): Promise<void> {
    if (nextLedger > this.currentLedger) {
      this.currentLedger = nextLedger;
      await savePersistedCursor(this.storageKey, nextLedger);
    }
  }

  public async pollOnce(): Promise<ContractEvent[]> {
    if (!this.server) {
      this.server = new rpc.Server(this.rpcUrl);
    }

    try {
      const filters = this.contractIds.length > 0
        ? [{ type: 'contract' as const, contractIds: this.contractIds }]
        : [{ type: 'contract' as const }];

      const response = await this.server.getEvents({
        startLedger: this.currentLedger,
        filters,
        limit: this.maxEventsPerPoll,
      });

      const events: ContractEvent[] = [];
      let highestSeenLedger = this.currentLedger;

      if (response && Array.isArray(response.events)) {
        for (const rawEv of response.events) {
          if (!rawEv.id || this.seenEventIds.has(rawEv.id)) {
            continue;
          }

          // Bound memory for deduplication
          this.seenEventIds.add(rawEv.id);
          if (this.seenEventIds.size > this.maxSeenIds) {
            const oldest = this.seenEventIds.values().next().value;
            if (oldest) this.seenEventIds.delete(oldest);
          }

          // Decode topic symbols (e.g. AppointmentBooked, RecordShared)
          const topics = Array.isArray(rawEv.topic) ? rawEv.topic : [];
          const decodedTopics = topics.map(decodeXdrTopicSymbol);
          const primaryTopic = decodedTopics[0] || '';
          const eventType = TOPIC_SYMBOL_MAP[primaryTopic] || EventType.RecordShared;

          // Decode payload value
          let eventData: Record<string, unknown> = {
            topics: decodedTopics,
            rawTopic: topics,
          };

          if (rawEv.value) {
            try {
              const nativeVal = scValToNative(rawEv.value);
              if (nativeVal && typeof nativeVal === 'object') {
                eventData = { ...eventData, ...nativeVal };
              } else {
                eventData.value = nativeVal;
              }
            } catch {
              // Ignore value decoding error
            }
          }

          const contractIdStr = typeof rawEv.contractId === 'string'
            ? rawEv.contractId
            : (rawEv.contractId as any)?.contractId?.() || '';

          const contractEvent: ContractEvent = {
            id: rawEv.id,
            type: eventType,
            contractId: contractIdStr,
            ledgerSequence: rawEv.ledger,
            transactionHash: rawEv.txHash || '',
            timestamp: rawEv.ledgerClosedAt ? new Date(rawEv.ledgerClosedAt).getTime() : Date.now(),
            data: eventData,
            processedAt: Date.now(),
          };

          events.push(contractEvent);
          if (rawEv.ledger > highestSeenLedger) {
            highestSeenLedger = rawEv.ledger;
          }
        }
      }

      // Advance cursor beyond highest processed ledger
      if (highestSeenLedger >= this.currentLedger && events.length > 0) {
        await this.advanceCursor(highestSeenLedger + 1);
      } else if (response && (response as any).latestLedger && (response as any).latestLedger > this.currentLedger) {
        // If no events matched, advance to latestLedger to keep cursor fresh
        await this.advanceCursor((response as any).latestLedger);
      }

      // Dispatch to active subscribers
      for (const event of events) {
        this.listeners.forEach(cb => {
          try {
            cb(event);
          } catch (err) {
            console.error('Error in Soroban event subscriber callback:', err);
          }
        });
      }

      return events;
    } catch (err) {
      // Non-fatal: temporary network error
      console.warn('Soroban getEvents poll failed:', err);
      return [];
    }
  }

  private scheduleNextPoll(delayMs = this.pollIntervalMs): void {
    if (!this.isRunning) return;
    this.pollTimer = setTimeout(() => {
      void this.pollOnce().finally(() => {
        if (this.isRunning) {
          this.scheduleNextPoll(this.pollIntervalMs);
        }
      });
    }, delayMs);
  }
}


class ContractEventManager {
  private listeners: Map<string, EventListener> = new Map();
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  public rpcPoller: SorobanRpcEventPoller;

  constructor(config: WebSocketConfig, pollerConfig?: SorobanPollerConfig) {
    this.config = config;
    this.rpcPoller = new SorobanRpcEventPoller(pollerConfig);
    this.rpcPoller.subscribe((event) => this.dispatchEvent(event));
  }

  /**
   * Dispatches a contract event to registered matching listeners.
   */
  public dispatchEvent(event: ContractEvent): void {
    this.listeners.forEach((listener) => {
      if (!listener.isActive) return;

      const contractMatches = !listener.contractId || listener.contractId === event.contractId;
      const typeMatches = listener.eventTypes.length === 0 || listener.eventTypes.includes(event.type);

      if (contractMatches && typeMatches) {
        try {
          listener.callback(event);
        } catch (err) {
          console.error(`Listener error for ${listener.id}:`, err);
        }
      }
    });
  }

  /**
   * Starts Soroban RPC getEvents polling worker.
   */
  public async startRpcPolling(config?: SorobanPollerConfig): Promise<void> {
    if (config) {
      this.rpcPoller.stop();
      this.rpcPoller = new SorobanRpcEventPoller(config);
      this.rpcPoller.subscribe((event) => this.dispatchEvent(event));
    }
    await this.rpcPoller.start();
  }

  /**
   * Stops Soroban RPC getEvents polling worker.
   */
  public stopRpcPolling(): void {
    this.rpcPoller.stop();
  }

  /**
   * Registers an event listener for specific contract events.
   */
  registerListener(
    contractId: string,
    eventTypes: EventType[],
    callback: (event: ContractEvent) => void,
  ): string {
    const listenerId = `listener_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    
    this.listeners.set(listenerId, {
      id: listenerId,
      contractId,
      eventTypes,
      callback,
      isActive: true,
    });
    
    return listenerId;
  }

  /**
   * Unregisters an event listener.
   */
  unregisterListener(listenerId: string): boolean {
    return this.listeners.delete(listenerId);
  }

  /**
   * Connects to the WebSocket event stream.
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);
        
        this.ws.onopen = () => {
          console.log('Connected to contract event stream');
          this.reconnectAttempts = 0;
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
        
        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(new Error('WebSocket connection failed'));
        };
        
        this.ws.onclose = () => {
          console.log('Disconnected from event stream');
          this.attemptReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnects from the WebSocket event stream.
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Handles incoming WebSocket messages.
   */
  private handleMessage(message: string): void {
    try {
      const event = JSON.parse(message) as ContractEvent;
      event.processedAt = Date.now();
      this.dispatchEvent(event);
    } catch (err) {
      console.error('Failed to parse event message:', err);
    }
  }

  /**
   * Attempts to reconnect after disconnection.
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`Attempting reconnection in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect().catch(err => {
        console.error('Reconnection failed:', err);
      });
    }, delay);
  }

  /**
   * Gets all active listeners.
   */
  getActiveListeners(): EventListener[] {
    return Array.from(this.listeners.values()).filter(l => l.isActive);
  }

  /**
   * Disables a listener temporarily without removing it.
   */
  disableListener(listenerId: string): boolean {
    const listener = this.listeners.get(listenerId);
    if (listener) {
      listener.isActive = false;
      return true;
    }
    return false;
  }

  /**
   * Re-enables a previously disabled listener.
   */
  enableListener(listenerId: string): boolean {
    const listener = this.listeners.get(listenerId);
    if (listener) {
      listener.isActive = true;
      return true;
    }
    return false;
  }
}

// Export singleton instance
export const eventManager = new ContractEventManager({
  url: process.env.NEXT_PUBLIC_EVENT_STREAM_URL || 'ws://localhost:8000/events',
  reconnectAttempts: 5,
  reconnectDelay: 1000,
});

/**
 * Formats a contract event for logging.
 */
export function formatContractEvent(event: ContractEvent): string {
  return `[${event.type}] Contract: ${event.contractId} | Ledger: ${event.ledgerSequence} | Tx: ${event.transactionHash}`;
}
