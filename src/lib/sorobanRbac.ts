import {
  BASE_FEE,
  Contract,
  nativeToScVal,
  scValToNative,
  TransactionBuilder,
  rpc,
} from '@stellar/stellar-sdk';
import { STELLAR_CONFIG, invokeSorobanContract, type TransactionSigner } from './stellar';
import {
  revoke_role_token as revokeLocalToken,
  mint_role_token as mintLocalToken,
  type SignedRoleToken,
} from './roleTokenSigning';
import type { UserRole } from '@/types';

const ROLE_CACHE_TTL_MS = 5 * 60 * 1000;
const SIMULATION_TIMEOUT_SECONDS = 30;

export function getAccessControlContractId(): string {
  return process.env.NEXT_PUBLIC_ACCESS_CONTROL_CONTRACT_ID ?? '';
}

interface CachedRole {
  role: UserRole | null;
  fetchedAt: number;
}

const roleCache = new Map<string, CachedRole>();

/**
 * Builds the `mint_role_token(admin, account, role, expiration)` operation for Soroban.
 */
export function buildMintRoleTokenOperation(
  adminAddress: string,
  account: string,
  role: UserRole,
  expiration: number,
) {
  const contractId = getAccessControlContractId();
  if (!contractId) {
    throw new Error('NEXT_PUBLIC_ACCESS_CONTROL_CONTRACT_ID is not configured.');
  }
  return new Contract(contractId).call(
    'mint_role_token',
    nativeToScVal(adminAddress, { type: 'address' }),
    nativeToScVal(account, { type: 'address' }),
    nativeToScVal(role, { type: 'symbol' }),
    nativeToScVal(BigInt(expiration), { type: 'u64' }),
  );
}

/**
 * Builds the `revoke_role_token(admin, account, role)` operation for Soroban.
 */
export function buildRevokeRoleTokenOperation(
  adminAddress: string,
  account: string,
  role: UserRole,
) {
  const contractId = getAccessControlContractId();
  if (!contractId) {
    throw new Error('NEXT_PUBLIC_ACCESS_CONTROL_CONTRACT_ID is not configured.');
  }
  return new Contract(contractId).call(
    'revoke_role_token',
    nativeToScVal(adminAddress, { type: 'address' }),
    nativeToScVal(account, { type: 'address' }),
    nativeToScVal(role, { type: 'symbol' }),
  );
}

/**
 * Mints an on-chain or bridged role token.
 * When a signer and adminAddress are supplied, submits the transaction to Soroban.
 * Also generates the cryptographic client token and refreshes the cache.
 */
export async function mint_role_token(
  account: string,
  role: UserRole,
  expiration: number,
  signer?: TransactionSigner,
  adminAddress?: string,
): Promise<{ txHash?: string; signedToken: SignedRoleToken }> {
  let txHash: string | undefined;

  const contractId = getAccessControlContractId();
  if (signer && adminAddress && contractId) {
    const operation = buildMintRoleTokenOperation(adminAddress, account, role, expiration);
    txHash = await invokeSorobanContract(
      adminAddress,
      operation,
      signer,
      'soroban.mint_role_token',
    );
  }

  // Generate cryptographic token
  const signedToken = await mintLocalToken(
    account,
    role,
    expiration,
    process.env.NEXT_PUBLIC_ROLE_VERIFICATION_KEY,
    adminAddress,
  );

  // Invalidate stale cache for account
  invalidateRoleCache(account);
  roleCache.set(account, { role, fetchedAt: Date.now() });

  return { txHash, signedToken };
}

export const mintRoleToken = mint_role_token;

/**
 * Revokes a role token. Can be executed by hospital administrators or system admins.
 * Submits the revocation to Soroban if signer is provided, updates local revocation registry,
 * and invalidates cached role state.
 */
export async function revoke_role_token(
  account: string,
  role: UserRole,
  signer?: TransactionSigner,
  adminAddress?: string,
): Promise<{ txHash?: string; success: boolean }> {
  let txHash: string | undefined;

  const contractId = getAccessControlContractId();
  if (signer && adminAddress && contractId) {
    const operation = buildRevokeRoleTokenOperation(adminAddress, account, role);
    txHash = await invokeSorobanContract(
      adminAddress,
      operation,
      signer,
      'soroban.revoke_role_token',
    );
  }

  // Register in client revocation registry and wipe cache
  revokeLocalToken(account, role);
  invalidateRoleCache(account);

  return { txHash, success: true };
}

export const revokeRoleToken = revoke_role_token;

/**
 * Verifies role token validity on-chain through contract simulation.
 */
export async function verifyOnChainRoleToken(
  address: string,
  role: UserRole,
): Promise<boolean> {
  const currentRole = await queryOnChainRole(address);
  return currentRole === role;
}

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

  const contractId = getAccessControlContractId();
  if (!contractId || !STELLAR_CONFIG.sorobanRpcUrl) {
    return null;
  }

  try {
    const server = new rpc.Server(STELLAR_CONFIG.sorobanRpcUrl);
    const contract = new Contract(contractId);
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
