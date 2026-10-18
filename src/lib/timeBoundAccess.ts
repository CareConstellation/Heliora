/**
 * Soroban time-bound record access delegation.
 * Allows temporary, expiring access grants to medical records.
 * (Issue #2)
 */

import { Contract, Address, nativeToScVal, scValToNative } from '@stellar/stellar-sdk';

export interface TimeBoundAccessGrant {
  grantId: string;
  recordId: string;
  granterAddress: string;
  granteeAddress: string;
  expiresAt: number; // Unix timestamp in seconds
  permissions: AccessPermission[];
  createdAt: number;
  revokedAt?: number;
  accessCount: number;
}

export enum AccessPermission {
  READ = 'read',
  DOWNLOAD = 'download',
  SHARE = 'share',
}

export interface AccessValidation {
  isValid: boolean;
  isExpired: boolean;
  remainingSeconds: number;
  remainingDays: number;
}

/**
 * Creates a time-bound access delegation for a medical record.
 */
export function createTimeBoundAccessGrant(
  recordId: string,
  granterAddress: string,
  granteeAddress: string,
  expirationDays: number,
  permissions: AccessPermission[] = [AccessPermission.READ],
): TimeBoundAccessGrant {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + expirationDays * 24 * 60 * 60;
  
  return {
    grantId: generateGrantId(),
    recordId,
    granterAddress,
    granteeAddress,
    expiresAt,
    permissions,
    createdAt: now,
    accessCount: 0,
  };
}

/**
 * Validates if an access grant is still active and not expired.
 */
export function validateAccessGrant(grant: TimeBoundAccessGrant): AccessValidation {
  const now = Math.floor(Date.now() / 1000);
  const isExpired = grant.expiresAt <= now;
  const remainingSeconds = Math.max(0, grant.expiresAt - now);
  const remainingDays = Math.floor(remainingSeconds / (24 * 60 * 60));
  
  return {
    isValid: !isExpired && !grant.revokedAt,
    isExpired,
    remainingSeconds,
    remainingDays,
  };
}

/**
 * Checks if an access grant permits a specific action.
 */
export function hasPermission(grant: TimeBoundAccessGrant, permission: AccessPermission): boolean {
  const validation = validateAccessGrant(grant);
  return validation.isValid && grant.permissions.includes(permission);
}

/**
 * Extends the expiration time of an existing grant.
 */
export function extendAccessGrant(
  grant: TimeBoundAccessGrant,
  additionalDays: number,
): TimeBoundAccessGrant {
  return {
    ...grant,
    expiresAt: grant.expiresAt + additionalDays * 24 * 60 * 60,
  };
}

/**
 * Revokes an access grant immediately.
 */
export function revokeAccessGrant(grant: TimeBoundAccessGrant): TimeBoundAccessGrant {
  return {
    ...grant,
    revokedAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Builds Soroban contract invocation for delegating time-bound access.
 */
export function buildDelegateAccessInvocation(
  contractId: string,
  grant: TimeBoundAccessGrant,
) {
  const contract = new Contract(contractId);
  const granterAddr = new Address(grant.granterAddress);
  const granteeAddr = new Address(grant.granteeAddress);
  
  const permissionStrings = grant.permissions.map(p => p.toString());
  
  return contract.call('delegate_time_bound_access', [
    granterAddr,
    granteeAddr,
    grant.recordId,
    grant.expiresAt,
    permissionStrings,
  ]);
}

/**
 * Generates a unique grant ID.
 */
function generateGrantId(): string {
  return `grant_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Formats access validation for display.
 */
export function formatAccessStatus(validation: AccessValidation): string {
  if (validation.isExpired) {
    return 'Access expired';
  }
  
  if (validation.remainingDays > 0) {
    return `Expires in ${validation.remainingDays} days`;
  }
  
  if (validation.remainingSeconds > 0) {
    return `Expires in ${validation.remainingSeconds} seconds`;
  }
  
  return 'Expires soon';
}

/**
 * Calculates the actual access window in days.
 */
export function calculateAccessDuration(grant: TimeBoundAccessGrant): number {
  const durationSeconds = grant.expiresAt - grant.createdAt;
  return Math.ceil(durationSeconds / (24 * 60 * 60));
}
