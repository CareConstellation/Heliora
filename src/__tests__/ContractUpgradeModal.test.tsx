import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ContractUpgradeModal from '@/components/admin/ContractUpgradeModal';
import * as versioning from '@/lib/sorobanContractVersioning';

jest.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('@/store/useWalletStore', () => ({
  useWalletStore: () => ({
    publicKey: 'GADMINPUBLICKEY1234567890123456789012345678901234567890123456',
  }),
}));

describe('ContractUpgradeModal Component (#195)', () => {
  const dummyContractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const dummyTargetHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    render(<ContractUpgradeModal isOpen={false} onClose={jest.fn()} />);
    expect(screen.queryByTestId('contract-upgrade-modal')).not.toBeInTheDocument();
  });

  it('renders modal dialog and controls when isOpen is true', () => {
    render(
      <ContractUpgradeModal
        isOpen={true}
        onClose={jest.fn()}
        defaultContractId={dummyContractId}
      />,
    );

    expect(screen.getByTestId('contract-upgrade-modal')).toBeInTheDocument();
    expect(screen.getByTestId('contract-id-input')).toHaveValue(dummyContractId);
    expect(screen.getByTestId('fetch-compare-btn')).toBeInTheDocument();
    expect(screen.getByTestId('simulate-upgrade-btn')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-execute-btn')).toBeInTheDocument();
  });

  it('fetches active wasm hash and displays bytecode diff summary', async () => {
    jest.spyOn(versioning, 'fetchActiveContractWasmHash').mockResolvedValueOnce(
      '0000000000000000000000000000000000000000000000000000000000000000',
    );

    render(
      <ContractUpgradeModal
        isOpen={true}
        onClose={jest.fn()}
        defaultContractId={dummyContractId}
      />,
    );

    const targetInput = screen.getByTestId('target-wasm-input');
    fireEvent.change(targetInput, { target: { value: dummyTargetHash } });

    const fetchBtn = screen.getByTestId('fetch-compare-btn');
    fireEvent.click(fetchBtn);

    await waitFor(() => {
      expect(versioning.fetchActiveContractWasmHash).toHaveBeenCalledWith(dummyContractId);
      expect(screen.getByTestId('bytecode-diff-summary')).toBeInTheDocument();
      expect(screen.getByText(/Bytecode divergence detected/i)).toBeInTheDocument();
    });
  });

  it('triggers upgrade simulation and displays simulation results', async () => {
    jest.spyOn(versioning, 'simulateContractUpgrade').mockResolvedValueOnce({
      success: true,
      minResourceFee: '25000',
      footprint: { readOnlyCount: 2, readWriteCount: 1 },
      simulatedLedger: 9999,
    });

    render(
      <ContractUpgradeModal
        isOpen={true}
        onClose={jest.fn()}
        defaultContractId={dummyContractId}
      />,
    );

    const targetInput = screen.getByTestId('target-wasm-input');
    fireEvent.change(targetInput, { target: { value: dummyTargetHash } });

    const simulateBtn = screen.getByTestId('simulate-upgrade-btn');
    fireEvent.click(simulateBtn);

    await waitFor(() => {
      expect(versioning.simulateContractUpgrade).toHaveBeenCalled();
      expect(screen.getByTestId('simulation-result')).toBeInTheDocument();
      expect(screen.getByText(/Simulation Succeeded/i)).toBeInTheDocument();
      expect(screen.getByText(/25000 stroops/i)).toBeInTheDocument();
    });
  });

  it('executes contract upgrade upon confirmation and invokes onSuccess', async () => {
    jest.spyOn(versioning, 'simulateContractUpgrade').mockResolvedValueOnce({
      success: true,
      minResourceFee: '25000',
      footprint: { readOnlyCount: 2, readWriteCount: 1 },
      simulatedLedger: 9999,
    });
    jest.spyOn(versioning, 'executeContractUpgrade').mockResolvedValueOnce({
      txHash: '0xmockedtxhash123',
    });

    const handleSuccess = jest.fn();

    render(
      <ContractUpgradeModal
        isOpen={true}
        onClose={jest.fn()}
        defaultContractId={dummyContractId}
        onSuccess={handleSuccess}
      />,
    );

    const targetInput = screen.getByTestId('target-wasm-input');
    fireEvent.change(targetInput, { target: { value: dummyTargetHash } });

    // Run simulation first
    const simulateBtn = screen.getByTestId('simulate-upgrade-btn');
    fireEvent.click(simulateBtn);

    await waitFor(() => {
      expect(screen.getByText(/Simulation Succeeded/i)).toBeInTheDocument();
    });

    // Check acknowledgment checkbox
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    // Confirm & Execute
    const confirmBtn = screen.getByTestId('confirm-execute-btn');
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(versioning.executeContractUpgrade).toHaveBeenCalled();
      expect(handleSuccess).toHaveBeenCalledWith('0xmockedtxhash123');
      expect(screen.getByText(/Upgrade Transaction Executed!/i)).toBeInTheDocument();
    });
  });

  it('calls onClose when close button is clicked', () => {
    const handleClose = jest.fn();
    render(<ContractUpgradeModal isOpen={true} onClose={handleClose} />);

    const closeBtn = screen.getByTestId('close-modal-btn');
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
