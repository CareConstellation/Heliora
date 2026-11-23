'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  fetchCredentialDocument,
  fetchRoleVerificationQueue,
  resendRoleVerificationNotification,
  submitRoleVerificationDecision,
  type ApiError,
} from '@/services/api.service';
import {
  REJECTION_REASONS,
  MAX_NOTE_LENGTH,
  buildRejectionPayload,
  daysUntilLicenseExpiry,
  grantRoleOnChain,
  isPdfBlob,
  validateRejection,
} from '@/lib/roleVerification';
import { freighterSigner, type TransactionSigner } from '@/lib/stellar';
import { traceUserAction } from '@/lib/sentry';
import { useWalletStore } from '@/store/useWalletStore';
import type {
  NotificationDispatch,
  RejectionReasonCode,
  RoleVerificationApplication,
  RoleVerificationDecisionResult,
} from '@/types';

export const ROLE_VERIFICATION_QUEUE_KEY = ['admin', 'role-verifications'] as const;

export interface RoleVerificationQueueProps {
  /** Called after a decision has been recorded (e.g. to append to the audit log). */
  onDecision?: (
    application: RoleVerificationApplication,
    result: RoleVerificationDecisionResult,
  ) => void;
  /** Reports the number of pending applications (e.g. for a tab badge). */
  onCountChange?: (count: number) => void;
  /** Injectable for tests; defaults to Freighter. */
  signer?: TransactionSigner;
}

type ApproveStage = 'idle' | 'signing' | 'recording';

export default function RoleVerificationQueue({
  onDecision,
  onCountChange,
  signer = freighterSigner,
}: RoleVerificationQueueProps) {
  const { publicKey: adminAddress } = useWalletStore();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    application: RoleVerificationApplication;
    result: RoleVerificationDecisionResult;
  } | null>(null);

  const {
    data: queue = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ROLE_VERIFICATION_QUEUE_KEY,
    queryFn: fetchRoleVerificationQueue,
  });

  useEffect(() => {
    onCountChange?.(queue.length);
  }, [queue.length, onCountChange]);

  const selected = queue.find((a) => a.id === selectedId) ?? queue[0] ?? null;

  function handleDecided(
    application: RoleVerificationApplication,
    result: RoleVerificationDecisionResult,
  ) {
    queryClient.setQueryData<RoleVerificationApplication[]>(ROLE_VERIFICATION_QUEUE_KEY, (prev) =>
      prev?.filter((a) => a.id !== application.id),
    );
    setSelectedId(null);
    setLastResult({ application, result });
    onDecision?.(application, result);
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-5 py-10 text-xs text-text-3" role="status">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading verification queue…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="px-5 py-10 text-center" role="alert">
        <AlertTriangle className="w-6 h-6 mx-auto mb-2" style={{ color: '#F87171' }} />
        <p className="text-sm text-text-1">Could not load the verification queue.</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-text-2 hover:text-text-1"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {lastResult && (
        <DecisionBanner
          key={lastResult.application.id}
          application={lastResult.application}
          result={lastResult.result}
          onDismiss={() => setLastResult(null)}
        />
      )}

      {queue.length === 0 || !selected ? (
        <div className="px-5 py-10 text-center">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-2" style={{ color: '#00C896' }} />
          <p className="text-sm font-medium text-text-1">All caught up</p>
          <p className="text-xs text-text-3 mt-1">No pending role registrations.</p>
        </div>
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Pending applications"
            className="flex gap-2 overflow-x-auto px-5 py-3 border-b"
            style={{ borderColor: 'rgba(255,255,255,0.05)' }}
          >
            {queue.map((app) => (
              <button
                key={app.id}
                type="button"
                role="tab"
                aria-selected={app.id === selected.id}
                onClick={() => setSelectedId(app.id)}
                className={`shrink-0 rounded-[8px] px-3 py-1.5 text-xs transition-colors ${
                  app.id === selected.id
                    ? 'bg-surface-hover text-text-1'
                    : 'text-text-2 hover:text-text-1'
                }`}
              >
                {app.displayName} · {app.requestedRole}
              </button>
            ))}
          </div>

          <ReviewPanel
            key={selected.id}
            application={selected}
            adminAddress={adminAddress}
            signer={signer}
            onDecided={handleDecided}
          />
        </>
      )}
    </div>
  );
}

