import type { UserRole } from '@/types';

export interface RoleToken {
  address: string;
  role: UserRole;
  issuedAt: number;
  expiresAt: number;
  issuer?: string;
  revoked?: boolean;
}

export interface SignedRoleToken {
  token: RoleToken;
  signature: string;
}

const ROLE_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory revocation registry for role tokens (revocation list)
const revokedTokensRegistry = new Set<string>();

function getRevocationKey(address: string, role?: UserRole): string {
  return role ? `${address}:${role}` : address;
}

/**
 * Checks if a role token is expired based on current timestamp.
 * Time: O(1)
 * Space: O(1)
 */
export function isRoleTokenExpired(
  token: Pick<RoleToken, 'expiresAt'>,
  now = Date.now(),
): boolean {
  return now >= token.expiresAt;
}

/**
 * Checks if a role token has been revoked.
 * Time: O(1)
 * Space: O(1)
 */
export function isRoleTokenRevoked(address: string, role?: UserRole): boolean {
  return (
    revokedTokensRegistry.has(getRevocationKey(address, role)) ||
    revokedTokensRegistry.has(getRevocationKey(address))
  );
}

/**
 * Marks a role token as revoked in the client registry.
 * Time: O(1)
 * Space: O(1)
 */
export function revoke_role_token(account: string, role?: UserRole): void {
  if (role) {
    revokedTokensRegistry.add(getRevocationKey(account, role));
  }
  revokedTokensRegistry.add(account);
}

export const revokeRoleToken = revoke_role_token;

/**
 * Clears the revoked tokens registry (mainly for testing or session reset).
 */
export function clearRevocationRegistry(): void {
  revokedTokensRegistry.clear();
}

/**
 * Creates a role token claim that can be signed server-side or on-chain.
 * Supports custom expiration (duration in ms or absolute epoch timestamp).
 */
export function createRoleToken(
  address: string,
  role: UserRole,
  expirationOrTtlMs?: number,
  issuer?: string,
): RoleToken {
  const now = Date.now();
  let expiresAt: number;

  if (expirationOrTtlMs !== undefined) {
    if (expirationOrTtlMs >= 1_000_000_000_000) {
      // Absolute epoch timestamp in milliseconds (e.g. > 1.7e12)
      expiresAt = expirationOrTtlMs;
    } else if (expirationOrTtlMs >= 1_000_000_000) {
      // Absolute epoch timestamp in seconds (e.g. > 1.7e9)
      expiresAt = expirationOrTtlMs * 1000;
    } else {
      // Relative TTL in milliseconds (e.g. 24h = 86,400,000 ms)
      expiresAt = now + expirationOrTtlMs;
    }
  } else {
    expiresAt = now + ROLE_TOKEN_EXPIRY_MS;
  }

  return {
    address,
    role,
    issuedAt: now,
    expiresAt,
    ...(issuer ? { issuer } : {}),
    revoked: false,
  };
}

/**
 * Mints and signs a role token.
 * Time: O(1)
 * Space: O(1)
 */
export async function mint_role_token(
  account: string,
  role: UserRole,
  expiration: number,
  signingKeyHex?: string,
  issuer?: string,
): Promise<SignedRoleToken> {
  const token = createRoleToken(account, role, expiration, issuer);

  // If a signing key is provided, compute HMAC-SHA256 signature
  let signature = '';
  if (signingKeyHex) {
    signature = await signRoleToken(token, signingKeyHex);
  }

  return {
    token,
    signature,
  };
}

export const mintRoleToken = mint_role_token;

/**
 * Signs a role token with an HMAC key.
 */
export async function signRoleToken(
  token: RoleToken,
  signingKeyHex: string,
): Promise<string> {
  const serialized = serializeRoleToken(token);
  const encoder = new TextEncoder();
  const data = encoder.encode(serialized);

  const key = await crypto.subtle.importKey(
    'raw',
    hexToUint8Array(signingKeyHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sigBuffer = await crypto.subtle.sign('HMAC', key, data);
  return uint8ArrayToHex(new Uint8Array(sigBuffer));
}

/**
 * Serializes a role token for signing.
 */
export function serializeRoleToken(token: RoleToken): string {
  return JSON.stringify({
    address: token.address,
    role: token.role,
    issuedAt: token.issuedAt,
    expiresAt: token.expiresAt,
    ...(token.issuer ? { issuer: token.issuer } : {}),
  });
}

/**
 * Verifies a role token: checks revocation, expiration, and cryptographic signature.
 */
export async function verifyRoleToken(
  token: RoleToken,
  signature?: string,
  serverPublicKey?: string,
): Promise<boolean> {
  // 1. Check revocation
  if (isRoleTokenRevoked(token.address, token.role)) {
    return false;
  }

  // 2. Check token expiration
  if (isRoleTokenExpired(token)) {
    return false;
  }

  // 3. Check signature if server public key and signature are present
  if (signature && serverPublicKey) {
    return verifyRoleTokenSignature(token, signature, serverPublicKey);
  }

  return true;
}

/**
 * Verifies a role token signature using the server's public key.
 * In production, this verifies an HMAC-SHA256 signature.
 */
export async function verifyRoleTokenSignature(
  token: RoleToken,
  signature: string,
  serverPublicKey: string,
): Promise<boolean> {
  try {
    if (!signature || !serverPublicKey) {
      return false;
    }

    if (isRoleTokenRevoked(token.address, token.role)) {
      return false;
    }

    if (isRoleTokenExpired(token)) {
      return false;
    }

    const serialized = serializeRoleToken(token);
    const encoder = new TextEncoder();
    const data = encoder.encode(serialized);
    const sig = hexToUint8Array(signature);

    const publicKey = await crypto.subtle.importKey(
      'raw',
      hexToUint8Array(serverPublicKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    return await crypto.subtle.verify('HMAC', publicKey, sig, data);
  } catch (err) {
    console.error('Role token verification failed:', err);
    return false;
  }
}

/**
 * Checks if a role token has been tampered with by comparing
 * the stored signature against the current role state.
 */
export async function detectRoleTampering(
  currentRole: UserRole,
  storedToken: RoleToken,
  storedSignature: string,
  serverPublicKey: string,
): Promise<boolean> {
  if (storedToken.role !== currentRole) {
    return true;
  }

  if (isRoleTokenRevoked(storedToken.address, currentRole)) {
    return true;
  }

  if (isRoleTokenExpired(storedToken)) {
    return true;
  }

  const isValid = await verifyRoleTokenSignature(storedToken, storedSignature, serverPublicKey);
  if (!isValid) {
    return true;
  }

  return false;
}

function hexToUint8Array(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
