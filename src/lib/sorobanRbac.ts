import {
  BASE_FEE,
  Contract,
  nativeToScVal,
  scValToNative,
  TransactionBuilder,
  rpc,
} from '@stellar/stellar-sdk';
import { STELLAR_CONFIG } from './stellar';
import type { UserRole } from '@/types';

const ROLE_CACHE_TTL_MS = 5 * 60 * 1000;
const SIMULATION_TIMEOUT_SECONDS = 30;
const ACCESS_CONTROL_CONTRACT_ID =
  process.env.NEXT_PUBLIC_ACCESS_CONTROL_CONTRACT_ID ?? '';

interface CachedRole {
  role: UserRole | null;
  fetchedAt: number;
}

const roleCache = new Map<string, CachedRole>();

/**
 * Queries the on-chain Heliora Access Control Contract for a user's role.
 * Uses read-only simulation (no signing required). Results are cached
 * client-side with a 5-minute TTL.
 *
 * Time:  O(1) cache hit, O(1) RPC round-trip on miss
 * Space: O(n) where n = distinct addresses cached
 */
export async function queryOnChainRole(
  address: string,
): Promise<UserRole | null> {
  const cached = roleCache.get(address);
  if (cached && Date.now() - cached.fetchedAt < ROLE_CACHE_TTL_MS) {
    return cached.role;
  }

  if (!ACCESS_CONTROL_CONTRACT_ID || !STELLAR_CONFIG.sorobanRpcUrl) {
    return null;
  }

  try {
    const server = new rpc.Server(STELLAR_CONFIG.sorobanRpcUrl);
    const contract = new Contract(ACCESS_CONTROL_CONTRACT_ID);
    const operation = contract.call(
      'get_role',
      nativeToScVal(address, { type: 'address' }),
    );

    const account = await server.getAccount(address);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: STELLAR_CONFIG.passphrase,
    })
      .addOperation(operation)
      .setTimeout(SIMULATION_TIMEOUT_SECONDS)
      .build();

    const simulation = await server.simulateTransaction(tx);

    if ('error' in simulation) {
      roleCache.set(address, { role: null, fetchedAt: Date.now() });
      return null;
    }

    const success =
      simulation as rpc.Api.SimulateTransactionSuccessResponse;
    if (!success.result?.retval) {
      roleCache.set(address, { role: null, fetchedAt: Date.now() });
      return null;
    }

    const raw = scValToNative(success.result.retval) as string;
    const role = normalizeRole(raw);
    roleCache.set(address, { role, fetchedAt: Date.now() });
    return role;
  } catch {
    return null;
  }
}

function normalizeRole(raw: string): UserRole | null {
  const upper = raw.toUpperCase();
  if (
    upper === 'PATIENT' ||
    upper === 'DOCTOR' ||
    upper === 'HOSPITAL' ||
    upper === 'ADMIN'
  ) {
    return upper as UserRole;
  }
  return null;
}

/**
 * Resolves conflicts between backend-reported and ledger-reported roles.
 * The ledger is authoritative — on-chain state takes precedence when available.
 */
export function resolveRoleConflict(
  backendRole: UserRole | null,
  ledgerRole: UserRole | null,
): UserRole | null {
  if (ledgerRole) return ledgerRole;
  return backendRole;
}

export function invalidateRoleCache(address: string): void {
  roleCache.delete(address);
}

export function clearRoleCache(): void {
  roleCache.clear();
}
