/**
 * Anti-phishing security shield (#119).
 *
 * During setup the user picks a secret icon and phrase. Both are sealed in an
 * encrypted local slot that only the genuine Heliora origin can read: a
 * look-alike domain has its own `localStorage` and IndexedDB, so it cannot
 * show the user's shield. Seeing the shield after typing the wallet public key
 * is the user's cue that they are on the real site.
 *
 * The server also keeps a salted fingerprint of the shield, registered with a
 * SEP-53 signature by the wallet. On login it returns an attestation of that
 * fingerprint for the requesting origin, signed with the Heliora auth signing
 * key. The client checks the signature, the origin, the freshness and that the
 * fingerprint matches the local shield. A mismatch means the local shield or
 * the server's record was replaced, and the user is warned.
 *
 * The phrase itself never leaves the browser.
 */

import { Buffer } from 'buffer';
import { StrKey } from '@stellar/stellar-sdk';
import { verifySignedMessage } from '@/lib/stellar';
import { createEncryptedLocalStore, type LocalKeyProvider } from '@/lib/encryptedLocalStore';
import type { ShieldAttestation, ShieldIcon, ShieldVerificationStatus } from '@/types';

export const SHIELD_ICONS: readonly ShieldIcon[] = [
  'anchor',
  'compass',
  'feather',
  'flame',
  'gem',
  'heart',
  'key',
  'leaf',
  'moon',
  'mountain',
  'star',
  'sun',
];

export const SHIELD_PHRASE_MIN_LENGTH = 4;
export const SHIELD_PHRASE_MAX_LENGTH = 48;

/** Attestations older than this are rejected, so a captured one cannot be replayed later. */
export const ATTESTATION_MAX_AGE_MS = 5 * 60 * 1000;
/** Tolerated clock skew between the browser and the server. */
const ATTESTATION_CLOCK_SKEW_MS = 30 * 1000;

const FINGERPRINT_DOMAIN = 'heliora-anti-phishing:v1';
const ATTESTATION_DOMAIN = 'heliora-anti-phishing-attestation:v1';
const ENROLLMENT_DOMAIN = 'heliora-anti-phishing-enrollment:v1';

export interface AntiPhishingShield {
  icon: ShieldIcon;
  phrase: string;
  createdAt: string;
}

/** Returns why a shield cannot be saved, or `null` when it is valid. */
export function validateShield(icon: string, phrase: string): string | null {
  if (!SHIELD_ICONS.includes(icon as ShieldIcon)) return 'Pick one of the shield icons.';
  const trimmed = phrase.trim();
  if (trimmed.length < SHIELD_PHRASE_MIN_LENGTH) {
    return `Your security phrase needs at least ${SHIELD_PHRASE_MIN_LENGTH} characters.`;
  }
  if (trimmed.length > SHIELD_PHRASE_MAX_LENGTH) {
    return `Your security phrase can be at most ${SHIELD_PHRASE_MAX_LENGTH} characters.`;
  }
  return null;
}

export function createShieldStore(keyProvider?: LocalKeyProvider) {
  return createEncryptedLocalStore<AntiPhishingShield>({
    namespace: 'heliora-shield',
    ...(keyProvider ? { keyProvider } : {}),
  });
}

/**
 * Salted SHA-256 fingerprint of a shield, as hex. Salting with the wallet key
 * means the same icon and phrase give different fingerprints for different
 * accounts.
 */
export async function computeShieldFingerprint(
  publicKey: string,
  shield: Pick<AntiPhishingShield, 'icon' | 'phrase'>,
): Promise<string> {
  const input = [
    FINGERPRINT_DOMAIN,
    publicKey,
    shield.icon,
    shield.phrase.trim().normalize('NFC'),
  ].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Buffer.from(new Uint8Array(digest)).toString('hex');
}

