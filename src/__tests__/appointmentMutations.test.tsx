import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  describeCancellationError,
  markAppointmentCancelled,
  rollbackAppointmentCancellation,
  useCancelAppointmentMutation,
} from '@/services/appointmentMutations';
import { cancelAppointmentWithPenalty } from '@/services/api.service';
import type { Appointment } from '@/types';

jest.mock('@/services/api.service', () => ({
  cancelAppointmentWithPenalty: jest.fn(),
}));

const base: Appointment = {
  id: 'a1',
  doctorId: 'd1',
  doctorName: 'Smith',
  patientAddress: 'GPATIENT',
  datetime: '2026-12-01T10:00:00.000Z',
  type: 'in-person',
  status: 'confirmed',
  fee: 10,
};
const a1 = base;
const a2: Appointment = { ...base, id: 'a2', status: 'pending' };

describe('appointment cancellation cache helpers', () => {
  it('marks only the target appointment cancelled without mutating input', () => {
    const list = [a1, a2];
    const next = markAppointmentCancelled(list, 'a1');
    expect(next?.map((a) => a.status)).toEqual(['cancelled', 'pending']);
    expect(list[0]!.status).toBe('confirmed');
  });

  it('rolls back only the failed appointment, preserving other optimistic cancels', () => {
    const snapshot = [a1, a2];
    // a1 failed; a2 was optimistically cancelled by a later, still-pending mutation.
    const current = [
      { ...a1, status: 'cancelled' as const },
      { ...a2, status: 'cancelled' as const },
    ];
    const restored = rollbackAppointmentCancellation(
      current,
      { previousAppointments: snapshot, previousStatus: 'confirmed' },
      'a1',
    );
    expect(restored?.map((a) => a.status)).toEqual(['confirmed', 'cancelled']);
  });

  it('restores the full snapshot when the cache was cleared meanwhile', () => {
    const snapshot = [a1];
    expect(
      rollbackAppointmentCancellation(
        undefined,
        { previousAppointments: snapshot, previousStatus: 'confirmed' },
        'a1',
      ),
    ).toBe(snapshot);
  });

  it.each([
    [{ code: 'ERR_NETWORK', status: 500 }, /could not reach the network/i],
    [{ status: 409 }, /changed on the server/i],
    [{ status: 403 }, /not authorized/i],
    [{ status: 404 }, /no longer exists/i],
    [{ status: 503 }, /temporarily unavailable/i],
    [{ status: 400, message: 'Too late to cancel' }, /too late to cancel/i],
  ])('explains %p', (error, expected) => {
    expect(describeCancellationError(error)).toMatch(expected);
  });
});

describe('useCancelAppointmentMutation', () => {
  const key = ['patient-appointments', 'GPATIENT'];

  function setup() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(key, [a1, a2]);
    const onOptimisticCancel = jest.fn();
    const onRollback = jest.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useCancelAppointmentMutation({ queryKey: key, onOptimisticCancel, onRollback }),
      { wrapper },
    );
    return { queryClient, result, onOptimisticCancel, onRollback };
  }

  beforeEach(() => jest.clearAllMocks());

  it('snapshots in onMutate and updates the cache before the request resolves', async () => {
    let resolve!: (a: Appointment) => void;
    (cancelAppointmentWithPenalty as jest.Mock).mockReturnValue(new Promise((r) => (resolve = r)));
    const { queryClient, result, onOptimisticCancel } = setup();

    act(() => result.current.mutate(a1));

    await waitFor(() => expect(onOptimisticCancel).toHaveBeenCalledWith(a1));
    expect(queryClient.getQueryData<Appointment[]>(key)?.[0]?.status).toBe('cancelled');
    expect(cancelAppointmentWithPenalty).toHaveBeenCalledWith('a1', true);

    await act(async () => resolve({ ...a1, status: 'cancelled' }));
  });

  it('keeps a concurrent cancellation when another one fails, and exposes retry', async () => {
    let rejectA1!: (e: unknown) => void;
    let resolveA2!: (a: Appointment) => void;
    (cancelAppointmentWithPenalty as jest.Mock).mockImplementation((id: string) =>
      id === 'a1'
        ? new Promise((_, rej) => (rejectA1 = rej))
        : new Promise((res) => (resolveA2 = res)),
    );
    const { queryClient, result, onRollback } = setup();

    act(() => result.current.mutate(a1));
    await waitFor(() => expect(cancelAppointmentWithPenalty).toHaveBeenCalledTimes(1));
    act(() => result.current.mutate(a2));
    await waitFor(() => expect(cancelAppointmentWithPenalty).toHaveBeenCalledTimes(2));

    await act(async () =>
      rejectA1({ message: 'boom', status: 503, code: 'ERR_BAD_RESPONSE', data: null }),
    );

    await waitFor(() => expect(onRollback).toHaveBeenCalled());
    const statuses = queryClient.getQueryData<Appointment[]>(key)?.map((a) => a.status);
    expect(statuses).toEqual(['confirmed', 'cancelled']);

    const [appointment, explanation, retry] = onRollback.mock.calls[0];
    expect(appointment.id).toBe('a1');
    expect(explanation).toMatch(/temporarily unavailable/i);
    expect(typeof retry).toBe('function');

    await act(async () => resolveA2({ ...a2, status: 'cancelled' }));
  });
});
