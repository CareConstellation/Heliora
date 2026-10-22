import { Contract, rpc } from '@stellar/stellar-sdk';
import { STELLAR_CONFIG } from './stellar';

const CONTRACT_ID = process.env.NEXT_PUBLIC_HELIORA_CONTRACT_ID ?? '';
const EXPECTED_WASM_HASH =
  process.env.NEXT_PUBLIC_EXPECTED_CONTRACT_WASM_HASH ?? '';

export interface ContractVersionInfo {
  wasmHash: string;
  isCompatible: boolean;
  latestLedger: number;
}

/**
 * Queries the Soroban ledger for the contract's deployed WASM hash and
 * compares it against the expected hash from the environment variable.
 *
 * Uses Contract.getFootprint() to build the instance ledger key, then
 * reads it via getLedgerEntries and navigates the XDR to extract the
 * WASM hash from the contract executable.
 *
 * Time:  O(1) — single RPC round-trip
 * Space: O(1) — constant response payload
 */
export async function checkContractVersion(): Promise<ContractVersionInfo | null> {
  if (!CONTRACT_ID || !STELLAR_CONFIG.sorobanRpcUrl) return null;

  try {
    const server = new rpc.Server(STELLAR_CONFIG.sorobanRpcUrl);
    const contract = new Contract(CONTRACT_ID);
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
      isCompatible: !EXPECTED_WASM_HASH || wasmHash === EXPECTED_WASM_HASH,
      latestLedger: response.latestLedger,
    };
  } catch {
    return null;
  }
}
