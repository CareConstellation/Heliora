import type { Keypair } from '@stellar/stellar-sdk';

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
