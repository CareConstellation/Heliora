import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RoleVerificationQueue from '@/components/auth/RoleVerificationQueue';
import {
  fetchCredentialDocument,
  fetchRoleVerificationQueue,
  resendRoleVerificationNotification,
  submitRoleVerificationDecision,
} from '@/services/api.service';
import { grantRoleOnChain } from '@/lib/roleVerification';
import type { RoleVerificationApplication } from '@/types';

jest.mock('@/services/api.service', () => ({
  fetchRoleVerificationQueue: jest.fn(),
  fetchCredentialDocument: jest.fn(),
  submitRoleVerificationDecision: jest.fn(),
  resendRoleVerificationNotification: jest.fn(),
}));

jest.mock('@/lib/roleVerification', () => ({
  ...jest.requireActual('@/lib/roleVerification'),
  grantRoleOnChain: jest.fn(),
}));

jest.mock('@/lib/stellar', () => ({ freighterSigner: jest.fn() }));
jest.mock('@/lib/sentry', () => ({
  traceUserAction: (_: string, fn: () => unknown) => Promise.resolve().then(fn),
}));
jest.mock('@/store/useWalletStore', () => ({ useWalletStore: () => ({ publicKey: 'GADMIN' }) }));

const doctor: RoleVerificationApplication = {
  id: 'app1',
  applicantAddress: 'GDOCTOR',
  displayName: 'Dr. Marcus Webb',
  email: 'marcus@example.org',
  requestedRole: 'DOCTOR',
  submittedAt: '2026-11-01T10:00:00.000Z',
  licenseNumber: 'MD-2024-77821',
  issuingAuthority: 'State Medical Board',
  licenseExpiresAt: '2020-01-01T00:00:00.000Z',
  documents: [
    {
      id: 'doc1',
      fileName: 'license.pdf',
      kind: 'medical_license',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      uploadedAt: '2026-11-01T10:00:00.000Z',
    },
    {
      id: 'doc2',
      fileName: 'board.pdf',
      kind: 'board_certificate',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      uploadedAt: '2026-11-01T10:00:00.000Z',
    },
  ],
};
const hospital: RoleVerificationApplication = {
  ...doctor,
  id: 'app2',
  applicantAddress: 'GHOSP',
  displayName: 'Harbor Hospital',
  email: 'admin@harbor.example',
  requestedRole: 'HOSPITAL',
  licenseExpiresAt: undefined as never,
  documents: [],
};

const decision = (d: 'approved' | 'rejected', status: 'sent' | 'failed' = 'sent') => ({
  applicationId: 'app1',
  decision: d,
  decidedAt: '2026-11-02T00:00:00.000Z',
  notification: { channel: 'email', status },
});

function renderQueue(props: Partial<React.ComponentProps<typeof RoleVerificationQueue>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RoleVerificationQueue signer={jest.fn()} {...props} />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  URL.createObjectURL = jest.fn(() => 'blob:mock');
  URL.revokeObjectURL = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  (fetchRoleVerificationQueue as jest.Mock).mockResolvedValue([doctor, hospital]);
  (fetchCredentialDocument as jest.Mock).mockResolvedValue(
    new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
  );
});

