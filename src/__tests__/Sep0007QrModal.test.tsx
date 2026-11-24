import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Keypair, TransactionBuilder, Networks, Operation, Asset } from '@stellar/stellar-sdk';
import Sep0007QrModal from '@/components/wallet/Sep0007QrModal';
import * as sep0007Lib from '@/lib/sep0007';

describe('Sep0007QrModal Component (#192)', () => {
  let sampleXdr: string;
  const source = Keypair.random();

  beforeAll(() => {
    const tx = new TransactionBuilder(
      new (require('@stellar/stellar-sdk').Account)(source.publicKey(), '100'),
      {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
      },
    )
      .addOperation(
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: Asset.native(),
          amount: '5.0',
        }),
      )
      .setTimeout(300)
      .build();

    sampleXdr = tx.toXDR();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders modal with QR code, action message, and transaction details', async () => {
    const onClose = jest.fn();

    render(
      <Sep0007QrModal
        isOpen={true}
        onClose={onClose}
        xdr={sampleXdr}
        networkPassphrase={Networks.TESTNET}
        message="Authorize medical consultation payment"
      />,
    );

    expect(screen.getByText('Sign with Mobile Wallet')).toBeInTheDocument();
    expect(screen.getByText('Authorize medical consultation payment')).toBeInTheDocument();
    expect(screen.getByText(/Tx Hash:/i)).toBeInTheDocument();
    expect(screen.getByText('Copy URI')).toBeInTheDocument();

    await waitFor(() => {
      const img = screen.getByAltText('SEP-0007 Transaction QR Code');
      expect(img).toBeInTheDocument();
    });
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <Sep0007QrModal
        isOpen={false}
        onClose={jest.fn()}
        xdr={sampleXdr}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = jest.fn();

    render(
      <Sep0007QrModal
        isOpen={true}
        onClose={onClose}
        xdr={sampleXdr}
        networkPassphrase={Networks.TESTNET}
      />,
    );

    const closeBtn = screen.getByLabelText('Close QR signing modal');
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('copies SEP-0007 URI to clipboard', async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    render(
      <Sep0007QrModal
        isOpen={true}
        onClose={jest.fn()}
        xdr={sampleXdr}
        networkPassphrase={Networks.TESTNET}
      />,
    );

    await waitFor(() => {
      const copyBtn = screen.getByText('Copy URI');
      expect(copyBtn).not.toBeDisabled();
    });

    const copyBtn = screen.getByText('Copy URI');
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('web+stellar:tx?'));
      expect(screen.getByText('Copied URI')).toBeInTheDocument();
    });
  });

  it('displays confirmation badge and invokes onConfirmed upon stream confirmation', async () => {
    const onConfirmed = jest.fn();
    const mockHash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

    jest.spyOn(sep0007Lib, 'getTransactionHashFromXDR').mockReturnValue(mockHash);
    jest.spyOn(sep0007Lib, 'streamHorizonTransaction').mockImplementation(({ onConfirmed: callback }) => {
      setTimeout(() => callback({ hash: mockHash, ledger: 54321 }), 10);
      return () => {};
    });

    render(
      <Sep0007QrModal
        isOpen={true}
        onClose={jest.fn()}
        xdr={sampleXdr}
        onConfirmed={onConfirmed}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Transaction Confirmed!/i)).toBeInTheDocument();
      expect(screen.getByText(/Ledger #54321/i)).toBeInTheDocument();
      expect(onConfirmed).toHaveBeenCalledWith({ hash: mockHash, ledger: 54321 });
    });
  });
});
