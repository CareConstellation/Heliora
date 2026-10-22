import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AccessAuditTimeline, { filterAccessEvents } from '@/components/records/AccessAuditTimeline';
import type { RecordAccessEvent } from '@/types';

jest.mock('@/services/api.service', () => ({ fetchRecordAccessLog: jest.fn() }));
import { fetchRecordAccessLog } from '@/services/api.service';

const event = (over: Partial<RecordAccessEvent>): RecordAccessEvent => ({
  id: '1',
  recordId: 'HS-1',
  action: 'read',
  timestamp: '2026-01-01T00:00:00Z',
  accessorPublicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
  accessorName: 'Dr. Ada',
  accessorVerified: true,
  accessorSpecialty: 'Cardiology',
  authorizationToken: 'tok_abcdefghijklmnop',
  breakGlass: false,
  ...over,
});

const events = [
  event({ id: '1', timestamp: '2026-01-01T00:00:00Z' }),
  event({ id: '2', action: 'export', timestamp: '2026-03-01T00:00:00Z' }),
  event({
    id: '3',
    action: 'decrypt',
    breakGlass: true,
    accessorName: 'ER Team',
    timestamp: '2026-02-01T00:00:00Z',
  }),
];

describe('filterAccessEvents', () => {
  it('sorts newest first and filters by action or break-glass', () => {
    expect(filterAccessEvents(events, 'all').map((e) => e.id)).toEqual(['2', '3', '1']);
    expect(filterAccessEvents(events, 'export').map((e) => e.id)).toEqual(['2']);
    expect(filterAccessEvents(events, 'breakGlass').map((e) => e.id)).toEqual(['3']);
  });
});

describe('AccessAuditTimeline', () => {
  it('renders accessors and highlights break-glass access', async () => {
    (fetchRecordAccessLog as jest.Mock).mockResolvedValueOnce(events);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AccessAuditTimeline patientAddress="GPATIENT" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Emergency break-glass access')).toBeInTheDocument();
    expect(screen.getByText('ER Team')).toBeInTheDocument();
    expect(screen.getByText('1 emergency access')).toBeInTheDocument();
  });
});
