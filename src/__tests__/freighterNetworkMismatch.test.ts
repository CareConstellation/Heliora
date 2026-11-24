/**
 * @jest-environment node
 */
import { getNetworkDetails } from '@stellar/freighter-api';
import {
  checkFreighterNetworkMismatch,
  getFreighterNetworkDetails,
  normalizeNetwork,
} from '@/lib/wallet/FreighterSigner';

jest.mock('@stellar/freighter-api', () => ({
  getNetworkDetails: jest.fn(),
  signTransaction: jest.fn(),
}));

const mockedGetNetworkDetails = getNetworkDetails as jest.MockedFunction<typeof getNetworkDetails>;

describe('Freighter Network Mismatch Detection (#199)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('normalizeNetwork', () => {
    it('normalizes testnet, public, and mainnet names', () => {
      expect(normalizeNetwork('testnet')).toBe('testnet');
      expect(normalizeNetwork('TESTNET')).toBe('testnet');
      expect(normalizeNetwork('public')).toBe('public');
      expect(normalizeNetwork('PUBLIC')).toBe('public');
      expect(normalizeNetwork('mainnet')).toBe('public');
      expect(normalizeNetwork('MAINNET')).toBe('public');
      expect(normalizeNetwork('futurenet')).toBe('futurenet');
      expect(normalizeNetwork('standalone')).toBe('standalone');
      expect(normalizeNetwork('local')).toBe('standalone');
      expect(normalizeNetwork('')).toBe('');
      expect(normalizeNetwork(undefined)).toBe('');
    });
  });

  describe('getFreighterNetworkDetails', () => {
    it('returns network details from @stellar/freighter-api', async () => {
      mockedGetNetworkDetails.mockResolvedValueOnce({
        network: 'TESTNET',
        networkUrl: 'https://horizon-testnet.stellar.org',
        networkPassphrase: 'Test SDF Network ; September 2015',
      });

      const details = await getFreighterNetworkDetails();
      expect(details).toEqual({
        network: 'TESTNET',
        networkUrl: 'https://horizon-testnet.stellar.org',
        networkPassphrase: 'Test SDF Network ; September 2015',
      });
    });

    it('handles exceptions from getNetworkDetails gracefully', async () => {
      mockedGetNetworkDetails.mockRejectedValueOnce(new Error('Extension not available'));
      const details = await getFreighterNetworkDetails();
      expect(details).toBeNull();
    });
  });

  describe('checkFreighterNetworkMismatch', () => {
    it('reports no mismatch when Freighter network matches dApp network (case-insensitive)', async () => {
      mockedGetNetworkDetails.mockResolvedValueOnce({
        network: 'TESTNET',
      });

      const result = await checkFreighterNetworkMismatch('testnet');
      expect(result.isMismatch).toBe(false);
      expect(result.walletNetwork).toBe('TESTNET');
      expect(result.expectedNetwork).toBe('testnet');
    });

    it('reports no mismatch when Freighter is PUBLIC and dApp is mainnet', async () => {
      mockedGetNetworkDetails.mockResolvedValueOnce({
        network: 'PUBLIC',
      });

      const result = await checkFreighterNetworkMismatch('mainnet');
      expect(result.isMismatch).toBe(false);
      expect(result.walletNetwork).toBe('PUBLIC');
    });

    it('reports mismatch when Freighter is PUBLIC but dApp is testnet', async () => {
      mockedGetNetworkDetails.mockResolvedValueOnce({
        network: 'PUBLIC',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
      });

      const result = await checkFreighterNetworkMismatch('testnet');
      expect(result.isMismatch).toBe(true);
      expect(result.walletNetwork).toBe('PUBLIC');
      expect(result.expectedNetwork).toBe('testnet');
      expect(result.networkPassphrase).toBe('Public Global Stellar Network ; September 2015');
    });

    it('reports mismatch when Freighter is TESTNET but dApp is public', async () => {
      mockedGetNetworkDetails.mockResolvedValueOnce({
        network: 'TESTNET',
      });

      const result = await checkFreighterNetworkMismatch('public');
      expect(result.isMismatch).toBe(true);
      expect(result.walletNetwork).toBe('TESTNET');
      expect(result.expectedNetwork).toBe('public');
    });

    it('returns isMismatch false when Freighter details cannot be retrieved', async () => {
      mockedGetNetworkDetails.mockRejectedValueOnce(new Error('Wallet locked'));
      const result = await checkFreighterNetworkMismatch('testnet');
      expect(result.isMismatch).toBe(false);
    });
  });
});
