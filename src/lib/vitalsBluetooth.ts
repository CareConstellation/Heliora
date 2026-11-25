import {
  parseHeartRateMeasurement,
  parsePulseOximeterContinuous,
  type VitalSample,
  type VitalSignKind,
} from '@/lib/biomarkerExtractor';

/* ── Standard Bluetooth GATT identifiers ───────────────────────────── */

const uuid16 = (id: number) => `0000${id.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;

export const VITALS_GATT = {
  heartRateService: uuid16(0x180d),
  heartRateMeasurement: uuid16(0x2a37),
  pulseOximeterService: uuid16(0x1822),
  plxContinuousMeasurement: uuid16(0x2a5f),
} as const;

/** Label of the WebRTC data channel that carries vitals to the physician. */
export const VITALS_CHANNEL_LABEL = 'heliora-vitals';

/* ── Minimal Web Bluetooth typings (not part of the TypeScript DOM lib) ── */

interface GattCharacteristicLike {
  readonly value?: DataView | null;
  startNotifications(): Promise<unknown>;
  stopNotifications(): Promise<unknown>;
  addEventListener(type: 'characteristicvaluechanged', listener: () => void): void;
  removeEventListener(type: 'characteristicvaluechanged', listener: () => void): void;
}

interface GattServiceLike {
  getCharacteristic(uuid: string): Promise<GattCharacteristicLike>;
}

interface GattServerLike {
  readonly connected: boolean;
  connect(): Promise<GattServerLike>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<GattServiceLike>;
}

export interface VitalsBluetoothDevice extends EventTarget {
  readonly name?: string;
  readonly gatt?: GattServerLike;
}

interface BluetoothLike {
  requestDevice(options: {
    filters: Array<{ services: string[] }>;
    optionalServices?: string[];
  }): Promise<VitalsBluetoothDevice>;
}

/* ── Errors & connection ───────────────────────────────────────────── */

export type VitalsBluetoothErrorCode =
  | 'unsupported'
  | 'cancelled'
  | 'connect-failed'
  | 'no-vitals-service';

export class VitalsBluetoothError extends Error {
  readonly code: VitalsBluetoothErrorCode;

  constructor(message: string, code: VitalsBluetoothErrorCode) {
    super(message);
    this.name = 'VitalsBluetoothError';
    this.code = code;
  }
}

export interface VitalsConnection {
  deviceName: string;
  /** Kinds of vitals that have a live notification subscription. */
  subscribed: VitalSignKind[];
  disconnect: () => void;
}

export interface ConnectVitalsOptions {
  onSample: (sample: VitalSample) => void;
  onDisconnected?: () => void;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

function getBluetooth(): BluetoothLike | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth ?? null;
}

/**
 * Pairs with a standard heart-rate monitor and/or pulse oximeter over Web Bluetooth,
 * then streams parsed samples to `onSample`. Only devices that expose at least one of
 * the two services can be selected.
 *
 * Web Bluetooth is available in Chromium-based browsers only; other browsers reject
 * with `VitalsBluetoothError` code `'unsupported'`.
 *
 * Time: O(1) setup, O(1) per notification. Space: O(1).
 */
export async function connectVitalsDevice(options: ConnectVitalsOptions): Promise<VitalsConnection> {
  const { onSample, onDisconnected, now = Date.now } = options;

  const bluetooth = getBluetooth();
  if (!bluetooth) {
    throw new VitalsBluetoothError('Bluetooth devices are not supported in this browser.', 'unsupported');
  }

  const services = [VITALS_GATT.heartRateService, VITALS_GATT.pulseOximeterService];
  let device: VitalsBluetoothDevice;
  try {
    device = await bluetooth.requestDevice({
      filters: services.map((uuid) => ({ services: [uuid] })),
      optionalServices: services,
    });
  } catch {
    throw new VitalsBluetoothError('No vitals device was selected.', 'cancelled');
  }

  if (!device.gatt) {
    throw new VitalsBluetoothError('The selected device does not expose GATT services.', 'connect-failed');
  }

  let server: GattServerLike;
  try {
    server = await device.gatt.connect();
  } catch {
    throw new VitalsBluetoothError('Could not connect to the vitals device.', 'connect-failed');
  }

  const subscriptions: Array<{ characteristic: GattCharacteristicLike; listener: () => void }> = [];
  const subscribed: VitalSignKind[] = [];

  const subscribe = async (
    serviceUuid: string,
    characteristicUuid: string,
    kind: VitalSignKind,
    handle: (characteristic: GattCharacteristicLike) => VitalSample | null,
  ): Promise<void> => {
    try {
      const service = await server.getPrimaryService(serviceUuid);
      const characteristic = await service.getCharacteristic(characteristicUuid);
      const listener = () => {
        const sample = handle(characteristic);
        if (sample) onSample(sample);
      };
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', listener);
      subscriptions.push({ characteristic, listener });
      subscribed.push(kind);
    } catch {
      // Device does not offer this service; the other one may still work.
    }
  };

  await subscribe(VITALS_GATT.heartRateService, VITALS_GATT.heartRateMeasurement, 'heart-rate', (characteristic) => {
    const bpm = characteristic.value ? parseHeartRateMeasurement(characteristic.value) : null;
    return bpm === null ? null : { kind: 'heart-rate', value: bpm, unit: 'bpm', timestamp: now() };
  });

  await subscribe(VITALS_GATT.pulseOximeterService, VITALS_GATT.plxContinuousMeasurement, 'spo2', (characteristic) => {
    const reading = characteristic.value ? parsePulseOximeterContinuous(characteristic.value) : null;
    return reading === null ? null : { kind: 'spo2', value: reading.spo2, unit: '%', timestamp: now() };
  });

  if (subscriptions.length === 0) {
    server.disconnect();
    throw new VitalsBluetoothError('The selected device does not provide heart rate or SpO2.', 'no-vitals-service');
  }

  const handleDisconnect = () => {
    onDisconnected?.();
  };
  device.addEventListener('gattserverdisconnected', handleDisconnect);

  return {
    deviceName: device.name ?? 'Vitals device',
    subscribed,
    disconnect: () => {
      device.removeEventListener('gattserverdisconnected', handleDisconnect);
      for (const { characteristic, listener } of subscriptions) {
        characteristic.removeEventListener('characteristicvaluechanged', listener);
        void characteristic.stopNotifications().catch(() => undefined);
      }
      subscriptions.length = 0;
      if (server.connected) server.disconnect();
    },
  };
}

/* ── Streaming to the physician over a WebRTC data channel ────────── */

/**
 * Opens the ordered data channel that carries vitals to the other participant.
 * The caller owns the returned channel and must close it.
 */
export function openVitalsChannel(peerConnection: RTCPeerConnection): RTCDataChannel {
  return peerConnection.createDataChannel(VITALS_CHANNEL_LABEL, { ordered: true });
}

/**
 * Sends one sample if the channel is open. Samples are dropped, not queued, while
 * the channel is not open, because a stale reading is not useful to the physician.
 *
 * Returns `true` when the sample was sent.
 */
export function sendVitalsSample(
  channel: Pick<RTCDataChannel, 'readyState' | 'send'> | null,
  sample: VitalSample,
): boolean {
  if (!channel || channel.readyState !== 'open') return false;
  channel.send(JSON.stringify(sample));
  return true;
}

/**
 * Validates an incoming data-channel message from the other participant.
 * Anything that is not a well-formed vitals sample returns `null`.
 */
export function parseVitalsMessage(data: unknown): VitalSample | null {
  if (typeof data !== 'string') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const { kind, value, unit, timestamp } = parsed as Record<string, unknown>;
  const isHeartRate = kind === 'heart-rate' && unit === 'bpm';
  const isSpo2 = kind === 'spo2' && unit === '%';
  if (!(isHeartRate || isSpo2)) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;

  return {
    kind: kind as VitalSignKind,
    value,
    unit: unit as VitalSample['unit'],
    timestamp,
  };
}
