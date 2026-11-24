import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import NewRecordForm from '@/components/doctor/NewRecordForm';
import { useWalletStore } from '@/store/useWalletStore';

jest.mock('@/services/api.service', () => ({
  createRecord: jest.fn(),
  fetchRecords: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/lib/clinicalOutbox', () => ({
  enqueueClinicalRecord: jest.fn(),
  listClinicalOutbox: jest.fn().mockResolvedValue([]),
  removeClinicalOutboxItem: jest.fn(),
  setClinicalOutboxStatus: jest.fn(),
}));

describe('Doctor Prescription Form ZK Dosage Boundary Integration (#214)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    useWalletStore.setState({ publicKey: 'GDOCTOR', role: 'DOCTOR' });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('displays ZK dosage boundary check when prescription contains dosage in mg', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <NewRecordForm patientAddress="GPATIENT" onSuccess={jest.fn()} />
      </QueryClientProvider>,
    );

    const prescriptionInput = screen.getByPlaceholderText(
      /e\.g\. Amoxicillin 500mg TID/i,
    );

    // Enter a safe dosage: 500mg (with default threshold 20mg/kg -> 70kg * 20 = 1400mg)
    fireEvent.change(prescriptionInput, {
      target: { value: 'Amoxicillin 500mg PO TID' },
    });

    expect(
      await screen.findByText(/ZK Dosage Boundary Check \(Undisclosed Weight\)/i),
    ).toBeInTheDocument();

    expect(
      screen.getByText(/ZK Verified: 500mg is within safe boundary/i),
    ).toBeInTheDocument();
  });

  it('displays dosage exceeded warning when threshold is lower than prescribed dosage', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <NewRecordForm patientAddress="GPATIENT" onSuccess={jest.fn()} />
      </QueryClientProvider>,
    );

    const prescriptionInput = screen.getByPlaceholderText(
      /e\.g\. Amoxicillin 500mg TID/i,
    );

    fireEvent.change(prescriptionInput, {
      target: { value: 'Amoxicillin 500mg PO TID' },
    });

    const thresholdInput = await screen.findByLabelText(/Safe dosage threshold in mg per kg/i);

    // Lower threshold to 5 mg/kg -> max allowed 70kg * 5 = 350mg (< 500mg)
    fireEvent.change(thresholdInput, { target: { value: '5' } });

    expect(
      await screen.findByText(/Dosage Boundary Exceeded: 500mg exceeds safe threshold/i),
    ).toBeInTheDocument();
  });
});
