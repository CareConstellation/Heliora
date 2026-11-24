import {
  compareContractWasmHashes,
  buildContractUpgradeOperation,
  simulateContractUpgrade,
  executeContractUpgrade,
} from '@/lib/sorobanContractVersioning';
import { rpc, Keypair } from '@stellar/stellar-sdk';
import { invokeSorobanContract } from '@/lib/stellar';

jest.mock('@/lib/stellar', () => {
  const actual = jest.requireActual('@/lib/stellar');
  return {
    ...actual,
    invokeSorobanContract: jest.fn(),
  };
});

describe('Issue #195: Soroban Contract Versioning & Upgrade Migration Helper', () => {
  const testContractId = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
  const testAdmin = Keypair.random().publicKey();
  const testWasmHashA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const testWasmHashB = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b999';

  describe('compareContractWasmHashes', () => {
    it('detects identical active and target WASM hashes', () => {
      const result = compareContractWasmHashes(testWasmHashA, testWasmHashA);
      expect(result.isIdentical).toBe(true);
      expect(result.upgradeRequired).toBe(false);
      expect(result.diffSummaryText).toContain('No migration required');
      expect(result.commonPrefix.length).toBe(64);
    });

    it('detects divergent WASM hashes requiring contract upgrade', () => {
      const result = compareContractWasmHashes(testWasmHashA, testWasmHashB);
      expect(result.isIdentical).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.diffSummaryText).toContain('Bytecode divergence detected');
      expect(result.commonPrefix.length).toBe(61);
    });

    it('handles empty active hash as new deployment', () => {
      const result = compareContractWasmHashes('', testWasmHashA);
      expect(result.isIdentical).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.diffSummaryText).toContain('New target deployment');
    });

    it('handles empty hashes gracefully', () => {
      const result = compareContractWasmHashes('', '');
      expect(result.isIdentical).toBe(false);
      expect(result.upgradeRequired).toBe(false);
      expect(result.diffSummaryText).toContain('No hashes provided');
    });
  });

  describe('buildContractUpgradeOperation', () => {
    it('creates a Soroban invocation operation for the upgrade function', () => {
      const op = buildContractUpgradeOperation(testContractId, testWasmHashA);
      expect(op).toBeDefined();
      const xdrObj = op.toXDR();
      expect(xdrObj).toBeDefined();
    });

    it('strips leading 0x prefix if present', () => {
      const op = buildContractUpgradeOperation(testContractId, `0x${testWasmHashA}`);
      expect(op).toBeDefined();
    });

    it('throws error for invalid hash lengths', () => {
      expect(() => buildContractUpgradeOperation(testContractId, 'abc1234')).toThrow(
        'exactly 64 hexadecimal characters',
      );
    });
  });

  describe('simulateContractUpgrade', () => {
    let mockGetAccount: jest.Mock;
    let mockSimulateTransaction: jest.Mock;
    let mockServer: rpc.Server;

    beforeEach(() => {
      mockGetAccount = jest.fn();
      mockSimulateTransaction = jest.fn();
      mockServer = {
        getAccount: mockGetAccount,
        simulateTransaction: mockSimulateTransaction,
      } as unknown as rpc.Server;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('successfully simulates an upgrade transaction with admin signer', async () => {
      mockGetAccount.mockResolvedValueOnce({
        accountId: () => testAdmin,
        sequenceNumber: () => '100',
        incrementSequenceNumber: () => {},
      });

      const mockFootprint = {
        readOnly: () => [1, 2],
        readWrite: () => [3],
      };
      const mockResources = {
        footprint: () => mockFootprint,
      };
      const mockTxData = {
        build: () => ({
          resources: () => mockResources,
        }),
      };

      mockSimulateTransaction.mockResolvedValueOnce({
        minResourceFee: '15000',
        latestLedger: 54321,
        transactionData: mockTxData,
      });

      const result = await simulateContractUpgrade(testAdmin, testContractId, testWasmHashA, undefined, mockServer);
      expect(result.success).toBe(true);
      expect(result.minResourceFee).toBe('15000');
      expect(result.simulatedLedger).toBe(54321);
      expect(result.footprint?.readOnlyCount).toBe(2);
      expect(result.footprint?.readWriteCount).toBe(1);
    });

    it('returns error when simulation fails on-chain', async () => {
      mockGetAccount.mockResolvedValueOnce({
        accountId: () => testAdmin,
        sequenceNumber: () => '100',
        incrementSequenceNumber: () => {},
      });

      mockSimulateTransaction.mockResolvedValueOnce({
        error: 'HostError: Error(Contract, #1) - Unauthorized admin',
      });

      const result = await simulateContractUpgrade(testAdmin, testContractId, testWasmHashA, undefined, mockServer);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized admin');
    });

    it('catches and formats RPC connection errors', async () => {
      mockGetAccount.mockRejectedValueOnce(new Error('RPC endpoint timeout'));

      const result = await simulateContractUpgrade(testAdmin, testContractId, testWasmHashA, undefined, mockServer);
      expect(result.success).toBe(false);
      expect(result.error).toContain('RPC endpoint timeout');
    });
  });

  describe('executeContractUpgrade', () => {
    it('executes contract upgrade and returns transaction hash', async () => {
      (invokeSorobanContract as jest.Mock).mockResolvedValueOnce('tx_upgrade_success_hash_123');

      const mockSigner = jest.fn();
      const res = await executeContractUpgrade(testAdmin, testContractId, testWasmHashA, mockSigner);

      expect(res.txHash).toBe('tx_upgrade_success_hash_123');
      expect(invokeSorobanContract).toHaveBeenCalledWith(
        testAdmin,
        expect.anything(),
        mockSigner,
        'soroban.upgrade_contract',
      );
    });
  });
});
