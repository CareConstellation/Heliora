import { Contract, nativeToScVal } from '@stellar/stellar-sdk';
import { invokeSorobanContract, type TransactionSigner } from '@/lib/stellar';
import { invalidateRoleCache } from '@/lib/sorobanRbac';
import type {
  RejectionReasonCode,
  RoleVerificationApplication,
  RoleVerificationDecisionPayload,
  VerifiableRole,
} from '@/types';

const ACCESS_CONTROL_CONTRACT_ID = process.env.NEXT_PUBLIC_ACCESS_CONTROL_CONTRACT_ID ?? '';

export interface RejectionReason {
  code: RejectionReasonCode;
  label: string;
  /** Sentence included in the applicant's notification email. */
  applicantMessage: string;
}

/**
 * Standardized rejection reasons. The `code` is what the backend stores and uses to
 * pick the email template; admins cannot reject without choosing one.
 */
export const REJECTION_REASONS: readonly RejectionReason[] = [
  {
    code: 'LICENSE_UNVERIFIABLE',
    label: 'License could not be verified with the issuing board',
    applicantMessage: 'We could not verify your license with the issuing authority.',
  },
  {
    code: 'LICENSE_EXPIRED',
    label: 'License or registration is expired',
    applicantMessage: 'The license or registration you provided has expired.',
  },
  {
    code: 'DOCUMENT_ILLEGIBLE',
    label: 'Uploaded document is illegible or corrupted',
    applicantMessage: 'Your uploaded document could not be read. Please upload a clear copy.',
  },
  {
    code: 'NAME_MISMATCH',
    label: 'Name on credential does not match the applicant',
    applicantMessage: 'The name on your credential does not match your application.',
  },
  {
    code: 'JURISDICTION_UNSUPPORTED',
    label: 'Jurisdiction is not supported',
    applicantMessage: 'Heliora does not yet support practitioners from your jurisdiction.',
  },
  {
    code: 'INCOMPLETE_SUBMISSION',
    label: 'Required documents are missing',
    applicantMessage: 'Your application is missing required documents.',
  },
  {
    code: 'SUSPECTED_FRAUD',
    label: 'Suspected fraudulent or altered document',
    applicantMessage: 'Your application could not be approved. Contact support for details.',
  },
  {
    code: 'OTHER',
    label: 'Other (explain in note)',
    applicantMessage: 'Your application could not be approved.',
  },
] as const;

export const MIN_OTHER_NOTE_LENGTH = 10;
export const MAX_NOTE_LENGTH = 500;

export function getRejectionReason(code: RejectionReasonCode): RejectionReason | undefined {
  return REJECTION_REASONS.find((reason) => reason.code === code);
}

/**
 * Validates a rejection before it is sent. A standardized reason is mandatory;
 * `OTHER` also requires an explanatory note.
 * @returns An error message, or `null` if the rejection is valid.
 */
export function validateRejection(
  reasonCode: RejectionReasonCode | '' | null | undefined,
  note = '',
): string | null {
  if (!reasonCode) return 'Choose a rejection reason.';
  if (!getRejectionReason(reasonCode)) return 'Unknown rejection reason.';
  if (note.length > MAX_NOTE_LENGTH) return `Notes are limited to ${MAX_NOTE_LENGTH} characters.`;
  if (reasonCode === 'OTHER' && note.trim().length < MIN_OTHER_NOTE_LENGTH) {
    return `Explain the reason (at least ${MIN_OTHER_NOTE_LENGTH} characters).`;
  }
  return null;
}

export function buildRejectionPayload(
  reviewerAddress: string,
  reasonCode: RejectionReasonCode,
  note: string,
): RoleVerificationDecisionPayload {
  const trimmed = note.trim();
  return {
    decision: 'rejected',
    reasonCode,
    reviewerAddress,
    ...(trimmed ? { note: trimmed } : {}),
  };
}

/** Days until the license expires (negative once expired), or `null` if unknown. */
export function daysUntilLicenseExpiry(
  application: Pick<RoleVerificationApplication, 'licenseExpiresAt'>,
  now = new Date(),
): number | null {
  if (!application.licenseExpiresAt) return null;
  const expires = new Date(application.licenseExpiresAt).getTime();
  if (Number.isNaN(expires)) return null;
  return Math.floor((expires - now.getTime()) / 86_400_000);
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/**
 * Checks that a downloaded credential really is a PDF (by magic bytes, not just
 * the declared MIME type) before it is rendered in the reviewer's viewer.
 */
export async function isPdfBlob(blob: Blob): Promise<boolean> {
  if (blob.size < PDF_MAGIC.length) return false;
  const head = new Uint8Array(await readBlobPrefix(blob, PDF_MAGIC.length));
  return PDF_MAGIC.every((byte, i) => head[i] === byte);
}

async function readBlobPrefix(blob: Blob, length: number): Promise<ArrayBuffer> {
  const slice = blob.slice(0, length);
  if (typeof slice.arrayBuffer === 'function') return slice.arrayBuffer();
  // jsdom and older browsers lack Blob#arrayBuffer.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(slice);
  });
}

/** Builds the `grant_role(admin, account, role)` call on the access control contract. */
export function buildGrantRoleOperation(
  adminAddress: string,
  applicantAddress: string,
  role: VerifiableRole,
) {
  if (!ACCESS_CONTROL_CONTRACT_ID) {
    throw new Error('NEXT_PUBLIC_ACCESS_CONTROL_CONTRACT_ID is not configured.');
  }
  return new Contract(ACCESS_CONTROL_CONTRACT_ID).call(
    'grant_role',
    nativeToScVal(adminAddress, { type: 'address' }),
    nativeToScVal(applicantAddress, { type: 'address' }),
    nativeToScVal(role, { type: 'symbol' }),
  );
}

/**
 * Signs and submits the on-chain role grant with the admin's wallet. The contract
 * requires the admin's authorization, so the admin is also the transaction source.
 * @returns The confirmed transaction hash, which the backend stores with the decision.
 */
export async function grantRoleOnChain(
  adminAddress: string,
  applicantAddress: string,
  role: VerifiableRole,
  signer: TransactionSigner,
): Promise<string> {
  const operation = buildGrantRoleOperation(adminAddress, applicantAddress, role);
  const txHash = await invokeSorobanContract(adminAddress, operation, signer, 'soroban.grant_role');
  // The applicant's cached "no role" answer is now stale.
  invalidateRoleCache(applicantAddress);
  return txHash;
}
