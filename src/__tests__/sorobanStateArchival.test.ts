import {
  inspectStorageTtl,
  inspectFootprintTtl,
  buildExtendFootprintTtlTx,
  buildRestoreFootprintTx,
  autoMaintainContractStorage,
  SorobanStateArchival,
  TTL_EXTENSION_THRESHOLD_LEDGERS,
  DEFAULT_EXTEND_TO_LEDGERS,
} from '@/lib/sorobanStateArchival';
import {
  isEntryArchived,
  needsTtlExtension,
  getRemainingLedgers,
} from '@/lib/sorobanRpc';
import { Keypair, Account, xdr } from '@stellar/stellar-sdk';

describe('Issue #186: Soroban State Archival and Automatic TTL Extension', () => {
  const currentLedger = 100_000;

  describe('isEntryArchived & getRemainingLedgers', () => {
    it('detects missing or null entry as archived', () => {
      expect(isEntryArchived(null, currentLedger)).toBe(true);
      expect(isEntryArchived(undefined, currentLedger)).toBe(true);
      expect(isEntryArchived({ liveUntilLedgerSeq: undefined }, currentLedger)).toBe(true);
    });

    it('detects entry with liveUntilLedgerSeq <= currentLedger as archived', () => {
      expect(isEntryArchived({ liveUntilLedgerSeq: currentLedger }, currentLedger)).toBe(true);
      expect(isEntryArchived({ liveUntilLedgerSeq: currentLedger - 10 }, currentLedger)).toBe(true);
      expect(getRemainingLedgers({ liveUntilLedgerSeq: currentLedger - 10 }, currentLedger)).toBe(0);
    });

    it('detects active entry with liveUntilLedgerSeq > currentLedger as not archived', () => {
      expect(isEntryArchived({ liveUntilLedgerSeq: currentLedger + 10_000 }, currentLedger)).toBe(false);
      expect(getRemainingLedgers({ liveUntilLedgerSeq: currentLedger + 10_000 }, currentLedger)).toBe(10_000);
    });
  });

  describe('needsTtlExtension (< 50,000 remaining ledgers threshold)', () => {
    it('triggers extension when remaining ledgers is strictly less than 50,000', () => {
      // 49,999 ledgers remaining
      const entry = { liveUntilLedgerSeq: currentLedger + 49_999 };
      expect(needsTtlExtension(entry, currentLedger, TTL_EXTENSION_THRESHOLD_LEDGERS)).toBe(true);
    });

    it('does not trigger extension when remaining ledgers is >= 50,000', () => {
      // exactly 50,000
      const entry50k = { liveUntilLedgerSeq: currentLedger + 50_000 };
      expect(needsTtlExtension(entry50k, currentLedger, TTL_EXTENSION_THRESHOLD_LEDGERS)).toBe(false);

      // 80,000
      const entry80k = { liveUntilLedgerSeq: currentLedger + 80_000 };
      expect(needsTtlExtension(entry80k, currentLedger, TTL_EXTENSION_THRESHOLD_LEDGERS)).toBe(false);
    });

    it('returns false for already archived entries (they require restoration instead of extension)', () => {
      const archivedEntry = { liveUntilLedgerSeq: currentLedger - 100 };
      expect(needsTtlExtension(archivedEntry, currentLedger)).toBe(false);
    });
  });

  describe('inspectStorageTtl & inspectFootprintTtl', () => {
    it('inspects individual entry TTL and classifies status accurately', () => {
      const statusArchived = inspectStorageTtl(
        { key: 'archived_key', liveUntilLedgerSeq: currentLedger - 5 },
        currentLedger,
      );
      expect(statusArchived.isArchived).toBe(true);
      expect(statusArchived.needsTtlExtension).toBe(false);
      expect(statusArchived.remainingLedgers).toBe(0);

      const statusNeedsExt = inspectStorageTtl(
        { key: 'low_ttl_key', liveUntilLedgerSeq: currentLedger + 15_000 },
        currentLedger,
      );
      expect(statusNeedsExt.isArchived).toBe(false);
      expect(statusNeedsExt.needsTtlExtension).toBe(true);
      expect(statusNeedsExt.remainingLedgers).toBe(15_000);

      const statusHealthy = inspectStorageTtl(
        { key: 'healthy_key', liveUntilLedgerSeq: currentLedger + 120_000 },
        currentLedger,
      );
      expect(statusHealthy.isArchived).toBe(false);
      expect(statusHealthy.needsTtlExtension).toBe(false);
      expect(statusHealthy.remainingLedgers).toBe(120_000);
    });

    it('partitions batch entries into archived, extension-needed, and healthy buckets', () => {
      const entries = [
        { key: 'key_archived', liveUntilLedgerSeq: currentLedger - 1 },
        { key: 'key_low_ttl', liveUntilLedgerSeq: currentLedger + 25_000 },
        { key: 'key_healthy', liveUntilLedgerSeq: currentLedger + 100_000 },
      ];

      const report = inspectFootprintTtl(entries, currentLedger, TTL_EXTENSION_THRESHOLD_LEDGERS);
      expect(report.totalChecked).toBe(3);
      expect(report.hasArchived).toBe(true);
      expect(report.hasExtensionNeeded).toBe(true);
      expect(report.archivedEntries).toHaveLength(1);
      expect(report.archivedEntries[0].key).toBe('key_archived');
      expect(report.extensionNeededEntries).toHaveLength(1);
      expect(report.extensionNeededEntries[0].key).toBe('key_low_ttl');
      expect(report.healthyEntries).toHaveLength(1);
      expect(report.healthyEntries[0].key).toBe('key_healthy');
    });
  });

  describe('Transaction builders (extendFootprintTtl and restoreFootprint)', () => {
    const sourceKeypair = Keypair.random();
    const sourceAccount = new Account(sourceKeypair.publicKey(), '100');
    const networkPassphrase = 'Test SDF Network ; September 2015';

    // Mock dummy LedgerKey
    const mockLedgerKey = new xdr.LedgerKey(
      xdr.LedgerEntryType.contractData(),
      new xdr.LedgerKeyContractData({
        contract: new xdr.ScAddress(
          xdr.ScAddressType.scAddressTypeContract(),
          Buffer.alloc(32, 1),
        ),
        key: xdr.ScVal.scvSymbol('data'),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );

    it('builds a valid Transaction with extendFootprintTtl operation', () => {
      const tx = buildExtendFootprintTtlTx(
        sourceAccount,
        [mockLedgerKey],
        networkPassphrase,
        DEFAULT_EXTEND_TO_LEDGERS,
        '200',
      );

      expect(tx).toBeDefined();
      expect(tx.operations).toHaveLength(1);
      expect(tx.operations[0].type).toBe('extendFootprintTtl');
      expect((tx.operations[0] as any).extendTo).toBe(DEFAULT_EXTEND_TO_LEDGERS);
      expect(tx.fee).toBe('200');
    });

    it('builds a valid Transaction with restoreFootprint operation', () => {
      const tx = buildRestoreFootprintTx(
        sourceAccount,
        [mockLedgerKey],
        networkPassphrase,
        '300',
      );

      expect(tx).toBeDefined();
      expect(tx.operations).toHaveLength(1);
      expect(tx.operations[0].type).toBe('restoreFootprint');
      expect(tx.fee).toBe('300');
    });
  });

  describe('autoMaintainContractStorage pipeline', () => {
    const sourceKeypair = Keypair.random();
    const sourceAccount = new Account(sourceKeypair.publicKey(), '100');
    const networkPassphrase = 'Test SDF Network ; September 2015';

    const mockLedgerKey1 = new xdr.LedgerKey(
      xdr.LedgerEntryType.contractData(),
      new xdr.LedgerKeyContractData({
        contract: new xdr.ScAddress(
          xdr.ScAddressType.scAddressTypeContract(),
          Buffer.alloc(32, 1),
        ),
        key: xdr.ScVal.scvSymbol('key1'),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );

    const mockLedgerKey2 = new xdr.LedgerKey(
      xdr.LedgerEntryType.contractData(),
      new xdr.LedgerKeyContractData({
        contract: new xdr.ScAddress(
          xdr.ScAddressType.scAddressTypeContract(),
          Buffer.alloc(32, 2),
        ),
        key: xdr.ScVal.scvSymbol('key2'),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );

    it('handles both archived and low-TTL entries, generating corresponding restore and extend transactions', async () => {
      const mockServer = {
        getLedgerEntries: jest.fn().mockResolvedValue({
          latestLedger: currentLedger,
          entries: [
            {
              key: mockLedgerKey1.toXDR('base64'),
              liveUntilLedgerSeq: currentLedger - 10, // archived
              lastModifiedLedgerSeq: currentLedger - 20,
            },
            {
              key: mockLedgerKey2.toXDR('base64'),
              liveUntilLedgerSeq: currentLedger + 20_000, // needs extension (< 50,000)
              lastModifiedLedgerSeq: currentLedger - 5,
            },
          ],
        }),
      };

      const result = await autoMaintainContractStorage(
        mockServer as any,
        sourceAccount,
        [mockLedgerKey1, mockLedgerKey2],
        networkPassphrase,
      );

      expect(result.report.hasArchived).toBe(true);
      expect(result.report.hasExtensionNeeded).toBe(true);
      expect(result.restoreTx).toBeDefined();
      expect(result.restoreTx?.operations[0].type).toBe('restoreFootprint');
      expect(result.extendTtlTx).toBeDefined();
      expect(result.extendTtlTx?.operations[0].type).toBe('extendFootprintTtl');
    });
  });

  describe('SorobanStateArchival class methods', () => {
    it('inspects TTL and partitions footprints correctly on class instance', () => {
      const archival = new SorobanStateArchival();
      const status = archival.inspectTtl(
        { key: 'test', liveUntilLedgerSeq: currentLedger + 30_000 },
        currentLedger,
      );
      expect(status.needsTtlExtension).toBe(true);
      expect(status.isArchived).toBe(false);

      const report = archival.inspectFootprint(
        [{ key: 'test', liveUntilLedgerSeq: currentLedger + 30_000 }],
        currentLedger,
      );
      expect(report.hasExtensionNeeded).toBe(true);
    });
  });
});
