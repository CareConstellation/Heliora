import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import {
  STELLAR_CONFIG,
  invokeSorobanContract,
  type TransactionSigner,
} from './stellar';

export const DEFAULT_CONTRACT_ID = process.env.NEXT_PUBLIC_HELIORA_CONTRACT_ID ?? '';
export const EXPECTED_WASM_HASH =
  process.env.NEXT_PUBLIC_EXPECTED_CONTRACT_WASM_HASH ?? '';

export interface ContractVersionInfo {
  wasmHash: string;
  isCompatible: boolean;
  latestLedger: number;
}

export interface BytecodeDiffSummary {
  isIdentical: boolean;
  activeHash: string;
  targetHash: string;
  upgradeRequired: boolean;
  hashLength: {
    active: number;
    target: number;
  };
  commonPrefix: string;
  diffSummaryText: string;
}

export interface ContractUpgradeSimulationResult {
  success: boolean;
  minResourceFee?: string;
  footprint?: {
    readOnlyCount: number;
    readWriteCount: number;
  };
  simulatedLedger?: number;
  error?: string;
}

/**
 * Fetches the active deployed WASM hash for a given Soroban contract (#195).
 * Queries the contract instance ledger entry via getLedgerEntries.
 *
 * Time:  O(1) — single RPC round-trip
 * Space: O(1) — constant footprint entry
 */
export async function fetchActiveContractWasmHash(
  contractId = DEFAULT_CONTRACT_ID,
  rpcUrl = STELLAR_CONFIG.sorobanRpcUrl,
): Promise<string | null> {
  if (!contractId || !rpcUrl) return null;

  try {
    const server = new rpc.Server(rpcUrl);
    const contract = new Contract(contractId);
    const instanceKey = contract.getFootprint();

    const response = await server.getLedgerEntries(instanceKey);
    if (!response.entries || response.entries.length === 0) return null;

    const entry = response.entries[0]!;
    const contractData = entry.val.contractData();
    const instance = contractData.val().instance();
    const executable = instance.executable();
    return executable.wasmHash().toString('hex');
  } catch {
    return null;
  }
}

/**
 * Queries the Soroban ledger for the default contract's deployed WASM hash and
 * compares it against the expected hash from the environment variable.
 */
export async function checkContractVersion(
  contractId = DEFAULT_CONTRACT_ID,
): Promise<ContractVersionInfo | null> {
  if (!contractId || !STELLAR_CONFIG.sorobanRpcUrl) return null;

  try {
    const server = new rpc.Server(STELLAR_CONFIG.sorobanRpcUrl);
    const contract = new Contract(contractId);
    const instanceKey = contract.getFootprint();

    const response = await server.getLedgerEntries(instanceKey);
    if (!response.entries || response.entries.length === 0) return null;

    const entry = response.entries[0]!;
    const contractData = entry.val.contractData();
    const instance = contractData.val().instance();
    const executable = instance.executable();
    const wasmHash = executable.wasmHash().toString('hex');

    return {
      wasmHash,
      isCompatible: !EXPECTED_WASM_HASH || wasmHash.toLowerCase() === EXPECTED_WASM_HASH.toLowerCase(),
      latestLedger: response.latestLedger,
    };
  } catch {
    return null;
  }
}

/**
 * Compares the active deployed WASM bytecode hash against a target candidate hash (#195).
 * Generates an analytical bytecode difference summary for administrative review.
 *
 * Time:  O(L) where L is the hash character length (64 hex characters) -> O(1)
 * Space: O(1)
 */