/* ─── Split-screen review ─────────────────────────────────────────── */

function ReviewPanel({
  application,
  adminAddress,
  signer,
  onDecided,
}: {
  application: RoleVerificationApplication;
  adminAddress: string | null;
  signer: TransactionSigner;
  onDecided: (app: RoleVerificationApplication, result: RoleVerificationDecisionResult) => void;
}) {
  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x"
      style={{ borderColor: 'rgba(255,255,255,0.05)' }}
    >
      <section aria-label="Applicant profile" className="p-5 space-y-5">
        <ApplicantProfile application={application} />
        <DecisionControls
          application={application}
          adminAddress={adminAddress}
          signer={signer}
          onDecided={onDecided}
        />
      </section>
      <section aria-label="Uploaded credentials" className="p-5">
        <CredentialViewer application={application} />
      </section>
    </div>
  );
}

function ApplicantProfile({ application }: { application: RoleVerificationApplication }) {
  const expiryDays = daysUntilLicenseExpiry(application);
  const rows: Array<[string, string | undefined]> = [
    ['Requested role', application.requestedRole],
    ['Wallet', application.applicantAddress],
    ['Email', application.email],
    ['Submitted', new Date(application.submittedAt).toLocaleString()],
    [
      application.requestedRole === 'HOSPITAL' ? 'Registration #' : 'License #',
      application.licenseNumber,
    ],
    ['Issuing authority', application.issuingAuthority],
    ['Jurisdiction', application.jurisdiction],
    ['Specialty', application.specialty],
    ['Organization', application.organization],
    [
      'Expires',
      application.licenseExpiresAt
        ? new Date(application.licenseExpiresAt).toLocaleDateString()
        : undefined,
    ],
  ];

  return (
    <div>
      <h3 className="text-base font-semibold text-text-1">{application.displayName}</h3>
      {expiryDays !== null && expiryDays < 0 && (
        <p role="alert" className="mt-2 text-xs" style={{ color: '#F87171' }}>
          License expired {Math.abs(expiryDays)} day{Math.abs(expiryDays) === 1 ? '' : 's'} ago.
        </p>
      )}
      {expiryDays !== null && expiryDays >= 0 && expiryDays <= 30 && (
        <p className="mt-2 text-xs" style={{ color: '#FCD34D' }}>
          License expires in {expiryDays} day{expiryDays === 1 ? '' : 's'}.
        </p>
      )}
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-text-3">{label}</dt>
              <dd className="text-text-1 break-all">{value}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

function CredentialViewer({ application }: { application: RoleVerificationApplication }) {
  const documents = application.documents;
  const [documentId, setDocumentId] = useState(documents[0]?.id ?? null);
  const doc = documents.find((d) => d.id === documentId) ?? null;
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  const {
    data: blob,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['admin', 'credential-document', application.id, documentId],
    queryFn: async () => {
      const file = await fetchCredentialDocument(application.id, documentId!);
      if (!(await isPdfBlob(file))) throw new Error('The uploaded file is not a valid PDF.');
      return file;
    },
    enabled: !!documentId,
    // Credential files are sensitive: never keep them around once the reviewer moves on.
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (!blob) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  if (documents.length === 0) {
    return (
      <p className="text-xs" style={{ color: '#F87171' }}>
        No credential documents were uploaded with this application.
      </p>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-[480px]">
      <div className="flex flex-wrap gap-2 mb-3" aria-label="Credential documents">
        {documents.map((d) => (
          <button
            key={d.id}
            type="button"
            aria-pressed={d.id === documentId}
            onClick={() => setDocumentId(d.id)}
            className={`inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-xs ${
              d.id === documentId ? 'bg-surface-hover text-text-1' : 'text-text-2 hover:text-text-1'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            {d.fileName}
          </button>
        ))}
      </div>

      <div
        className="flex-1 rounded-[10px] overflow-hidden"
        style={{ background: 'var(--bg-inset)' }}
      >
        {isLoading && (
          <div
            className="flex h-full items-center justify-center gap-2 text-xs text-text-3"
            role="status"
          >
            <Loader2 className="w-4 h-4 animate-spin" /> Loading {doc?.fileName}…
          </div>
        )}
        {isError && (
          <div
            className="flex h-full items-center justify-center p-6 text-center text-xs"
            role="alert"
            style={{ color: '#F87171' }}
          >
            {(error as Partial<ApiError> | null)?.message ?? 'Could not load this document.'}
          </div>
        )}
        {objectUrl && (
          <iframe
            title={`Credential document: ${doc?.fileName ?? ''}`}
            src={objectUrl}
            className="w-full h-full min-h-[480px] border-0"
          />
        )}
      </div>
    </div>
  );
}

/* ─── Approve / reject ────────────────────────────────────────────── */

function DecisionControls({
  application,
  adminAddress,
  signer,
  onDecided,
}: {
  application: RoleVerificationApplication;
  adminAddress: string | null;
  signer: TransactionSigner;
  onDecided: (app: RoleVerificationApplication, result: RoleVerificationDecisionResult) => void;
}) {
  const [mode, setMode] = useState<'none' | 'reject'>('none');
  const [reasonCode, setReasonCode] = useState<RejectionReasonCode | ''>('');
  const [note, setNote] = useState('');
  const [stage, setStage] = useState<ApproveStage>('idle');
  // Keeps the grant hash if recording the decision fails, so a retry does not re-sign.
  const [grantTxHash, setGrantTxHash] = useState<string | null>(null);

  const rejectionError = useMemo(() => validateRejection(reasonCode, note), [reasonCode, note]);

  const approve = useMutation<RoleVerificationDecisionResult, Error>({
    mutationFn: () =>
      traceUserAction('admin.role_verification.approve', async () => {
        if (!adminAddress) throw new Error('Connect the admin wallet to sign the role grant.');
        let txHash = grantTxHash;
        if (!txHash) {
          setStage('signing');
          txHash = await grantRoleOnChain(
            adminAddress,
            application.applicantAddress,
            application.requestedRole,
            signer,
          );
          setGrantTxHash(txHash);
        }
        setStage('recording');
        return submitRoleVerificationDecision(application.id, {
          decision: 'approved',
          grantTxHash: txHash,
          reviewerAddress: adminAddress,
        });
      }),
    onSuccess: (result) => onDecided(application, result),
    onSettled: () => setStage('idle'),
  });

  const reject = useMutation<RoleVerificationDecisionResult, Error>({
    mutationFn: () =>
      traceUserAction('admin.role_verification.reject', () => {
        if (!adminAddress) throw new Error('Connect the admin wallet to record decisions.');
        if (rejectionError || !reasonCode) throw new Error(rejectionError ?? 'Choose a reason.');
        return submitRoleVerificationDecision(
          application.id,
          buildRejectionPayload(adminAddress, reasonCode, note),
        );
      }),
    onSuccess: (result) => onDecided(application, result),
  });

  const busy = approve.isPending || reject.isPending;
  const failure = approve.error ?? reject.error;

  return (
    <div className="space-y-3">
      {failure && (
        <p role="alert" className="text-xs" style={{ color: '#F87171' }}>
          {failure.message}
          {grantTxHash && ' The role was granted on-chain; retry to record the decision.'}
        </p>
      )}

      {mode === 'none' ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode('reject')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium disabled:opacity-50"
            style={{
              background: 'rgba(248,113,113,0.1)',
              color: '#F87171',
              border: '1px solid rgba(248,113,113,0.2)',
            }}
          >
            <XCircle className="w-3.5 h-3.5" /> Reject
          </button>
          <button
            type="button"
            disabled={busy || !adminAddress}
            onClick={() => approve.mutate()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium disabled:opacity-50"
            style={{
              background: 'rgba(0,200,150,0.1)',
              color: '#00C896',
              border: '1px solid rgba(0,200,150,0.2)',
            }}
          >
            {approve.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5" />
            )}
            {stage === 'signing'
              ? 'Sign role grant in wallet…'
              : stage === 'recording'
                ? 'Recording decision…'
                : grantTxHash
                  ? 'Retry recording approval'
                  : 'Approve & sign role grant'}
          </button>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!rejectionError) reject.mutate();
          }}
        >
          <label className="block text-xs text-text-2" htmlFor={`reason-${application.id}`}>
            Rejection reason
          </label>
          <select
            id={`reason-${application.id}`}
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value as RejectionReasonCode | '')}
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-xs text-text-1"
          >
            <option value="">Select a standardized reason…</option>
            {REJECTION_REASONS.map((reason) => (
              <option key={reason.code} value={reason.code}>
                {reason.label}
              </option>
            ))}
          </select>
          <label className="block text-xs text-text-2" htmlFor={`note-${application.id}`}>
            Note to applicant {reasonCode === 'OTHER' ? '(required)' : '(optional)'}
          </label>
          <textarea
            id={`note-${application.id}`}
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-xs text-text-1"
          />
          {reasonCode && rejectionError && <p className="text-2xs text-text-3">{rejectionError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('none')}
              className="px-3 py-1.5 rounded-[8px] text-xs text-text-2 hover:text-text-1"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={busy || !!rejectionError}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium disabled:opacity-50"
              style={{
                background: 'rgba(248,113,113,0.1)',
                color: '#F87171',
                border: '1px solid rgba(248,113,113,0.2)',
              }}
            >
              {reject.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Confirm rejection
            </button>
          </div>
        </form>
      )}

      <p className="text-2xs text-text-3 flex items-center gap-1">
        <Mail className="w-3 h-3" /> The applicant is emailed automatically when you decide.
      </p>
    </div>
  );
}

function DecisionBanner({
  application,
  result,
  onDismiss,
}: {
  application: RoleVerificationApplication;
  result: RoleVerificationDecisionResult;
  onDismiss: () => void;
}) {
  const [notification, setNotification] = useState<NotificationDispatch>(result.notification);
  const resend = useMutation({
    mutationFn: () => resendRoleVerificationNotification(application.id),
    onSuccess: setNotification,
  });

  const verb = result.decision === 'approved' ? 'approved' : 'rejected';
  const emailText =
    notification.status === 'failed'
      ? `Notification email to ${application.email} failed${notification.error ? `: ${notification.error}` : '.'}`
      : notification.status === 'sent'
        ? `Notification email sent to ${application.email}.`
        : `Notification email to ${application.email} is queued.`;

  return (
    <div
      role="status"
      className="mx-5 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-xs"
      style={{ background: 'var(--bg-inset)' }}
    >
      <span className="text-text-1">
        {application.displayName} was {verb}. {emailText}
      </span>
      <span className="flex gap-2">
        {notification.status === 'failed' && (
          <button
            type="button"
            disabled={resend.isPending}
            onClick={() => resend.mutate()}
            className="text-text-2 hover:text-text-1 disabled:opacity-50"
          >
            Resend email
          </button>
        )}
        <button type="button" onClick={onDismiss} className="text-text-3 hover:text-text-1">
          Dismiss
        </button>
      </span>
    </div>
  );
}