describe('RoleVerificationQueue', () => {
  it('shows the applicant profile on the left and the PDF credential on the right', async () => {
    const onCountChange = jest.fn();
    renderQueue({ onCountChange });

    const profile = await screen.findByRole('region', { name: 'Applicant profile' });
    expect(within(profile).getByText('Dr. Marcus Webb')).toBeInTheDocument();
    expect(within(profile).getByText('MD-2024-77821')).toBeInTheDocument();
    expect(within(profile).getByRole('alert')).toHaveTextContent(/license expired/i);

    const credentials = screen.getByRole('region', { name: 'Uploaded credentials' });
    const frame = await within(credentials).findByTitle('Credential document: license.pdf');
    expect(frame).toHaveAttribute('src', 'blob:mock');
    expect(fetchCredentialDocument).toHaveBeenCalledWith('app1', 'doc1');
    expect(onCountChange).toHaveBeenLastCalledWith(2);

    fireEvent.click(within(credentials).getByRole('button', { name: /board\.pdf/ }));
    await waitFor(() => expect(fetchCredentialDocument).toHaveBeenCalledWith('app1', 'doc2'));
  });

  it('refuses to render a credential that is not a real PDF', async () => {
    (fetchCredentialDocument as jest.Mock).mockResolvedValue(
      new Blob(['<script>'], { type: 'application/pdf' }),
    );
    renderQueue();
    const credentials = await screen.findByRole('region', { name: 'Uploaded credentials' });
    expect(await within(credentials).findByRole('alert')).toHaveTextContent(/not a valid PDF/i);
    expect(within(credentials).queryByTitle(/Credential document/)).not.toBeInTheDocument();
  });

  it('approves by signing the on-chain role grant, then records the decision', async () => {
    (grantRoleOnChain as jest.Mock).mockResolvedValue('granttx');
    (submitRoleVerificationDecision as jest.Mock).mockResolvedValue(decision('approved'));
    const onDecision = jest.fn();
    renderQueue({ onDecision });

    fireEvent.click(await screen.findByRole('button', { name: /approve & sign role grant/i }));

    await waitFor(() =>
      expect(submitRoleVerificationDecision).toHaveBeenCalledWith('app1', {
        decision: 'approved',
        grantTxHash: 'granttx',
        reviewerAddress: 'GADMIN',
      }),
    );
    expect(grantRoleOnChain).toHaveBeenCalledWith(
      'GADMIN',
      'GDOCTOR',
      'DOCTOR',
      expect.any(Function),
    );
    expect(
      await screen.findByText(/was approved\. Notification email sent to marcus@example\.org/),
    ).toBeInTheDocument();
    expect(onDecision).toHaveBeenCalledWith(doctor, decision('approved'));
    // The decided application leaves the queue.
    expect(screen.queryByRole('tab', { name: /Dr\. Marcus Webb/ })).not.toBeInTheDocument();
  });

  it('retries recording an approval without re-signing the on-chain grant', async () => {
    (grantRoleOnChain as jest.Mock).mockResolvedValue('granttx');
    (submitRoleVerificationDecision as jest.Mock)
      .mockRejectedValueOnce(new Error('Gateway timeout'))
      .mockResolvedValueOnce(decision('approved'));
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /approve & sign role grant/i }));
    expect(await screen.findByText(/role was granted on-chain; retry/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry recording approval/i }));
    await waitFor(() => expect(submitRoleVerificationDecision).toHaveBeenCalledTimes(2));
    expect(grantRoleOnChain).toHaveBeenCalledTimes(1);
  });

  it('does not record an approval when the wallet declines to sign', async () => {
    (grantRoleOnChain as jest.Mock).mockRejectedValue(new Error('User declined'));
    renderQueue();
    fireEvent.click(await screen.findByRole('button', { name: /approve & sign role grant/i }));
    expect(await screen.findByText('User declined')).toBeInTheDocument();
    expect(submitRoleVerificationDecision).not.toHaveBeenCalled();
  });

  it('requires a standardized reason to reject, and a note for "Other"', async () => {
    (submitRoleVerificationDecision as jest.Mock).mockResolvedValue(decision('rejected', 'failed'));
    (resendRoleVerificationNotification as jest.Mock).mockResolvedValue({
      channel: 'email',
      status: 'sent',
    });
    renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: /^reject$/i }));
    const confirm = screen.getByRole('button', { name: /confirm rejection/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'OTHER' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/note to applicant/i), {
      target: { value: 'Certificate issued by an unaccredited body' },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(submitRoleVerificationDecision).toHaveBeenCalledWith('app1', {
        decision: 'rejected',
        reasonCode: 'OTHER',
        note: 'Certificate issued by an unaccredited body',
        reviewerAddress: 'GADMIN',
      }),
    );
    expect(grantRoleOnChain).not.toHaveBeenCalled();

    // Email dispatch failed: the admin can resend it.
    expect(
      await screen.findByText(/Notification email to marcus@example\.org failed/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /resend email/i }));
    expect(
      await screen.findByText(/Notification email sent to marcus@example\.org/),
    ).toBeInTheDocument();
    expect(resendRoleVerificationNotification).toHaveBeenCalledWith('app1');
  });

  it('shows an empty state and a retryable error state', async () => {
    (fetchRoleVerificationQueue as jest.Mock)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce([]);
    renderQueue();
    fireEvent.click(await screen.findByRole('button', { name: /retry/i }));
    expect(await screen.findByText('All caught up')).toBeInTheDocument();
  });
});
