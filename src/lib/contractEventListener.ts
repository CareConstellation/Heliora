/**
 * Soroban contract event ingestion and WebSocket listener.
 * Real-time event streaming from contract transactions.
 * (Issue #3)
 */

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

class ContractEventManager {
  private listeners: Map<string, EventListener> = new Map();
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(config: WebSocketConfig) {
    this.config = config;
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
      
      // Dispatch to matching listeners
      this.listeners.forEach((listener) => {
        if (!listener.isActive) return;
        
        if (listener.contractId === event.contractId && 
            listener.eventTypes.includes(event.type)) {
          try {
            listener.callback(event);
          } catch (err) {
            console.error(`Listener error for ${listener.id}:`, err);
          }
        }
      });
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
