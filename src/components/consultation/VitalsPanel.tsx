'use client';

import { useEffect, useRef, useState } from 'react';
import type { VitalSample, VitalSignKind } from '@/lib/biomarkerExtractor';
import {
  connectVitalsDevice,
  openVitalsChannel,
  sendVitalsSample,
  VitalsBluetoothError,
  type VitalsConnection,
} from '@/lib/vitalsBluetooth';

interface Props {
  /**
   * When provided, each reading is also sent to the other participant over a WebRTC
   * data channel. Without it, readings stay on this device.
   */
  peerConnection?: RTCPeerConnection | null;
}

type PanelStatus = 'idle' | 'connecting' | 'connected' | 'error';

const READINGS: Array<{ kind: VitalSignKind; label: string }> = [
  { kind: 'heart-rate', label: 'Heart rate' },
  { kind: 'spo2', label: 'SpO2' },
];

/**
 * Pairs a Bluetooth heart-rate monitor or pulse oximeter and shows live readings
 * during the consultation.
 */
export default function VitalsPanel({ peerConnection = null }: Props) {
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [latest, setLatest] = useState<Partial<Record<VitalSignKind, VitalSample>>>({});

  const connectionRef = useRef<VitalsConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);

  useEffect(() => {
    if (!peerConnection) return;
    const channel = openVitalsChannel(peerConnection);
    channelRef.current = channel;
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [peerConnection]);

  useEffect(() => {
    return () => {
      connectionRef.current?.disconnect();
      connectionRef.current = null;
    };
  }, []);

  const handleConnect = async () => {
    setStatus('connecting');
    setMessage(null);
    try {
      connectionRef.current = await connectVitalsDevice({
        onSample: (sample) => {
          setLatest((prev) => ({ ...prev, [sample.kind]: sample }));
          sendVitalsSample(channelRef.current, sample);
        },
        onDisconnected: () => {
          connectionRef.current = null;
          setStatus('idle');
          setMessage('The vitals device disconnected.');
        },
      });
      setStatus('connected');
      setMessage(`Connected to ${connectionRef.current.deviceName}.`);
    } catch (err) {
      setStatus('error');
      setMessage(
        err instanceof VitalsBluetoothError ? err.message : 'Could not connect to the vitals device.',
      );
    }
  };

  const handleDisconnect = () => {
    connectionRef.current?.disconnect();
    connectionRef.current = null;
    setStatus('idle');
    setMessage(null);
  };

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-1">Live vitals</h3>
        {status === 'connected' ? (
          <button
            type="button"
            onClick={handleDisconnect}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-1 hover:bg-surface-hover"
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            disabled={status === 'connecting'}
            className="rounded-md bg-green px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {status === 'connecting' ? 'Pairing…' : 'Pair Bluetooth device'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {READINGS.map(({ kind, label }) => {
          const sample = latest[kind];
          return (
            <div key={kind} className="rounded-lg border border-border bg-surface-inset p-3">
              <p className="text-3xs uppercase tracking-wide text-text-3">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-text-1" data-testid={`vital-${kind}`}>
                {sample ? Math.round(sample.value) : '—'}
                <span className="ml-1 text-xs font-normal text-text-3">{sample ? sample.unit : ''}</span>
              </p>
              {sample && (
                <p className="mt-1 text-3xs text-text-3">
                  Updated {new Date(sample.timestamp).toLocaleTimeString()}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {message && (
        <p role="status" className={`text-xs ${status === 'error' ? 'text-red-600' : 'text-text-2'}`}>
          {message}
        </p>
      )}

      {!peerConnection && (
        <p className="text-3xs text-text-3">
          Readings are shown on this device only. They are sent to the physician once a call connection is available.
        </p>
      )}
    </div>
  );
}
