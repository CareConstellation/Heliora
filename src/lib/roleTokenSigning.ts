import type { UserRole } from '@/types';

export interface RoleToken {
  address: string;
  role: UserRole;
  issuedAt: number;
  expiresAt: number;
}

export interface SignedRoleToken {
  token: RoleToken;
  signature: string;
}

const ROLE_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Creates a role token claim that can be signed server-side.
 * Client stores the signature and verifies it hasn't been tampered with.
 */
export function createRoleToken(address: string, role: UserRole): RoleToken {
  return {
    address,
    role,
    issuedAt: Date.now(),
    expiresAt: Date.now() + ROLE_TOKEN_EXPIRY_MS,
  };
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
  });
}

/**
 * Verifies a role token signature using the server's public key.
 * In production, this would verify an HMAC or ECDSA signature.
 */
export async function verifyRoleTokenSignature(
  token: RoleToken,
  signature: string,
  serverPublicKey: string,
): Promise<boolean> {
  try {
    const serialized = serializeRoleToken(token);

    // Use Web Crypto API for verification
    const encoder = new TextEncoder();
    const data = encoder.encode(serialized);
    const sig = hexToUint8Array(signature);

    // Import server's public key
    const publicKey = await crypto.subtle.importKey(
      'raw',
      hexToUint8Array(serverPublicKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    // Verify signature
    const isValid = await crypto.subtle.verify('HMAC', publicKey, sig, data);

    // Check token expiry
    if (token.expiresAt < Date.now()) {
      return false;
    }

    return isValid;
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
  // Token role differs from current role
  if (storedToken.role !== currentRole) {
    return true;
  }

  // Signature is invalid
  const isValid = await verifyRoleTokenSignature(storedToken, storedSignature, serverPublicKey);
  if (!isValid) {
    return true;
  }

  return false;
}

function hexToUint8Array(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

export function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
