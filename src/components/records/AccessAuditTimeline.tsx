'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, BadgeCheck, Download, Eye, KeyRound, Loader2, MapPin } from 'lucide-react';
import { fetchRecordAccessLog } from '@/services/api.service';
import type { RecordAccessEvent } from '@/types';

type Filter = 'all' | RecordAccessEvent['action'] | 'breakGlass';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'read', label: 'Viewed' },
  { key: 'decrypt', label: 'Decrypted' },
  { key: 'export', label: 'Exported' },
  { key: 'breakGlass', label: 'Break-glass' },
];

const ACTION_META: Record<RecordAccessEvent['action'], { label: string; Icon: typeof Eye }> = {
  read: { label: 'Viewed', Icon: Eye },
  decrypt: { label: 'Decrypted', Icon: KeyRound },
  export: { label: 'Exported', Icon: Download },
};

const short = (s: string, n = 6) => (s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);

/** Filters and sorts access events newest first. */
export function filterAccessEvents(events: RecordAccessEvent[], filter: Filter) {
  return events
    .filter(
      (e) => filter === 'all' || (filter === 'breakGlass' ? e.breakGlass : e.action === filter),
    )
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

function Location({ event }: { event: RecordAccessEvent }) {
  const { location, ip } = event;
  const place =
    [location?.city, location?.country].filter(Boolean).join(', ') || 'Unknown location';
  const hasCoords = typeof location?.lat === 'number' && typeof location?.lon === 'number';
  return (
    <span className="inline-flex items-center gap-1">
      <MapPin className="w-3 h-3" />
      {hasCoords ? (
        <a
          href={`https://www.openstreetmap.org/?mlat=${location!.lat}&mlon=${location!.lon}#map=10/${location!.lat}/${location!.lon}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-text-1"
        >
          {place}
        </a>
      ) : (
        place
      )}
      {ip && <span className="font-mono">({ip})</span>}
    </span>
  );
}

/** Chronological timeline of every read/decrypt/export of the patient's records. */
export default function AccessAuditTimeline({ patientAddress }: { patientAddress: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['record-access-log', patientAddress],
    queryFn: () => fetchRecordAccessLog(patientAddress),
  });

  const events = useMemo(() => filterAccessEvents(data ?? [], filter), [data, filter]);
  const breakGlassCount = data?.filter((e) => e.breakGlass).length ?? 0;

  return (
    <section aria-labelledby="access-audit-title">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 id="access-audit-title" className="text-sm font-semibold text-text-1">
            Record Access Audit Trail
          </h2>
          <p className="text-xs text-text-3 mt-0.5">
            Every time your records were viewed, decrypted or exported
          </p>
        </div>
        {breakGlassCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-red-50 border border-red-200 px-2 py-1 text-2xs font-semibold text-red-700">
            <AlertOctagon className="w-3 h-3" /> {breakGlassCount} emergency access
            {breakGlassCount > 1 ? 'es' : ''}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Filter access events">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-md px-2.5 py-1 text-xs border transition-colors ${
              filter === f.key
                ? 'border-border-focus text-text-1 bg-surface-hover'
                : 'border-border text-text-3'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <p className="flex items-center gap-2 text-xs text-text-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading access history…
        </p>
      )}
      {isError && <p className="text-xs text-red-600">Could not load the access audit trail.</p>}
      {!isLoading && !isError && events.length === 0 && (
        <p className="text-xs text-text-3">No access events.</p>
      )}

      <ol className="relative border-l border-border ml-2 space-y-4">
        {events.map((e) => {
          const { label, Icon } = ACTION_META[e.action];
          return (
            <li key={e.id} className="ml-4">
              <span
                className={`absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full ${e.breakGlass ? 'bg-red-500' : 'bg-green-500'}`}
                aria-hidden="true"
              />
              <div
                className={`rounded-lg border p-3 text-xs space-y-1.5 ${
                  e.breakGlass ? 'border-red-300 bg-red-50 text-red-950' : 'border-border'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <Icon className="w-3.5 h-3.5" /> {label} · record {e.recordId}
                  </span>
                  <time dateTime={e.timestamp} className="text-text-3">
                    {new Date(e.timestamp).toLocaleString()}
                  </time>
                </div>
                {e.breakGlass && (
                  <p className="inline-flex items-center gap-1 font-bold text-red-700">
                    <AlertOctagon className="w-3.5 h-3.5" /> Emergency break-glass access
                  </p>
                )}
                <p>
                  <span className="font-medium">{e.accessorName}</span>
                  {e.accessorVerified && (
                    <BadgeCheck
                      className="inline w-3.5 h-3.5 ml-1 text-green-600"
                      aria-label="Verified"
                    />
                  )}
                  {e.accessorSpecialty && (
                    <span className="text-text-3"> · {e.accessorSpecialty}</span>
                  )}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-text-3">
                  <dt>Public key</dt>
                  <dd className="font-mono truncate" title={e.accessorPublicKey}>
                    {short(e.accessorPublicKey)}
                  </dd>
                  <dt>Auth token</dt>
                  <dd className="font-mono truncate" title={e.authorizationToken}>
                    {short(e.authorizationToken, 8)}
                  </dd>
                  <dt>Location</dt>
                  <dd>
                    <Location event={e} />
                  </dd>
                </dl>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