export function compareContractWasmHashes(
  activeWasmHash: string,
  targetWasmHash: string,
): BytecodeDiffSummary {
  const normActive = activeWasmHash.trim().toLowerCase();
  const normTarget = targetWasmHash.trim().toLowerCase();
  const isIdentical = normActive === normTarget && normActive.length > 0;

  let commonPrefix = '';
  const maxLen = Math.min(normActive.length, normTarget.length);
  for (let i = 0; i < maxLen; i++) {
    if (normActive[i] === normTarget[i]) {
      commonPrefix += normActive[i];
    } else {
      break;
    }
  }

  let diffSummaryText = '';
  if (!normActive && !normTarget) {
    diffSummaryText = 'No hashes provided for comparison.';
  } else if (!normActive) {
    diffSummaryText = `New target deployment: ${normTarget.slice(0, 16)}… (${normTarget.length / 2} bytes). Active instance not yet deployed.`;
  } else if (isIdentical) {
    diffSummaryText = `Target bytecode is identical to deployed instance (${normActive.slice(0, 16)}…). No migration required.`;
  } else {
    diffSummaryText = `Bytecode divergence detected: Active (${normActive.slice(0, 12)}…) → Target (${normTarget.slice(0, 12)}…). Migration required.`;
  }

  return {
    isIdentical,
    activeHash: normActive,
    targetHash: normTarget,
    upgradeRequired: !isIdentical && normTarget.length > 0,
    hashLength: {
      active: normActive.length / 2,
      target: normTarget.length / 2,
    },
    commonPrefix,
    diffSummaryText,
  };
}

/**
 * Builds the `upgrade(new_wasm_hash)` invocation operation for Soroban (#195).
 */
export function buildContractUpgradeOperation(
  contractId: string,
  newWasmHash: string,
): xdr.Operation {
  const cleanHash = newWasmHash.trim().replace(/^0x/i, '');
  if (cleanHash.length !== 64) {
    throw new Error('Target WASM hash must be exactly 64 hexadecimal characters (32 bytes).');
  }

  const hashBuffer = Buffer.from(cleanHash, 'hex');
  return new Contract(contractId).call(
    'upgrade',
    xdr.ScVal.scvBytes(hashBuffer),
  );
}

/**
 * Simulates a contract upgrade transaction with the Soroban RPC server (#195).
 * Validates admin authorization, resource footprint, and calculates required fees.
 *
 * Time:  O(1) RPC round-trip
 * Space: O(1) response payload
 */
export async function simulateContractUpgrade(
  adminAddress: string,
  contractId: string,
  newWasmHash: string,
  rpcUrl = STELLAR_CONFIG.sorobanRpcUrl,
  serverInstance?: rpc.Server,
): Promise<ContractUpgradeSimulationResult> {
  const server = serverInstance ?? (rpcUrl ? new rpc.Server(rpcUrl) : null);
  if (!server) {
    throw new Error('NEXT_PUBLIC_SOROBAN_RPC_URL is not configured.');
  }

  const operation = buildContractUpgradeOperation(contractId, newWasmHash);

  try {
    const account = await server.getAccount(adminAddress);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: STELLAR_CONFIG.passphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(tx);

    if ('error' in simulation) {
      return {
        success: false,
        error: String((simulation as any).error || 'Simulation returned an error'),
      };
    }

    const successResponse = simulation as rpc.Api.SimulateTransactionSuccessResponse;
    const footprint = successResponse.transactionData?.build()?.resources()?.footprint();
    const readOnlyCount = footprint?.readOnly()?.length ?? 0;
    const readWriteCount = footprint?.readWrite()?.length ?? 0;

    return {
      success: true,
      minResourceFee: successResponse.minResourceFee,
      footprint: {
        readOnlyCount,
        readWriteCount,
      },
      simulatedLedger: successResponse.latestLedger,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Executes a full on-chain contract upgrade with the admin signer (#195).
 */
export async function executeContractUpgrade(
  adminAddress: string,
  contractId: string,
  newWasmHash: string,
  signer: TransactionSigner,
): Promise<{ txHash: string }> {
  const operation = buildContractUpgradeOperation(contractId, newWasmHash);
  const txHash = await invokeSorobanContract(
    adminAddress,
    operation,
    signer,
    'soroban.upgrade_contract',
  );
  return { txHash };
}