/** Message the wallet signs (SEP-53) to register its shield fingerprint with the server. */
export function shieldEnrollmentMessage(
  publicKey: string,
  fingerprint: string,
  origin: string,
  issuedAt: string,
): string {
  return [ENROLLMENT_DOMAIN, publicKey, fingerprint, origin, issuedAt].join('\n');
}

/** Message the Heliora auth signing key signs (SEP-53) for an attestation. */
export function shieldAttestationMessage(
  attestation: Omit<ShieldAttestation, 'signature'>,
): string {
  return [
    ATTESTATION_DOMAIN,
    attestation.publicKey,
    attestation.fingerprint,
    attestation.origin,
    attestation.issuedAt,
  ].join('\n');
}

/**
 * Checks a server attestation against the local shield. Every check that
 * fails maps to a distinct status so the UI can explain what went wrong.
 */
export function verifyShieldAttestation(options: {
  attestation: ShieldAttestation;
  publicKey: string;
  expectedFingerprint: string;
  origin: string;
  serverSigningKey: string;
  now?: number;
}): ShieldVerificationStatus {
  const { attestation, publicKey, expectedFingerprint, origin, serverSigningKey } = options;
  const now = options.now ?? Date.now();

  if (
    !verifySignedMessage(
      serverSigningKey,
      shieldAttestationMessage(attestation),
      attestation.signature,
    )
  ) {
    return 'invalid-signature';
  }
  if (attestation.publicKey !== publicKey) return 'invalid-signature';
  if (attestation.origin !== origin) return 'wrong-origin';

  const issuedAt = Date.parse(attestation.issuedAt);
  if (
    Number.isNaN(issuedAt) ||
    issuedAt > now + ATTESTATION_CLOCK_SKEW_MS ||
    now - issuedAt > ATTESTATION_MAX_AGE_MS
  ) {
    return 'stale';
  }

  return attestation.fingerprint === expectedFingerprint ? 'verified' : 'mismatch';
}

const COMPROMISED_STATUSES: ReadonlySet<ShieldVerificationStatus> = new Set([
  'mismatch',
  'invalid-signature',
  'wrong-origin',
  'stale',
]);

/** Whether a shield check failed in a way that points at phishing or tampering. */
export function isShieldCompromised(status: ShieldVerificationStatus | null): boolean {
  return status !== null && COMPROMISED_STATUSES.has(status);
}

/** Server key that signs shield attestations (the SEP-10 backend auth signing key). */
export function getAttestationSigningKey(): string | null {
  const key = process.env.NEXT_PUBLIC_AUTH_SIGNING_KEY?.trim();
  return key && StrKey.isValidEd25519PublicKey(key) ? key : null;
}

/* ── Official domain check ───────────────────────────────────────── */

export type DomainCheck =
  | { status: 'official'; hostname: string }
  | { status: 'development'; hostname: string }
  | { status: 'unofficial'; hostname: string; officialDomains: string[] }
  | { status: 'insecure'; hostname: string }
  | { status: 'unconfigured'; hostname: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Hostnames Heliora is served from, from `NEXT_PUBLIC_OFFICIAL_DOMAINS` (comma-separated). */
export function getOfficialDomains(): string[] {
  return (process.env.NEXT_PUBLIC_OFFICIAL_DOMAINS ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Classifies the page's location. Only an exact hostname match over HTTPS is
 * official: `heliora.io.evil.com` and `he1iora.io` are not.
 */
export function checkOfficialDomain(
  location: Pick<Location, 'hostname' | 'protocol'>,
  officialDomains: string[] = getOfficialDomains(),
): DomainCheck {
  const hostname = location.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(hostname)) return { status: 'development', hostname };
  if (officialDomains.length === 0) return { status: 'unconfigured', hostname };
  if (!officialDomains.includes(hostname)) {
    return { status: 'unofficial', hostname, officialDomains };
  }
  if (location.protocol !== 'https:') return { status: 'insecure', hostname };
  return { status: 'official', hostname };
}
