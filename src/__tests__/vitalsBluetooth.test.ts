import {
  decodeSfloat,
  parseHeartRateMeasurement,
  parsePulseOximeterContinuous,
} from '@/lib/biomarkerExtractor';
import {
  connectVitalsDevice,
  parseVitalsMessage,
  sendVitalsSample,
  VITALS_GATT,
} from '@/lib/vitalsBluetooth';

function view(...values: number[]): DataView {
  return new DataView(new Uint8Array(values).buffer);
}

type FakeCharacteristic = ReturnType<typeof makeCharacteristic>;

function makeCharacteristic() {
  const listeners: Array<() => void> = [];
  return {
    value: null as DataView | null,
    startNotifications: jest.fn().mockResolvedValue(undefined),
    stopNotifications: jest.fn().mockResolvedValue(undefined),
    addEventListener: jest.fn((_type: string, listener: () => void) => {
      listeners.push(listener);
    }),
    removeEventListener: jest.fn(),
    emit(value: DataView) {
      this.value = value;
      listeners.forEach((listener) => listener());
    },
  };
}

function installBluetooth(options: {
  heartRate?: FakeCharacteristic | null;
  pulseOximeter?: FakeCharacteristic | null;
  requestDevice?: jest.Mock;
}) {
  const server = {
    connected: true,
    connect: jest.fn(async () => server),
    disconnect: jest.fn(),
    getPrimaryService: jest.fn(async (uuid: string) => {
      if (uuid === VITALS_GATT.heartRateService && options.heartRate) {
        const characteristic = options.heartRate;
        return { getCharacteristic: async () => characteristic };
      }
      if (uuid === VITALS_GATT.pulseOximeterService && options.pulseOximeter) {
        const characteristic = options.pulseOximeter;
        return { getCharacteristic: async () => characteristic };
      }
      throw new Error('service not found');
    }),
  };

  const device = Object.assign(new EventTarget(), { name: 'Test monitor', gatt: server });
  const requestDevice = options.requestDevice ?? jest.fn(async () => device);
  Object.defineProperty(navigator, 'bluetooth', {
    configurable: true,
    value: { requestDevice },
  });

  return { server, device, requestDevice };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'bluetooth');
});

