/**
 * Clinical supervisor delegated proxy access (#118).
 *
 * An attending physician requests a short-lived proxy token for one of their
 * residents. While the token is active the doctor portal shows the resident's
 * encounter drafts, and the attending can approve a draft by co-signing it.
 *
 * A co-signature is a SEP-53 signature by the attending's wallet over the
 * draft's SHA-256 content hash, the draft and proxy token IDs, both
 * physicians' addresses and the signing time. Binding the content hash means
 * the backend (and any later audit) can prove which exact text was approved:
 * an edit after approval no longer matches the logged co-signature.
 */

import { Buffer } from 'buffer';
import { verifySignedMessage, type MessageSigner } from '@/lib/stellar';
import type { DelegatedProxyToken, EncounterDraft, SupervisorCosignature } from '@/types';

const COSIGNATURE_DOMAIN = 'heliora-supervisor-cosignature:v1';
/** Tolerated clock skew between the browser and the token issuer. */
const CLOCK_SKEW_MS = 30 * 1000;

/** Header text shown while a proxy token is active, e.g. "Viewing in Delegated Resident Mode (Dr. Jane Doe)". */
export function proxyBannerLabel(token: Pick<DelegatedProxyToken, 'residentName'>): string {
  const name = token.residentName.trim();
  const title = /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`;
  return `Viewing in Delegated Resident Mode (${title})`;
}

/** Whether `token` is within its validity window at `now`. */
export function isProxyTokenActive(token: DelegatedProxyToken, now = Date.now()): boolean {
  const issuedAt = Date.parse(token.issuedAt);
  const expiresAt = Date.parse(token.expiresAt);
  if (Number.isNaN(issuedAt) || Number.isNaN(expiresAt)) return false;
  return issuedAt - CLOCK_SKEW_MS <= now && now < expiresAt;
}

/** Whole minutes left before the token expires (0 once it has). */
export function proxyMinutesRemaining(token: DelegatedProxyToken, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(token.expiresAt) - now) / 60_000));
}

/** Hex SHA-256 of a draft's content, as UTF-8. */
export async function hashDraftContent(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Buffer.from(new Uint8Array(digest)).toString('hex');
}

/** Message the supervisor's wallet signs (SEP-53) to co-sign a draft. */
export function cosignatureMessage(fields: Omit<SupervisorCosignature, 'signature'>): string {
  return [
    COSIGNATURE_DOMAIN,
    fields.draftId,
    fields.proxyTokenId,
    fields.supervisorAddress,
    fields.residentAddress,
    fields.contentHash,
    fields.signedAt,
  ].join('\n');
}

export class ProxyAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProxyAccessError';
  }
}

/**
 * Co-signs `draft` under `token` with the supervisor's wallet. Throws when the
 * token has expired, lacks the co-sign scope, belongs to another resident, or
 * the draft is no longer awaiting a co-signature.
 */
export async function createSupervisorCosignature(options: {
  draft: EncounterDraft;
  token: DelegatedProxyToken;
  signMessage: MessageSigner;
  now?: number;
}): Promise<SupervisorCosignature> {
  const { draft, token, signMessage } = options;
  const now = options.now ?? Date.now();

  if (!isProxyTokenActive(token, now)) {
    throw new ProxyAccessError('Your delegated proxy session has expired. Start a new one.');
  }
  if (!token.scopes.includes('encounter:cosign')) {
    throw new ProxyAccessError('This proxy session does not allow co-signing.');
  }
  if (draft.residentAddress !== token.residentAddress) {
    throw new ProxyAccessError('This draft belongs to a different resident.');
  }
  if (draft.status !== 'pending_cosign') {
    throw new ProxyAccessError('This draft is not awaiting a co-signature.');
  }

  const fields: Omit<SupervisorCosignature, 'signature'> = {
    draftId: draft.id,
    proxyTokenId: token.tokenId,
    supervisorAddress: token.supervisorAddress,
    residentAddress: token.residentAddress,
    contentHash: await hashDraftContent(draft.content),
    signedAt: new Date(now).toISOString(),
  };
  const signature = await signMessage(cosignatureMessage(fields), token.supervisorAddress);
  return { ...fields, signature };
}

/** Checks a logged co-signature against the draft content it claims to approve. */
export async function verifySupervisorCosignature(
  cosignature: SupervisorCosignature,
  content: string,
): Promise<boolean> {
  if ((await hashDraftContent(content)) !== cosignature.contentHash) return false;
  const { signature, ...fields } = cosignature;
  return verifySignedMessage(cosignature.supervisorAddress, cosignatureMessage(fields), signature);
}

/* ═══════════════════════════════════════════════════════════════════
   Proxy re-encryption for doctor referrals (#248)
   ═══════════════════════════════════════════════════════════════════ */

const PRE_INFO = new TextEncoder().encode('heliora/pre-referral/v1');
const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;

export interface PreCiphertext {
  version: 1;
  iv: string;
  ciphertext: string;
  ownerCapsule: PreCapsule;
}

export interface PreCapsule {
  epk: JsonWebKey;
  wrappedDek: string;
}

export interface PreReencryptionKey {
  version: 1;
  ownerAddress: string;
  specialistAddress: string;
  specialistCapsule: PreCapsule;
}

export interface PreReencryptedCiphertext {
  version: 1;
  iv: string;
  ciphertext: string;
  specialistCapsule: PreCapsule;
  ownerAddress: string;
  specialistAddress: string;
}

function toB64(bytes: Uint8Array): string {
  let b = '';
  for (const x of bytes) b += String.fromCharCode(x);
  return btoa(b);
}

function fromB64(value: string): Uint8Array {
  const b = atob(value);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function importP256Public(jwk: JsonWebKey): Promise<CryptoKey> {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || jwk.d) {
    throw new Error('Invalid P-256 public key');
  }
  return crypto.subtle.importKey('jwk', jwk, P256, true, []);
}

async function deriveWrapKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  epk: CryptoKey,
  peer: CryptoKey,
): Promise<CryptoKey> {
  const [shared, epkRaw, peerRaw] = await Promise.all([
    crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256),
    crypto.subtle.exportKey('raw', epk),
    crypto.subtle.exportKey('raw', peer),
  ]);
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const info = new Uint8Array(PRE_INFO.length + epkRaw.byteLength + peerRaw.byteLength);
  info.set(PRE_INFO, 0);
  info.set(new Uint8Array(epkRaw), PRE_INFO.length);
  info.set(new Uint8Array(peerRaw), PRE_INFO.length + epkRaw.byteLength);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info },
    ikm,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function wrapDekForPublicKey(dek: CryptoKey, recipientPub: CryptoKey): Promise<PreCapsule> {
  const eph = await crypto.subtle.generateKey(P256, true, ['deriveBits']);
  const kek = await deriveWrapKey(eph.privateKey, recipientPub, eph.publicKey, recipientPub);
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, 'AES-KW');
  const epk = await crypto.subtle.exportKey('jwk', eph.publicKey);
  return {
    epk: { kty: epk.kty!, crv: epk.crv!, x: epk.x!, y: epk.y! },
    wrappedDek: toB64(new Uint8Array(wrapped)),
  };
}

async function unwrapDekWithPrivateKey(
  capsule: PreCapsule,
  recipientKeyPair: CryptoKeyPair,
): Promise<CryptoKey> {
  const epk = await importP256Public(capsule.epk);
  const kek = await deriveWrapKey(recipientKeyPair.privateKey, epk, epk, recipientKeyPair.publicKey);
  return crypto.subtle.unwrapKey(
    'raw',
    fromB64(capsule.wrappedDek),
    kek,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptForReferralOwner(
  plaintext: Uint8Array,
  ownerPublicKey: JsonWebKey,
): Promise<PreCiphertext> {
  const ownerPub = await importP256Public(ownerPublicKey);
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, plaintext);
  const ownerCapsule = await wrapDekForPublicKey(dek, ownerPub);
  return {
    version: 1,
    iv: toB64(iv),
    ciphertext: toB64(new Uint8Array(ciphertext)),
    ownerCapsule,
  };
}

export async function generateReferralReencryptionKey(params: {
  ownerAddress: string;
  ownerKeyPair: CryptoKeyPair;
  specialistAddress: string;
  specialistPublicKey: JsonWebKey;
  ownerCapsule: PreCapsule;
}): Promise<PreReencryptionKey> {
  const specialistPub = await importP256Public(params.specialistPublicKey);
  const dek = await unwrapDekWithPrivateKey(params.ownerCapsule, params.ownerKeyPair);
  const specialistCapsule = await wrapDekForPublicKey(dek, specialistPub);
  return {
    version: 1,
    ownerAddress: params.ownerAddress,
    specialistAddress: params.specialistAddress,
    specialistCapsule,
  };
}

export function proxyTransformReferralCiphertext(
  ciphertext: PreCiphertext,
  reencryptionKey: PreReencryptionKey,
): PreReencryptedCiphertext {
  if (reencryptionKey.version !== 1 || ciphertext.version !== 1) {
    throw new Error('Unsupported referral ciphertext version');
  }
  return {
    version: 1,
    iv: ciphertext.iv,
    ciphertext: ciphertext.ciphertext,
    specialistCapsule: reencryptionKey.specialistCapsule,
    ownerAddress: reencryptionKey.ownerAddress,
    specialistAddress: reencryptionKey.specialistAddress,
  };
}

export async function decryptReferredRecord(
  ciphertext: PreReencryptedCiphertext,
  specialistKeyPair: CryptoKeyPair,
): Promise<Uint8Array> {
  const dek = await unwrapDekWithPrivateKey(ciphertext.specialistCapsule, specialistKeyPair);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ciphertext.iv) },
    dek,
    fromB64(ciphertext.ciphertext),
  );
  return new Uint8Array(plaintext);
}
