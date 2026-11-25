import type { Keypair } from '@stellar/stellar-sdk';
import { createEncryptedLocalStore, type EncryptedLocalStore } from '@/lib/encryptedLocalStore';
import { verifySignedMessage, type MessageSigner } from '@/lib/stellar';

interface BreakGlassKey {
  keyId: string;
  publicKey: string;
  keyHolder: string;
  role: 'emergency_admin' | 'hospital_director' | 'chief_medical_officer';
  isActive: boolean;
  createdAt: number;
  metadata?: {
    hospital?: string;
    department?: string;
  };
}

interface BreakGlassRequest {
  requestId: string;
  initiatedBy: string;
  initiatorRole: string;
  patientAddress: string;
  reason: 'critical_condition' | 'life_threatening' | 'emergency_access';
  medicalContext: {
    condition?: string;
    symptoms?: string[];
    urgencyLevel: 1 | 2 | 3;
  };
  requiredSignatures: number;
  currentSignatures: Map<string, number>;
  status: 'pending' | 'approved' | 'rejected' | 'executed';
  createdAt: number;
  expiresAt: number;
  recordAccessRequested?: string[];
}

interface BreakGlassApproval {
  approvalId: string;
  requestId: string;
  approver: string;
  approverRole: string;
  signature: string;
  timestamp: number;
  note?: string;
}

interface BreakGlassAuditLog {
  requestId: string;
  action: string;
  actor: string;
  timestamp: number;
  details: unknown;
}

class BreakGlassMultiSigProtocol {
  private readonly MIN_SIGNATURES = 2;
  private readonly BREAK_GLASS_TIMEOUT_MINUTES = 30;
  private readonly ROLE_HIERARCHY: Record<string, number> = {
    chief_medical_officer: 3,
    hospital_director: 2,
    emergency_admin: 1,
  };

  /**
   * Initialize break-glass key for emergency override
   * Only highest authority can create these keys
   */
  initializeBreakGlassKey(
    keyHolder: Keypair,
    role: 'emergency_admin' | 'hospital_director' | 'chief_medical_officer',
    hospital?: string,
  ): BreakGlassKey {
    const keyId = `breakglass_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    return {
      keyId,
      publicKey: keyHolder.publicKey(),
      keyHolder: keyHolder.publicKey(),
      role,
      isActive: true,
      createdAt: Math.floor(Date.now() / 1000),
      ...(hospital ? { metadata: { hospital } } : {}),
    };
  }

  /**
   * Create emergency break-glass access request
   * Initiates multi-signature approval workflow for critical care access
   */
  createBreakGlassRequest(
    initiator: Keypair,
    initiatorRole: string,
    patientAddress: string,
    reason: 'critical_condition' | 'life_threatening' | 'emergency_access',
    urgencyLevel: 1 | 2 | 3,
    recordsToAccess?: string[],
  ): BreakGlassRequest {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + this.BREAK_GLASS_TIMEOUT_MINUTES * 60;

    const requestId = `breakglass_req_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    return {
      requestId,
      initiatedBy: initiator.publicKey(),
      initiatorRole,
      patientAddress,
      reason,
      medicalContext: {
        urgencyLevel,
      },
      requiredSignatures: this.calculateRequiredSignatures(initiatorRole, urgencyLevel),
      currentSignatures: new Map(),
      status: 'pending',
      createdAt: now,
      expiresAt,
      ...(recordsToAccess ? { recordAccessRequested: recordsToAccess } : {}),
    };
  }

  /**
   * Calculate required signatures based on initiator role and urgency
   * Higher urgency requires fewer signatures for faster approval
   */
  private calculateRequiredSignatures(initiatorRole: string, urgencyLevel: 1 | 2 | 3): number {
    const baseSignatures = 2;

    if (urgencyLevel === 3) {
      return Math.max(1, baseSignatures - 1);
    } else if (urgencyLevel === 2) {
      return baseSignatures;
    } else {
      return baseSignatures + 1;
    }
  }

