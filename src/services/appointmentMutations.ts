'use client';

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { cancelAppointmentWithPenalty, type ApiError } from '@/services/api.service';
import { traceUserAction } from '@/lib/sentry';
import type { Appointment } from '@/types';

/** Mutation key shared by every in-flight cancellation, used to coordinate refetches. */
export const CANCEL_APPOINTMENT_MUTATION_KEY = ['appointments', 'cancel'] as const;

export interface CancelAppointmentContext {
  /** Full snapshot of the appointment list taken before the optimistic write. */
  previousAppointments: Appointment[] | undefined;
  /** Status the cancelled appointment had before the optimistic write. */
  previousStatus: Appointment['status'] | undefined;
}

/** Returns a copy of `appointments` with `id` marked as cancelled. */
export function markAppointmentCancelled(
  appointments: Appointment[] | undefined,
  id: string,
): Appointment[] | undefined {
  return appointments?.map((item) =>
    item.id === id ? { ...item, status: 'cancelled' as const } : item,
  );
}

/**
 * Restores a single appointment's status from the pre-mutation snapshot.
 *
 * Only the failed appointment is reverted, so a concurrent optimistic cancel of a
 * different appointment is not clobbered by restoring the whole snapshot.
 */
export function rollbackAppointmentCancellation(
  current: Appointment[] | undefined,
  context: CancelAppointmentContext | undefined,
  id: string,
): Appointment[] | undefined {
  if (!context) return current;
  if (!current) return context.previousAppointments;

  const previous = context.previousAppointments?.find((item) => item.id === id);
  const status = previous?.status ?? context.previousStatus;
  if (!status) return current;

  return current.map((item) => (item.id === id ? { ...item, status } : item));
}

/** Turns an {@link ApiError} into an explanation a patient can act on. */
export function describeCancellationError(error: Partial<ApiError> | undefined): string {
  const status = error?.status ?? 0;
  const code = error?.code ?? '';

  if (code === 'ERR_NETWORK' || code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
    return 'We could not reach the network, so nothing was cancelled.';
  }
  if (status === 409) {
    return 'The appointment changed on the server (it may have already started or been rescheduled).';
  }
  if (status === 401 || status === 403) {
    return 'Your session is not authorized to cancel this appointment. Please reconnect your wallet.';
  }
  if (status === 404) {
    return 'This appointment no longer exists.';
  }
  if (status >= 500) {
    return 'The cancellation service is temporarily unavailable.';
  }
  return error?.message || 'The cancellation could not be completed.';
}

export interface UseCancelAppointmentOptions {
  /** Query whose cached `Appointment[]` is updated optimistically. */
  queryKey: QueryKey;
  /** Runs synchronously right after the optimistic write (e.g. switch to the Canceled tab). */
  onOptimisticCancel?: (appointment: Appointment) => void;
  /** Runs after the cache has been rolled back. `retry` re-submits the same cancellation. */
  onRollback?: (
    appointment: Appointment,
    explanation: string,
    retry: () => void,
    error: ApiError,
  ) => void;
  onCancelled?: (appointment: Appointment) => void;
}

/**
 * Optimistic appointment cancellation.
 *
 * - `onMutate` cancels in-flight refetches, snapshots the cached list and marks the
 *   appointment cancelled before the request is sent.
 * - `onError` restores the snapshot for that appointment and hands the caller a
 *   `retry` callback plus a human-readable explanation.
 * - `onSettled` only refetches once the last concurrent cancellation settles, so a
 *   refetch never overwrites another optimistic update that is still pending.
 */
export function useCancelAppointmentMutation({
  queryKey,
  onOptimisticCancel,
  onRollback,
  onCancelled,
}: UseCancelAppointmentOptions) {
  const queryClient = useQueryClient();

  const mutation = useMutation<Appointment, ApiError, Appointment, CancelAppointmentContext>({
    mutationKey: CANCEL_APPOINTMENT_MUTATION_KEY,
    mutationFn: (appointment) =>
      traceUserAction('appointment.cancel', () =>
        cancelAppointmentWithPenalty(appointment.id, true),
      ),
    onMutate: async (appointment) => {
      // Stop in-flight refetches so they cannot overwrite the optimistic update.
      await queryClient.cancelQueries({ queryKey });

      const previousAppointments = queryClient.getQueryData<Appointment[]>(queryKey);
      const previousStatus =
        previousAppointments?.find((item) => item.id === appointment.id)?.status ??
        appointment.status;

      queryClient.setQueryData<Appointment[]>(queryKey, (current) =>
        markAppointmentCancelled(current, appointment.id),
      );

      onOptimisticCancel?.(appointment);
      return { previousAppointments, previousStatus };
    },
    onError: (error, appointment, context) => {
      if (context) {
        queryClient.setQueryData<Appointment[]>(queryKey, (current) =>
          rollbackAppointmentCancellation(current, context, appointment.id),
        );
      } else {
        void queryClient.invalidateQueries({ queryKey });
      }

      onRollback?.(
        appointment,
        describeCancellationError(error),
        () => mutation.mutate(appointment),
        error,
      );
    },
    onSuccess: (_data, appointment) => {
      onCancelled?.(appointment);
    },
    onSettled: () => {
      // isMutating still counts the mutation that is settling right now.
      if (queryClient.isMutating({ mutationKey: CANCEL_APPOINTMENT_MUTATION_KEY }) <= 1) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  return mutation;
}
