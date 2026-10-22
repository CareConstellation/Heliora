import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppointmentCard from '@/components/doctor/AppointmentCard';
import { type Appointment, type MedicalRecord } from '@/types';
import { updateAppointmentStatus, fetchRecords } from '@/services/api.service';
import {
  createSorobanMockHandlers,
  LedgerStateMachine,
  pollTransactionFailed,
  mockAccount,
} from '@/__mocks__/sorobanRpc';

jest.mock('@/services/api.service', () => ({
  updateAppointmentStatus: jest.fn(),
  fetchRecords: jest.fn(),
}));

jest.mock('@/components/doctor/NewRecordForm', () => {
  return function MockNewRecordForm({ patientAddress, onSuccess }: any) {
    return (
      <div data-testid="mock-new-record-form">
        Mock New Record Form for {patientAddress}
        <button onClick={onSuccess}>Success</button>
      </div>
    );
  };
});

jest.mock('@/components/records/RecordDetailDrawer', () => {
  return function MockRecordDetailDrawer({ record, onClose }: any) {
    return (
      <div data-testid="mock-record-detail-drawer" role="dialog">
        Drawer for {record.diagnosis}
        <button onClick={onClose}>Close</button>
      </div>
    );
  };
});

const mockAppointment: Appointment = {
  id: 'appt1',
  doctorId: 'doc1',
  doctorName: 'Sarah Smith',
  patientAddress: 'GPATIENT123',
  patientName: 'John Doe',
  datetime: '2026-07-28T10:00:00.000Z',
  type: 'telemedicine',
  notes: 'First visit',
  status: 'pending',
  fee: 10,
};

const mockRecords: MedicalRecord[] = [
  {
    id: 'rec1',
    date: '2026-07-20T00:00:00.000Z',
    doctorName: 'Sarah Smith',
    diagnosis: 'Asthma',
    patientAddress: 'GPATIENT123',
  },
];

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
};

describe('AppointmentCard component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders summary fields correctly', () => {
    renderWithQueryClient(<AppointmentCard appointment={mockAppointment} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText(/telemedicine/i)).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('toggles expansion state and loads patient history', async () => {
    (fetchRecords as jest.Mock).mockResolvedValue(mockRecords);
    renderWithQueryClient(<AppointmentCard appointment={mockAppointment} />);

    // Initially collapsed, "Confirm" action should not be visible
    expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument();

    const summaryRow = screen.getByText('John Doe');
    fireEvent.click(summaryRow);

    // Now expanded, shows loading/history and buttons
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Asthma/)).toBeInTheDocument();
    });
  });

  it('displays empty state when patient history is empty', async () => {
    (fetchRecords as jest.Mock).mockResolvedValue([]);
    renderWithQueryClient(<AppointmentCard appointment={mockAppointment} />);

    fireEvent.click(screen.getByText('John Doe'));

    await waitFor(() => {
      expect(screen.getByText('No records found.')).toBeInTheDocument();
    });
  });

  it('triggers update status mutation on actions', async () => {
    (fetchRecords as jest.Mock).mockResolvedValue([]);
    (updateAppointmentStatus as jest.Mock).mockResolvedValue({
      ...mockAppointment,
      status: 'confirmed',
    });

    renderWithQueryClient(<AppointmentCard appointment={mockAppointment} />);

    fireEvent.click(screen.getByText('John Doe'));

    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmButton);
    await waitFor(() => {
      expect(updateAppointmentStatus).toHaveBeenCalledWith('appt1', 'confirmed');
    });
  });

  it('allows adding a new medical record', async () => {
    (fetchRecords as jest.Mock).mockResolvedValue([]);
    renderWithQueryClient(<AppointmentCard appointment={mockAppointment} />);

    fireEvent.click(screen.getByText('John Doe'));

    const addRecordButton = screen.getByRole('button', { name: /\+ Add Medical Record/i });
    fireEvent.click(addRecordButton);

    expect(screen.getByTestId('mock-new-record-form')).toBeInTheDocument();

    // Clicking success in the mocked form closes it
    const successBtn = screen.getByRole('button', { name: /success/i });
    fireEvent.click(successBtn);

    expect(screen.queryByTestId('mock-new-record-form')).not.toBeInTheDocument();
  });
});

describe('Soroban mock harness integration', () => {
  const mockHandlers = createSorobanMockHandlers();
  const ledger = new LedgerStateMachine();

  beforeEach(() => {
    ledger.clear();
    Object.values(mockHandlers).forEach((fn) => fn.mockClear());
  });

  it('simulates full transaction lifecycle', async () => {
    const account = await mockHandlers.getAccount('GTEST123');
    expect(account.accountId()).toBe('GTEST123');

    const sendResult = await mockHandlers.sendTransaction({});
    expect(sendResult.status).toBe('PENDING');

    const pollResult = await mockHandlers.pollTransaction(sendResult.hash);
    expect(pollResult.status).toBe('SUCCESS');
  });

  it('handles transaction failure in poll', async () => {
    mockHandlers.pollTransaction.mockResolvedValue(pollTransactionFailed());
    const result = await mockHandlers.pollTransaction('mock_hash');
    expect(result.status).toBe('FAILED');
  });

  it('resolves ledger entries for appointment state', () => {
    ledger.set('contract:appt:appt1', {
      status: 'confirmed',
      doctorId: 'doc1',
    });
    ledger.set('contract:appt:appt2', {
      status: 'pending',
      doctorId: 'doc1',
    });

    const entries = ledger.resolve([
      'contract:appt:appt1',
      'contract:appt:appt2',
      'contract:appt:missing',
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.val).toEqual({
      status: 'confirmed',
      doctorId: 'doc1',
    });
  });

  it('advances ledger sequence correctly', () => {
    const seq1 = ledger.nextSequence();
    const seq2 = ledger.nextSequence();
    expect(Number(seq2)).toBe(Number(seq1) + 1);
  });

  it('creates mock account with correct address', async () => {
    const account = mockAccount('GPATIENT123', '200');
    expect(account.accountId()).toBe('GPATIENT123');
    expect(account.sequenceNumber()).toBe('200');
  });
});