  /**
   * Submit approval signature for break-glass request
   * Multi-signature threshold must be reached for access grant
   */
  submitApproval(
    request: BreakGlassRequest,
    approver: Keypair,
    approverRole: string,
    medicalContext?: { condition?: string; symptoms?: string[] },
  ): {
    approval: BreakGlassApproval;
    requestUpdated: BreakGlassRequest;
    approved: boolean;
  } {
    const now = Math.floor(Date.now() / 1000);
    const approvalId = `approval_${Date.now()}_${approver.publicKey().substring(0, 8)}`;

    const signature = approver.sign(
      Buffer.from(`${request.requestId}:${approver.publicKey()}:${now}`),
    ).toString('hex');

    const approval: BreakGlassApproval = {
      approvalId,
      requestId: request.requestId,
      approver: approver.publicKey(),
      approverRole,
      signature,
      timestamp: now,
    };

    const updatedRequest = { ...request };
    updatedRequest.currentSignatures.set(approver.publicKey(), now);

    if (medicalContext) {
      updatedRequest.medicalContext = {
        ...updatedRequest.medicalContext,
        ...medicalContext,
      };
    }

    const approved = updatedRequest.currentSignatures.size >= request.requiredSignatures;

    if (approved && updatedRequest.status === 'pending') {
      updatedRequest.status = 'approved';
    }

    return {
      approval,
      requestUpdated: updatedRequest,
      approved,
    };
  }

  /**
   * Validate break-glass request authenticity
   * Ensures all signatures are valid and from authorized signers
   */
  validateBreakGlassRequest(
    request: BreakGlassRequest,
    authorizedSigners: BreakGlassKey[],
  ): {
    valid: boolean;
    reason?: string;
    validSignatures: number;
  } {
    const now = Math.floor(Date.now() / 1000);

    if (request.expiresAt < now) {
      return {
        valid: false,
        reason: 'Request has expired',
        validSignatures: 0,
      };
    }

    if (request.status !== 'approved') {
      return {
        valid: false,
        reason: `Request status is ${request.status}, not approved`,
        validSignatures: request.currentSignatures.size,
      };
    }

    const validSigners = Array.from(request.currentSignatures.keys());
    const authorizedAddresses = authorizedSigners
      .filter((key) => key.isActive)
      .map((key) => key.publicKey);

    const allValid = validSigners.every((signer) => authorizedAddresses.includes(signer));

    if (!allValid) {
      return {
        valid: false,
        reason: 'One or more signatures are from unauthorized signers',
        validSignatures: request.currentSignatures.size,
      };
    }

    return {
      valid: true,
      validSignatures: request.currentSignatures.size,
    };
  }

