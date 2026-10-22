import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UpcomingAppointments from '@/components/appointments/UpcomingAppointments';
import { fetchAppointments, cancelAppointmentWithPenalty } from '@/services/api.service';
import type { Appointment } from '@/types';

const mockToast = jest.fn();

jest.mock('@/services/api.service', () => ({
  fetchAppointments: jest.fn(),
  cancelAppointmentWithPenalty: jest.fn(),
  fetchCancellationEstimate: jest.fn().mockResolvedValue({
    appointmentId: 'appt1',
    fee: 10,
    hoursUntilAppointment: 48,
    tier: {
      label: '24–48 hours',
      minHoursBefore: 24,
      maxHoursBefore: 48,
      refundPercent: 75,
      forfeitPercent: 25,
    },
    refundAmount: 7.5,
    forfeitAmount: 2.5,
    doctorPayout: 2.5,
  }),
  fetchCancellationPolicy: jest.fn().mockResolvedValue({ tiers: [] }),
}));

jest.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock('@/store/useWalletStore', () => ({
  useWalletStore: () => ({ publicKey: 'GPATIENT123' }),
}));

const appointment: Appointment = {
  id: 'appt1',
  doctorId: 'doc1',
  doctorName: 'Sarah Smith',
  patientAddress: 'GPATIENT123',
  datetime: '2026-12-01T10:00:00.000Z',
  type: 'in-person',
  status: 'confirmed',
  fee: 10,
};

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

const openAndConfirmCancellation = async () => {
  await screen.findByText('Dr. Sarah Smith');
  fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
  const confirmButton = await screen.findByRole('button', {
    name: /cancel & accept penalty/i,
  });
  await act(async () => {
    fireEvent.click(confirmButton);
  });
};

describe('UpcomingAppointments optimistic cancellation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAppointments as jest.Mock).mockResolvedValue([appointment]);
  });

  it('moves the appointment to the Canceled tab before the request resolves', async () => {
    let resolveCancel: (value: Appointment) => void = () => {};
    (cancelAppointmentWithPenalty as jest.Mock).mockReturnValue(
      new Promise<Appointment>((resolve) => {
        resolveCancel = resolve;
      }),
    );
    (fetchAppointments as jest.Mock)
      .mockResolvedValueOnce([appointment])
      .mockResolvedValue([{ ...appointment, status: 'cancelled' }]);

    renderWithQueryClient(<UpcomingAppointments />);
    await openAndConfirmCancellation();

    expect(screen.getByRole('tab', { name: /canceled \(1\)/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Dr. Sarah Smith')).toBeInTheDocument();
    expect(screen.getByText('cancelled')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /upcoming \(0\)/i })).toBeInTheDocument();

    act(() => {
      resolveCancel({ ...appointment, status: 'cancelled' });
    });
  });

  it('rolls back the optimistic move and shows a retry action when cancellation fails', async () => {
    (cancelAppointmentWithPenalty as jest.Mock).mockRejectedValue({
      message: 'Network unavailable',
      status: 503,
      code: 'ERR_NETWORK',
      data: null,
    });

    renderWithQueryClient(<UpcomingAppointments />);
    await openAndConfirmCancellation();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /upcoming \(1\)/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    expect(screen.getByText('Dr. Sarah Smith')).toBeInTheDocument();
    expect(screen.getByText('confirmed')).toBeInTheDocument();
    expect(screen.queryByText('cancelled')).not.toBeInTheDocument();

    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining('Your appointment was restored'),
      'error',
      expect.objectContaining({ label: 'Retry', onClick: expect.any(Function) }),
    );

    const retryAction = mockToast.mock.calls[0][2];
    expect(cancelAppointmentWithPenalty).toHaveBeenCalledTimes(1);

    act(() => {
      retryAction.onClick();
    });

    await waitFor(() => {
      expect(cancelAppointmentWithPenalty).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps the appointment in the Canceled tab when the request succeeds', async () => {
    (cancelAppointmentWithPenalty as jest.Mock).mockResolvedValue({
      ...appointment,
      status: 'cancelled',
    });
    (fetchAppointments as jest.Mock)
      .mockResolvedValueOnce([appointment])
      .mockResolvedValue([{ ...appointment, status: 'cancelled' }]);

    renderWithQueryClient(<UpcomingAppointments />);
    await openAndConfirmCancellation();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /canceled \(1\)/i })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    expect(screen.getByText('cancelled')).toBeInTheDocument();
    expect(mockToast).toHaveBeenCalledWith('Appointment cancelled', 'success');
  });
});
