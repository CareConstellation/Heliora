import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RecordCard from '@/components/records/RecordCard';
import { MedicalRecord } from '@/types';
import { shareRecord } from '@/services/api.service';
import {
  createSorobanMockHandlers,
  LedgerStateMachine,
  simulationSuccess,
  simulationOutOfGas,
  simulationAuthError,
} from '@/__mocks__/sorobanRpc';

jest.mock('@/services/api.service', () => ({
  shareRecord: jest.fn(),
}));

jest.mock('@/hooks/useToast', () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

const mockRecord: MedicalRecord = {
  id: 'rec1',
  date: '2026-07-28T00:00:00.000Z',
  doctorName: 'Sarah Smith',
  diagnosis: 'Hypertension',
  prescription: 'Lisinopril 10mg',
  notes: 'Check blood pressure daily',
  patientAddress: 'GPATIENT123',
};

describe('RecordCard component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders record fields correctly', () => {
    render(<RecordCard record={mockRecord} />);
    
    expect(screen.getByText('Hypertension')).toBeInTheDocument();
    expect(screen.getByText('Dr. Sarah Smith')).toBeInTheDocument();
    expect(screen.getByText(new Date(mockRecord.date).toLocaleDateString())).toBeInTheDocument();
  });

  it('opens details drawer when view button is clicked', () => {
    render(<RecordCard record={mockRecord} />);
    
    // Drawer should not be in document initially
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const viewButton = screen.getByRole('button', { name: /view/i });
    fireEvent.click(viewButton);

    // Drawer should open and display title & prescription details
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Record Details')).toBeInTheDocument();
    expect(screen.getByText('Lisinopril 10mg')).toBeInTheDocument();
  });

  it('handles sharing record flow successfully', async () => {
    const mockPrompt = jest.spyOn(window, 'prompt').mockReturnValue('GPROVIDER456');
    const mockShareResponse = {
      token: 'ST-ABC123XYZ',
      expiresAt: '2026-07-29T12:00:00.000Z',
      providerAddress: 'GPROVIDER456',
    };
    (shareRecord as jest.Mock).mockResolvedValue(mockShareResponse);

    render(<RecordCard record={mockRecord} />);

    const shareButton = screen.getByRole('button', { name: /share/i });
    fireEvent.click(shareButton);

    expect(screen.getByRole('button', { name: /sharing…/i })).toBeDisabled();

    expect(mockPrompt).toHaveBeenCalledWith('Enter provider Stellar address:');
    expect(shareRecord).toHaveBeenCalledWith('rec1', 'GPROVIDER456');

    await waitFor(() => {
      expect(screen.getByText(/Token:/)).toBeInTheDocument();
      expect(screen.getByText('ST-ABC123XYZ')).toBeInTheDocument();
      expect(screen.getByText(/Expires:/)).toBeInTheDocument();
    });

    mockPrompt.mockRestore();
  });
});

describe('Soroban mock harness integration', () => {
  const mockHandlers = createSorobanMockHandlers();
  const ledger = new LedgerStateMachine();

  beforeEach(() => {
    ledger.clear();
    Object.values(mockHandlers).forEach((fn) => fn.mockClear());
  });

  it('tracks simulation invocations on success scenario', async () => {
    mockHandlers.simulateTransaction.mockResolvedValue(simulationSuccess());
    const result = await mockHandlers.simulateTransaction({});
    expect(result).toHaveProperty('transactionData');
    expect(mockHandlers.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it('returns out-of-gas error for resource-heavy operations', async () => {
    mockHandlers.simulateTransaction.mockResolvedValue(simulationOutOfGas());
    const result = await mockHandlers.simulateTransaction({});
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('CPU budget exceeded');
  });

  it('returns auth error for unauthorized invocations', async () => {
    mockHandlers.simulateTransaction.mockResolvedValue(simulationAuthError());
    const result = await mockHandlers.simulateTransaction({});
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain(
      'missing authorized invocation',
    );
  });

  it('manages ledger state for record entries', () => {
    ledger.set('contract:record:rec1', {
      diagnosis: 'Hypertension',
      verified: true,
    });
    expect(ledger.has('contract:record:rec1')).toBe(true);
    expect(ledger.get('contract:record:rec1')).toEqual({
      diagnosis: 'Hypertension',
      verified: true,
    });
    ledger.delete('contract:record:rec1');
    expect(ledger.has('contract:record:rec1')).toBe(false);
  });

  it('resolves multiple ledger entries', () => {
    ledger.set('record:1', { diagnosis: 'Flu' });
    ledger.set('record:2', { diagnosis: 'Cold' });
    const entries = ledger.resolve(['record:1', 'record:2', 'record:missing']);
    expect(entries).toHaveLength(2);
    expect(entries[0].val).toEqual({ diagnosis: 'Flu' });
    expect(entries[1].val).toEqual({ diagnosis: 'Cold' });
  });
});