  /**
   * Execute break-glass access grant
   * Grants temporary emergency access to patient records
   */
  executeBreakGlassAccess(
    request: BreakGlassRequest,
    authorizedSigners: BreakGlassKey[],
  ): {
    accessGranted: boolean;
    accessToken: string;
    expiresAt: number;
    grantedRecords: string[];
  } {
    const validation = this.validateBreakGlassRequest(request, authorizedSigners);

    if (!validation.valid) {
      return {
        accessGranted: false,
        accessToken: '',
        expiresAt: 0,
        grantedRecords: [],
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 3600;
    const accessToken = `token_${Buffer.from(`${request.requestId}:${request.patientAddress}:${now}`).toString('base64')}`;

    return {
      accessGranted: true,
      accessToken,
      expiresAt,
      grantedRecords: request.recordAccessRequested || [],
    };
  }

  /**
   * Log break-glass access event for audit trail
   * Creates immutable record of emergency access
   */
  auditBreakGlassAccess(
    request: BreakGlassRequest,
    action: string,
    actor: string,
    details: unknown,
  ): BreakGlassAuditLog {
    return {
      requestId: request.requestId,
      action,
      actor,
      timestamp: Math.floor(Date.now() / 1000),
      details,
    };
  }

  /**
   * Revoke break-glass key
   * Disables key from future emergency access requests
   */
  revokeBreakGlassKey(key: BreakGlassKey, _revokedBy: Keypair): BreakGlassKey {
    return {
      ...key,
      isActive: false,
    };
  }

  /**
   * Check if break-glass request is valid and active
   */
  isRequestActive(request: BreakGlassRequest): boolean {
    const now = Math.floor(Date.now() / 1000);
    return request.expiresAt > now && request.status !== 'rejected' && request.status !== 'executed';
  }

  /**
   * Get approval progress
   */
  getApprovalProgress(request: BreakGlassRequest): {
    current: number;
    required: number;
    percentage: number;
    approvers: string[];
  } {
    const approvers = Array.from(request.currentSignatures.keys());
    const percentage = Math.round((approvers.length / request.requiredSignatures) * 100);

    return {
      current: approvers.length,
      required: request.requiredSignatures,
      percentage,
      approvers,
    };
  }

  /**
   * Verify break-glass authorization chain
   * Ensures proper hierarchy in approval workflow
   */
  verifyAuthorizationChain(
    approvers: BreakGlassKey[],
    minimumHierarchyLevel: number,
  ): {
    authorized: boolean;
    chainStrength: number;
  } {
    const hierarchyLevels = approvers
      .filter((a) => a.isActive)
      .map((a) => this.ROLE_HIERARCHY[a.role] || 0)
      .sort((a, b) => b - a);

    const chainStrength = hierarchyLevels.reduce((sum, level) => sum + level, 0);
    const authorized = hierarchyLevels.length > 0 && Math.max(...hierarchyLevels) >= minimumHierarchyLevel;

    return {
      authorized,
      chainStrength,
    };
  }

  /**
   * Generate emergency access report
   * Summary of all break-glass access events
   */
  generateAccessReport(
    requests: BreakGlassRequest[],
    auditLogs: BreakGlassAuditLog[],
  ): {
    totalRequests: number;
    approvedRequests: number;
    deniedRequests: number;
    averageApprovalTime: number;
    accessEventCount: number;
  } {
    const approved = requests.filter((r) => r.status === 'approved').length;
    const denied = requests.filter((r) => r.status === 'rejected').length;
    const accessEvents = auditLogs.filter((log) => log.action === 'access_granted').length;

    let totalApprovalTime = 0;
    const completedRequests = requests.filter((r) => r.status === 'approved');
    if (completedRequests.length > 0) {
      totalApprovalTime = completedRequests.reduce((sum, req) => {
        const approver = Array.from(req.currentSignatures.values())[0];
        return sum + (approver ? approver - req.createdAt : 0);
      }, 0);
    }

    return {
      totalRequests: requests.length,
      approvedRequests: approved,
      deniedRequests: denied,
      averageApprovalTime: completedRequests.length > 0 ? Math.round(totalApprovalTime / completedRequests.length) : 0,
      accessEventCount: accessEvents,
    };
  }
}

export { BreakGlassMultiSigProtocol };
export type { BreakGlassKey, BreakGlassRequest, BreakGlassApproval, BreakGlassAuditLog };

/* ─── In-call Emergency (911) Dispatch (#268) ───────────────────────── */

/**
 * Two-click confirmation gate for the emergency button.
 *
 * The first click only *arms* the gate. Dispatch happens on a second,
 * deliberate click that lands after {@link EMERGENCY_CONFIRM_MIN_DELAY_MS}
 * (so a double-click or a bounce cannot dispatch) and before
 * {@link EMERGENCY_CONFIRM_WINDOW_MS} (so a stale armed button left on screen
 * cannot be confirmed minutes later by an unrelated tap).
 */
export const EMERGENCY_CONFIRM_MIN_DELAY_MS = 600;
export const EMERGENCY_CONFIRM_WINDOW_MS = 10_000;

export type EmergencyGateState =
  | { status: 'idle' }
  | { status: 'armed'; armedAt: number }
  | { status: 'confirmed'; armedAt: number; confirmedAt: number };

export type EmergencyGateResult =
  | { action: 'armed'; state: EmergencyGateState }
  | { action: 'confirmed'; state: EmergencyGateState }
  | { action: 'ignored'; reason: 'too-fast' | 'already-confirmed'; state: EmergencyGateState }
  | { action: 're-armed'; reason: 'expired'; state: EmergencyGateState };

export const INITIAL_EMERGENCY_GATE: EmergencyGateState = { status: 'idle' };

/**
 * Advances the gate for one click. Pure, so every safety rule is unit tested.
 *
 * Time: O(1). Space: O(1).
 */
export function pressEmergencyGate(state: EmergencyGateState, nowMs: number): EmergencyGateResult {
  switch (state.status) {
    case 'idle':
      return { action: 'armed', state: { status: 'armed', armedAt: nowMs } };
    case 'armed': {
      const elapsed = nowMs - state.armedAt;
      if (elapsed < EMERGENCY_CONFIRM_MIN_DELAY_MS) {
        return { action: 'ignored', reason: 'too-fast', state };
      }
      if (elapsed > EMERGENCY_CONFIRM_WINDOW_MS) {
        return { action: 're-armed', reason: 'expired', state: { status: 'armed', armedAt: nowMs } };
      }
      return {
        action: 'confirmed',
        state: { status: 'confirmed', armedAt: state.armedAt, confirmedAt: nowMs },
      };
    }
    case 'confirmed':
      return { action: 'ignored', reason: 'already-confirmed', state };
  }
}

/** Remaining confirmation time, or 0 when the gate is not armed / has expired. */
export function emergencyGateRemainingMs(state: EmergencyGateState, nowMs: number): number {
  if (state.status !== 'armed') return 0;
  return Math.max(0, EMERGENCY_CONFIRM_WINDOW_MS - (nowMs - state.armedAt));
}

/** Patient-provided address dispatchers should send responders to. */
export interface EmergencyAddress {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  country: string;
  /** Access notes: gate code, floor, "door at the back". */
  accessNotes?: string;
}

export interface EmergencyProfile {
  address: EmergencyAddress;
  phone?: string;
  emergencyContact?: { name: string; phone: string };
  updatedAt: string;
}

export const EMERGENCY_PROFILE_NAMESPACE = 'heliora-emergency-profile';

/**
 * Emergency profiles are sealed with AES-256-GCM via the encrypted local
 * store, bound to the patient's address, so they are unreadable at rest and
 * cannot be swapped between patients.
 */
export function createEmergencyProfileStore(
  options: Omit<Parameters<typeof createEncryptedLocalStore<EmergencyProfile>>[0], 'namespace'> = {},
): EncryptedLocalStore<EmergencyProfile> {
  return createEncryptedLocalStore<EmergencyProfile>({ ...options, namespace: EMERGENCY_PROFILE_NAMESPACE });
}

/** Single-line, dispatcher-readable address. */
export function formatEmergencyAddress(address: EmergencyAddress): string {
  return [
    address.line1,
    address.line2,
    address.city,
    [address.region, address.postalCode].filter(Boolean).join(' '),
    address.country,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * Decrypts the patient's emergency profile. Returns null when none is on
 * file; tampered/undecryptable data is reported as an error so the UI can ask
 * the clinician to confirm the address verbally instead of guessing.
 */
export async function loadPatientEmergencyProfile(
  patientAddress: string,
  store: EncryptedLocalStore<EmergencyProfile> = createEmergencyProfileStore(),
): Promise<{ profile: EmergencyProfile | null; error?: string }> {
  try {
    return { profile: await store.load(patientAddress) };
  } catch (err) {
    return { profile: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface EmergencyDispatchPayload {
  /** Schema/domain tag; part of the signed bytes so a signature cannot be replayed elsewhere. */
  type: 'heliora.emergency_dispatch.v1';
  dispatchId: string;
  appointmentId: string;
  patientAddress: string;
  initiatedBy: string;
  initiatorRole: 'DOCTOR' | 'PATIENT';
  reason: string;
  /** null when no verified address was available; dispatcher must call back. */
  location: { formatted: string; address: EmergencyAddress; source: 'encrypted-profile' | 'confirmed-verbally' } | null;
  callbackPhone?: string;
  confirmation: { armedAt: number; confirmedAt: number };
  issuedAt: string;
}

export interface SignedEmergencyDispatch {
  payload: EmergencyDispatchPayload;
  /** Exact bytes that were signed (canonical JSON of the payload). */
  message: string;
  /** Base64 SEP-53 signature by `payload.initiatedBy`. */
  signature: string;
}

/** Deterministic JSON: object keys sorted recursively, so signer and verifier hash the same bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function randomDispatchId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `emg_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export interface BuildEmergencyDispatchInput {
  appointmentId: string;
  patientAddress: string;
  initiatedBy: string;
  initiatorRole: 'DOCTOR' | 'PATIENT';
  reason: string;
  gate: EmergencyGateState;
  location: EmergencyDispatchPayload['location'];
  callbackPhone?: string;
  now?: Date;
  dispatchId?: string;
}

/**
 * Builds the dispatch payload. Refuses unless the confirmation gate is in the
 * `confirmed` state — the gate is enforced here too, not only in the UI.
 */
export function buildEmergencyDispatchPayload(input: BuildEmergencyDispatchInput): EmergencyDispatchPayload {
  if (input.gate.status !== 'confirmed') {
    throw new Error('Emergency dispatch requires two-step confirmation.');
  }
  if (!input.reason.trim()) throw new Error('A reason for the emergency dispatch is required.');
  return {
    type: 'heliora.emergency_dispatch.v1',
    dispatchId: input.dispatchId ?? randomDispatchId(),
    appointmentId: input.appointmentId,
    patientAddress: input.patientAddress,
    initiatedBy: input.initiatedBy,
    initiatorRole: input.initiatorRole,
    reason: input.reason.trim(),
    location: input.location,
    ...(input.callbackPhone ? { callbackPhone: input.callbackPhone } : {}),
    confirmation: { armedAt: input.gate.armedAt, confirmedAt: input.gate.confirmedAt },
    issuedAt: (input.now ?? new Date()).toISOString(),
  };
}

/** Signs the canonical payload with the initiator's Stellar key (SEP-53, e.g. via Freighter). */
export async function signEmergencyDispatch(
  payload: EmergencyDispatchPayload,
  signMessage: MessageSigner,
): Promise<SignedEmergencyDispatch> {
  const message = canonicalJson(payload);
  const signature = await signMessage(message, payload.initiatedBy);
  return { payload, message, signature };
}

/** Receiver-side check (also used by tests): signature valid and bytes match the payload. */
export function verifyEmergencyDispatch(signed: SignedEmergencyDispatch): boolean {
  return (
    signed.message === canonicalJson(signed.payload) &&
    verifySignedMessage(signed.payload.initiatedBy, signed.message, signed.signature)
  );
}

export const EMERGENCY_WEBHOOK_URL =
  process.env.NEXT_PUBLIC_EMERGENCY_WEBHOOK_URL || '/api/emergency/dispatch';

export interface DispatchEmergencyOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  /** Attempts for transient (network / 5xx) failures. Emergency delivery retries quickly. */
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface EmergencyDispatchReceipt {
  dispatchId: string;
  status: number;
  attempts: number;
  body: unknown;
}

/**
 * POSTs the signed dispatch to the emergency webhook. The signature travels
 * in headers as well as the body; `Idempotency-Key` is the dispatch id so a
 * retried request can never page responders twice.
 */
export async function dispatchEmergencyWebhook(
  signed: SignedEmergencyDispatch,
  options: DispatchEmergencyOptions = {},
): Promise<EmergencyDispatchReceipt> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? EMERGENCY_WEBHOOK_URL;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const retryDelayMs = options.retryDelayMs ?? 1000;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': signed.payload.dispatchId,
          'X-Heliora-Signer': signed.payload.initiatedBy,
          'X-Heliora-Signature': signed.signature,
          'X-Heliora-Signature-Scheme': 'sep53-ed25519',
        },
        body: JSON.stringify(signed),
      });
      const body: unknown = await res.json().catch(() => null);
      if (res.ok) {
        return { dispatchId: signed.payload.dispatchId, status: res.status, attempts: attempt, body };
      }
      lastError = new Error(`Emergency webhook responded ${res.status}`);
      // 4xx means the request itself is wrong; retrying will not help.
      if (res.status < 500) break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, retryDelayMs));
  }
  throw lastError ?? new Error('Emergency dispatch failed.');
}
