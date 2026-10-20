'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWalletStore } from '@/store/useWalletStore';
import { fetchAvailabilityConfig, updateAvailabilityConfig } from '@/services/api.service';
import type { AvailabilityBufferConfig } from '@/types';

const DEFAULT_CONFIG: AvailabilityBufferConfig = {
  bufferMinutes: 15,
  minNoticeHours: 2,
  emergencySlotsPerDay: 2,
  emergencySlotIds: [],
};

export default function AvailabilityConfig() {
  const { publicKey: address } = useWalletStore();
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<AvailabilityBufferConfig>(DEFAULT_CONFIG);

  const { data: saved, isLoading } = useQuery({
    queryKey: ['availability-config', address],
    queryFn: () => fetchAvailabilityConfig(address!),
    enabled: !!address,
    retry: false,
  });

  useEffect(() => {
    if (saved) setConfig(saved);
  }, [saved]);

  const saveMutation = useMutation({
    mutationFn: (cfg: AvailabilityBufferConfig) =>
      updateAvailabilityConfig(address!, cfg),
    onSuccess: (data) => {
      queryClient.setQueryData(['availability-config', address], data);
    },
  });

  function handleSave() {
    if (!address) return;
    saveMutation.mutate(config);
  }

  const isDirty =
    !saved ||
    saved.bufferMinutes !== config.bufferMinutes ||
    saved.minNoticeHours !== config.minNoticeHours ||
    saved.emergencySlotsPerDay !== config.emergencySlotsPerDay;

  if (isLoading) {
    return <div className="animate-pulse h-40 rounded-[14px] bg-surface-card" />;
  }

  return (
    <div
      className="rounded-[14px] p-5"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <h2 className="text-sm font-semibold text-text-1 mb-4">
        Availability &amp; Buffer Rules
      </h2>

      <div className="space-y-3.5">
        <div>
          <label className="text-xs text-text-2 mb-1 block">
            Buffer between appointments (minutes)
          </label>
          <input
            type="number"
            min={0}
            max={60}
            value={config.bufferMinutes}
            onChange={(e) =>
              setConfig((c) => ({
                ...c,
                bufferMinutes: Math.max(0, Math.min(60, +e.target.value)),
              }))
            }
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-text-1 focus:outline-none focus:ring-2 focus:ring-border-focus"
          />
        </div>

        <div>
          <label className="text-xs text-text-2 mb-1 block">
            Minimum notice for booking (hours)
          </label>
          <input
            type="number"
            min={0}
            max={72}
            value={config.minNoticeHours}
            onChange={(e) =>
              setConfig((c) => ({
                ...c,
                minNoticeHours: Math.max(0, Math.min(72, +e.target.value)),
              }))
            }
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-text-1 focus:outline-none focus:ring-2 focus:ring-border-focus"
          />
        </div>

        <div>
          <label className="text-xs text-text-2 mb-1 block">
            Emergency triage slots per day
          </label>
          <input
            type="number"
            min={0}
            max={10}
            value={config.emergencySlotsPerDay}
            onChange={(e) =>
              setConfig((c) => ({
                ...c,
                emergencySlotsPerDay: Math.max(0, Math.min(10, +e.target.value)),
              }))
            }
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-text-1 focus:outline-none focus:ring-2 focus:ring-border-focus"
          />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saveMutation.isPending || !isDirty}
        className="mt-4 w-full rounded-lg py-2 text-xs font-semibold transition-colors disabled:opacity-40"
        style={{
          background: 'rgba(0,200,150,0.1)',
          color: '#00C896',
          border: '1px solid rgba(0,200,150,0.2)',
        }}
      >
        {saveMutation.isPending ? 'Saving…' : 'Save Configuration'}
      </button>

      {saveMutation.isSuccess && (
        <p className="mt-2 text-xs text-green-500 text-center">
          Configuration saved successfully.
        </p>
      )}
    </div>
  );
}