describe('feat(telemedicine): in-call vitals telemetry ingestion (#261)', () => {
  describe('decodeSfloat', () => {
    it('decodes a signed exponent and mantissa', () => {
      // 0xF3D9: exponent -1, mantissa 985 -> 98.5
      expect(decodeSfloat(0xf3d9)).toBeCloseTo(98.5);
      expect(decodeSfloat(0x0062)).toBe(98);
    });

    it('returns null for reserved special values', () => {
      expect(decodeSfloat(0x07ff)).toBeNull(); // NaN
      expect(decodeSfloat(0x07fe)).toBeNull(); // +INF
      expect(decodeSfloat(0x0802)).toBeNull(); // -INF
    });
  });

  describe('parseHeartRateMeasurement', () => {
    it('reads an 8-bit heart rate when the flag bit is clear', () => {
      expect(parseHeartRateMeasurement(view(0x00, 72))).toBe(72);
    });

    it('reads a 16-bit little-endian heart rate when the flag bit is set', () => {
      expect(parseHeartRateMeasurement(view(0x01, 0x00, 0x01))).toBe(256);
    });

    it('rejects truncated, zero, or implausible payloads', () => {
      expect(parseHeartRateMeasurement(view(0x00))).toBeNull();
      expect(parseHeartRateMeasurement(view(0x01, 0x00))).toBeNull();
      expect(parseHeartRateMeasurement(view(0x00, 0))).toBeNull();
      expect(parseHeartRateMeasurement(view(0x01, 0x90, 0x01))).toBeNull(); // 400 bpm
    });
  });

  describe('parsePulseOximeterContinuous', () => {
    it('parses SpO2 and pulse rate from the PLX continuous characteristic', () => {
      expect(parsePulseOximeterContinuous(view(0x00, 0x62, 0x00, 0x48, 0x00))).toEqual({
        spo2: 98,
        pulseRate: 72,
      });
    });

    it('rejects reserved SFLOAT values, out-of-range SpO2, and truncated payloads', () => {
      expect(parsePulseOximeterContinuous(view(0x00, 0xff, 0x07, 0x48, 0x00))).toBeNull(); // NaN SpO2
      expect(parsePulseOximeterContinuous(view(0x00, 0x65, 0x00, 0x48, 0x00))).toBeNull(); // 101 %
      expect(parsePulseOximeterContinuous(view(0x00, 0x62))).toBeNull();
    });
  });

  describe('parseVitalsMessage and sendVitalsSample', () => {
    it('accepts only well-formed vitals messages from the data channel', () => {
      const valid = JSON.stringify({ kind: 'spo2', value: 97, unit: '%', timestamp: 1 });
      expect(parseVitalsMessage(valid)).toEqual({ kind: 'spo2', value: 97, unit: '%', timestamp: 1 });
      expect(parseVitalsMessage(JSON.stringify({ kind: 'temperature', value: 37, unit: 'C', timestamp: 1 }))).toBeNull();
      expect(parseVitalsMessage(JSON.stringify({ kind: 'heart-rate', value: 'x', unit: 'bpm', timestamp: 1 }))).toBeNull();
      expect(parseVitalsMessage('not json')).toBeNull();
      expect(parseVitalsMessage(42)).toBeNull();
    });

    it('drops samples while the channel is not open', () => {
      const send = jest.fn();
      const sample = { kind: 'heart-rate' as const, value: 70, unit: 'bpm' as const, timestamp: 1 };

      expect(sendVitalsSample({ readyState: 'connecting', send }, sample)).toBe(false);
      expect(sendVitalsSample(null, sample)).toBe(false);
      expect(send).not.toHaveBeenCalled();

      expect(sendVitalsSample({ readyState: 'open', send }, sample)).toBe(true);
      expect(send).toHaveBeenCalledWith(JSON.stringify(sample));
    });
  });

  describe('connectVitalsDevice', () => {
    it('rejects as unsupported when Web Bluetooth is unavailable', async () => {
      await expect(connectVitalsDevice({ onSample: jest.fn() })).rejects.toMatchObject({
        name: 'VitalsBluetoothError',
        code: 'unsupported',
      });
    });

    it('reports a cancelled device chooser as cancelled', async () => {
      installBluetooth({
        heartRate: makeCharacteristic(),
        requestDevice: jest.fn().mockRejectedValue(new Error('User cancelled')),
      });

      await expect(connectVitalsDevice({ onSample: jest.fn() })).rejects.toMatchObject({
        code: 'cancelled',
      });
    });

    it('streams heart rate and SpO2 notifications to onSample and cleans up on disconnect', async () => {
      const heartRate = makeCharacteristic();
      const pulseOximeter = makeCharacteristic();
      const { server } = installBluetooth({ heartRate, pulseOximeter });
      const onSample = jest.fn();

      const connection = await connectVitalsDevice({ onSample, now: () => 1_234 });

      expect(connection.subscribed).toEqual(['heart-rate', 'spo2']);
      expect(connection.deviceName).toBe('Test monitor');

      heartRate.emit(view(0x00, 72));
      pulseOximeter.emit(view(0x00, 0x62, 0x00, 0x48, 0x00));

      expect(onSample).toHaveBeenNthCalledWith(1, {
        kind: 'heart-rate',
        value: 72,
        unit: 'bpm',
        timestamp: 1_234,
      });
      expect(onSample).toHaveBeenNthCalledWith(2, {
        kind: 'spo2',
        value: 98,
        unit: '%',
        timestamp: 1_234,
      });

      connection.disconnect();
      expect(heartRate.removeEventListener).toHaveBeenCalledTimes(1);
      expect(pulseOximeter.stopNotifications).toHaveBeenCalled();
      expect(server.disconnect).toHaveBeenCalledTimes(1);
    });

    it('fails when the device exposes neither heart rate nor pulse oximetry', async () => {
      const { server } = installBluetooth({ heartRate: null, pulseOximeter: null });

      await expect(connectVitalsDevice({ onSample: jest.fn() })).rejects.toMatchObject({
        code: 'no-vitals-service',
      });
      expect(server.disconnect).toHaveBeenCalled();
    });
  });
});
