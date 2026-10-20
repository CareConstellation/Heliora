import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RecordIpfsStatus from '@/components/records/RecordIpfsStatus';

const CID = 'bafkreih4gkiupefhskszkjigi4q46gjazuo4svnm643nkkmxdo4b2pyj6m';
jest.mock('@/store/useWalletStore', () => ({ useWalletStore: () => ({ publicKey: 'GPATIENT' }) }));
jest.mock('@/lib/crypto', () => ({ decryptFile: jest.fn(async () => new Uint8Array([1]).buffer) }));
jest.mock('@/lib/ipfs', () => ({
  cidToString: jest.fn(),
  fetchVerifiedCiphertext: jest.fn(async () => new Uint8Array([7]).buffer),
  probeGateways: jest.fn(async () => [
    { gateway: 'https://ipfs.io', latencyMs: 142, status: 200 },
    { gateway: 'https://dweb.link', latencyMs: null, status: null },
    { gateway: 'https://gw.example', latencyMs: 90, status: 429 },
  ]),
  readOnChainCid: jest.fn(async () => new Uint8Array([1, 2, 3])),
}));
jest.mock('@/services/api.service', () => ({
  fetchRecordIpfsStorage: jest.fn(async () => ({
    cid: CID,
    pinStatus: 'pinned',
    pinnedAt: '2026-10-20T10:00:00Z',
  })),
  fetchRecordKeyMaterial: jest.fn(async () => ({
    key: btoa('k'.repeat(32)),
    iv: btoa('i'.repeat(12)),
    fileName: 'scan.pdf',
    fileType: 'application/pdf',
  })),
}));

const ipfs = jest.requireMock('@/lib/ipfs');
const { decryptFile } = jest.requireMock('@/lib/crypto');

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordIpfsStatus recordId="rec-1" />
    </QueryClientProvider>,
  );
}

describe('RecordIpfsStatus (#28)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    URL.createObjectURL = jest.fn(() => 'blob:x');
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('shows pinning status, CID and per-gateway latency in the record drawer', async () => {
    setup();
    expect(await screen.findByText('Pinned')).toBeInTheDocument();
    expect(screen.getByText(CID)).toBeInTheDocument();
    expect(await screen.findByText('142 ms')).toBeInTheDocument();
    expect(screen.getByText('unreachable')).toBeInTheDocument();
    expect(screen.getByText('HTTP 429 · 90 ms')).toBeInTheDocument(); // rate-limited, not down
    expect(ipfs.probeGateways).toHaveBeenCalledWith(CID);
  });

  it('decrypts only after the ciphertext matches the on-chain CID pointer', async () => {
    ipfs.cidToString.mockReturnValue(CID);
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Download & decrypt' }));

    await waitFor(() => expect(decryptFile).toHaveBeenCalled());
    expect(ipfs.readOnChainCid).toHaveBeenCalledWith('rec-1', 'GPATIENT');
    expect(ipfs.fetchVerifiedCiphertext).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  });

  it('blocks decryption when the stored CID differs from the on-chain pointer', async () => {
    ipfs.cidToString.mockReturnValue('bafkreidifferent');
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Download & decrypt' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'does not match the on-chain pointer',
    );
    expect(ipfs.fetchVerifiedCiphertext).not.toHaveBeenCalled();
    expect(decryptFile).not.toHaveBeenCalled();
  });
});
