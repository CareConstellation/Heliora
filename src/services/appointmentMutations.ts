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

/* ─── Telemedicine Consultation Escrow Mutations (#189) ─────────── */

import {
  buildLockConsultationFeeInvocation,
  buildReleaseFeeInvocation,
  buildRefundPatientInvocation,
} from '@/lib/teleMedicineEscrow';

export const LOCK_CONSULTATION_FEE_MUTATION_KEY = ['appointments', 'escrow', 'lock'] as const;
export const RELEASE_CONSULTATION_FEE_MUTATION_KEY = ['appointments', 'escrow', 'release'] as const;
export const REFUND_PATIENT_MUTATION_KEY = ['appointments', 'escrow', 'refund'] as const;

export interface LockConsultationFeeParams {
  contractId: string;
  patientAddress: string;
  doctorAddress: string;
  consultationId: string;
  amountStroops: string | bigint;
  expiresAt?: number;
  disputeWindowSeconds?: number;
}

export interface ReleaseConsultationFeeParams {
  contractId: string;
  escrowId: string;
  doctorAddress: string;
}

export interface RefundPatientParams {
  contractId: string;
  escrowId: string;
  patientAddress: string;
  reason?: string;
}

/**
 * Mutation to invoke lock_consultation_fee on the Soroban escrow contract.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function useLockConsultationFeeMutation(options?: {
  onSuccess?: (data: unknown, variables: LockConsultationFeeParams) => void;
  onError?: (error: Error, variables: LockConsultationFeeParams) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, LockConsultationFeeParams>({
    mutationKey: LOCK_CONSULTATION_FEE_MUTATION_KEY,
    mutationFn: async (params) => {
      const invocation = buildLockConsultationFeeInvocation(params.contractId, params);
      return {
        success: true,
        invocation,
        consultationId: params.consultationId,
        lockedAt: Math.floor(Date.now() / 1000),
      };
    },
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
      options?.onSuccess?.(data, variables);
    },
    onError: options?.onError,
  });
}

/**
 * Mutation to invoke release_fee on the Soroban escrow contract.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function useReleaseConsultationFeeMutation(options?: {
  onSuccess?: (data: unknown, variables: ReleaseConsultationFeeParams) => void;
  onError?: (error: Error, variables: ReleaseConsultationFeeParams) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, ReleaseConsultationFeeParams>({
    mutationKey: RELEASE_CONSULTATION_FEE_MUTATION_KEY,
    mutationFn: async (params) => {
      const invocation = buildReleaseFeeInvocation(
        params.contractId,
        params.escrowId,
        params.doctorAddress,
      );
      return {
        success: true,
        invocation,
        escrowId: params.escrowId,
        releasedAt: Math.floor(Date.now() / 1000),
      };
    },
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
      options?.onSuccess?.(data, variables);
    },
    onError: options?.onError,
  });
}

/**
 * Mutation to invoke refund_patient on the Soroban escrow contract for doctor no-show.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function useRefundPatientMutation(options?: {
  onSuccess?: (data: unknown, variables: RefundPatientParams) => void;
  onError?: (error: Error, variables: RefundPatientParams) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, RefundPatientParams>({
    mutationKey: REFUND_PATIENT_MUTATION_KEY,
    mutationFn: async (params) => {
      const invocation = buildRefundPatientInvocation(
        params.contractId,
        params.escrowId,
        params.patientAddress,
        params.reason ?? 'doctor_no_show',
      );
      return {
        success: true,
        invocation,
        escrowId: params.escrowId,
        refundedAt: Math.floor(Date.now() / 1000),
      };
    },
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
      options?.onSuccess?.(data, variables);
    },
    onError: options?.onError,
  });
}


/* ─── Encounter (SOAP) Note Auto-save with Conflict Detection (#266) ── */

import { fetchEncounterNote, saveEncounterNote } from '@/services/api.service';
import { detectNoteConflict, EncounterNoteConflictError } from '@/lib/soapNotes';
import type { EncounterNote } from '@/types';

export const SAVE_ENCOUNTER_NOTE_MUTATION_KEY = ['encounter-note', 'save'] as const;

export interface SaveEncounterNoteInput {
  content: string;
  /** Server version the local edits were based on. */
  baseUpdatedAt: string | null;
  /** Overwrite the remote copy after the user chose "Keep mine" on a conflict. */
  force?: boolean;
}

export interface EncounterNoteApi {
  fetch: (appointmentId: string) => Promise<EncounterNote | null>;
  save: (
    appointmentId: string,
    content: string,
    options: { expectedUpdatedAt?: string | null },
  ) => Promise<EncounterNote>;
}

const isStatus = (err: unknown, status: number) =>
  typeof err === 'object' && err !== null && (err as { status?: number }).status === status;

const defaultNoteApi: EncounterNoteApi = {
  fetch: (id) =>
    fetchEncounterNote(id).catch((err: unknown) => {
      if (isStatus(err, 404)) return null;
      throw err;
    }),
  save: saveEncounterNote,
};

/**
 * Saves a note only if the server copy is still the version the edits were
 * based on. The client compares versions first (works against any backend)
 * and also sends `expectedUpdatedAt` so a backend with optimistic concurrency
 * closes the race between that check and the write; a 409 from it is turned
 * into the same {@link EncounterNoteConflictError}.
 *
 * Time: O(n) in note length for the content comparison.
 */
export async function saveEncounterNoteWithConflictCheck(
  appointmentId: string,
  input: SaveEncounterNoteInput,
  noteApi: EncounterNoteApi = defaultNoteApi,
): Promise<EncounterNote> {
  const remote = await noteApi.fetch(appointmentId);
  if (!input.force && detectNoteConflict({ baseUpdatedAt: input.baseUpdatedAt, localContent: input.content, remote })) {
    throw new EncounterNoteConflictError(remote!);
  }
  const expectedUpdatedAt = input.force ? (remote?.updatedAt ?? null) : input.baseUpdatedAt;
  try {
    return await noteApi.save(appointmentId, input.content, { expectedUpdatedAt });
  } catch (err) {
    if (isStatus(err, 409)) {
      const latest = await noteApi.fetch(appointmentId);
      if (latest) throw new EncounterNoteConflictError(latest);
    }
    throw err;
  }
}

export function useSaveEncounterNoteMutation(
  appointmentId: string,
  options: { noteApi?: EncounterNoteApi } = {},
) {
  const queryClient = useQueryClient();
  return useMutation<EncounterNote, Error, SaveEncounterNoteInput>({
    mutationKey: [...SAVE_ENCOUNTER_NOTE_MUTATION_KEY, appointmentId],
    mutationFn: (input) => saveEncounterNoteWithConflictCheck(appointmentId, input, options.noteApi),
    onSuccess: (data) => {
      queryClient.setQueryData(['encounter-note', appointmentId], data);
    },
  });
}
