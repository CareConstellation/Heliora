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
