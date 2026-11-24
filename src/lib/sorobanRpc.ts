import { xdr, Operation, rpc } from '@stellar/stellar-sdk';
import * as Sentry from '@sentry/nextjs';
import {
  SorobanContractErrorCode,
  type SorobanContractErrorName,
  type DecodedContractError,
} from '@/types';

export { SorobanContractErrorCode };

/**
 * Client-side Soroban RPC simulation and resource estimation.
 * Enables local transaction simulation without submitting to the network.
 * (Issue #1)
 */

export interface ResourceEstimate {
  cpuInstructions: number;
  memoryBytes: number;
  estimatedFee: string; // in stroops
  estimatedExecutionTime: number; // in milliseconds
  readOps: number;
  writeOps: number;
}

export interface SimulationResult {
  success: boolean;
  result?: string;
  error?: string;
  resources: ResourceEstimate;
}

const CPU_COST_PER_INSTRUCTION = 1; // stroops
const MEMORY_COST_PER_BYTE = 1; // stroops / byte
const BASE_OPERATION_COST = 100; // stroops
const READ_OP_COST = 10; // stroops
const WRITE_OP_COST = 50; // stroops

/**
 * Simulates a Soroban contract invocation and estimates resource requirements.
 * Does not submit to the network; purely local estimation.
 */
export async function simulateSorobanInvocation(
  contractId: string,
  method: string,
  args: unknown[],
  _sourcePublicKey: string,
): Promise<SimulationResult> {
  try {
    // Estimate CPU instructions based on method complexity
    const cpuInstructions = estimateCPUInstructions(method, args);
    
    // Estimate memory footprint
    const memoryBytes = estimateMemoryUsage(args);
    
    // Calculate derived metrics
    const readOps = estimateReadOps(method);
    const writeOps = estimateWriteOps(method);
    
    const estimate = calculateResourceCost(cpuInstructions, memoryBytes, readOps, writeOps);
    
    // Simulate successful execution
    return {
      success: true,
      result: `Simulated invocation of ${method} on ${contractId}`,
      resources: estimate,
    };
  } catch (error) {
    return {
      success: false,
      error: `Simulation failed: ${error instanceof Error ? error.message : String(error)}`,
      resources: {
        cpuInstructions: 0,
        memoryBytes: 0,
        estimatedFee: '0',
        estimatedExecutionTime: 0,
        readOps: 0,
        writeOps: 0,
      },
    };
  }
}

/**
 * Estimates CPU instructions required for a given method.
 * Based on method name and argument complexity.
 */
function estimateCPUInstructions(method: string, args: unknown[]): number {
  const baseCost = 1000; // baseline CPU cost per invocation
  const argComplexity = args.reduce<number>((sum, arg) => {
    if (arg === null || arg === undefined) return sum + 10;
    if (typeof arg === 'string') return sum + arg.length * 2;
    if (typeof arg === 'object') return sum + JSON.stringify(arg).length;
    return sum + 50;
  }, 0);
  
  // Methods with "revoke" or "delegat" are more expensive
  const methodMultiplier = (method.toLowerCase().includes('revoke') || 
                           method.toLowerCase().includes('delegat')) ? 1.5 : 1;
  
  return Math.ceil((baseCost + argComplexity) * methodMultiplier);
}

/**
 * Estimates memory bytes needed for transaction execution.
 */
function estimateMemoryUsage(args: unknown[]): number {
  let totalBytes = 512; // baseline memory overhead
  
  args.forEach(arg => {
    if (typeof arg === 'string') {
      totalBytes += arg.length;
    } else if (typeof arg === 'object' && arg !== null) {
      totalBytes += JSON.stringify(arg).length;
    } else {
      totalBytes += 32; // baseline for primitives
    }
  });
  
  return totalBytes;
}

/**
 * Estimates number of read operations for a given method.
 */
function estimateReadOps(method: string): number {
  const methodLower = method.toLowerCase();
  
  if (methodLower.includes('get') || methodLower.includes('check') || methodLower.includes('query')) {
    return 2;
  }
  if (methodLower.includes('verify')) {
    return 3;
  }
  return 1; // most methods do at least one read
}

/**
 * Estimates number of write operations for a given method.
 */
function estimateWriteOps(method: string): number {
  const methodLower = method.toLowerCase();
  
  if (methodLower.includes('create') || methodLower.includes('init')) {
    return 2;
  }
  if (methodLower.includes('update') || methodLower.includes('set')) {
    return 1;
  }
  if (methodLower.includes('delete') || methodLower.includes('revoke')) {
    return 1;
  }
  return 0; // read-only methods
}

/**
 * Calculates total resource cost in stroops from individual components.
 */
function calculateResourceCost(
  cpuInstructions: number,
  memoryBytes: number,
  readOps: number,
  writeOps: number,
): ResourceEstimate {
  const cpuCost = cpuInstructions * CPU_COST_PER_INSTRUCTION;
  const memoryCost = memoryBytes * MEMORY_COST_PER_BYTE;
  const opsCost = readOps * READ_OP_COST + writeOps * WRITE_OP_COST;
  
  const totalCost = BASE_OPERATION_COST + cpuCost + memoryCost + opsCost;
  const estimatedExecutionTime = Math.ceil(cpuInstructions / 1000); // rough estimate: ~1ms per 1000 instructions
  
  return {
    cpuInstructions,
    memoryBytes,
    estimatedFee: totalCost.toString(),
    estimatedExecutionTime,
    readOps,
    writeOps,
  };
}

/**
 * Formats resource estimate for user display.
 */
export function formatResourceEstimate(estimate: ResourceEstimate): string {
  const feeXlm = (BigInt(estimate.estimatedFee) / BigInt(10_000_000)).toString();
  
  return `Estimated Cost: ${feeXlm} XLM | CPU: ${estimate.cpuInstructions} | Memory: ${estimate.memoryBytes}B | Time: ~${estimate.estimatedExecutionTime}ms`;
}

/* ─── Soroban Contract Error Decoding (#191) ─────────────────────── */

/**
 * Mapping between on-chain contract error codes and domain error names.
 * Accommodates both standard enum values and small sequential error codes.
 */
export const CONTRACT_ERROR_NAME_MAP: Record<number, SorobanContractErrorName> = {
  1: 'UnauthorizedDoctor',
  2: 'ExpiredLicense',
  3: 'DoctorNotRegistered',
  4: 'RecordNotFound',
  5: 'AccessDenied',
  6: 'InvalidRole',
  7: 'ConsentRequired',
  8: 'AppointmentNotFound',
  9: 'InvalidEscrowState',
  10: 'DisputeAlreadyActive',
  11: 'SlotUnavailable',
  12: 'InsufficientPermissions',
  1001: 'UnauthorizedDoctor',
  1002: 'ExpiredLicense',
  1003: 'DoctorNotRegistered',
  1004: 'RecordNotFound',
  1005: 'AccessDenied',
  1006: 'InvalidRole',
  1007: 'ConsentRequired',
  1008: 'AppointmentNotFound',
  1009: 'InvalidEscrowState',
  1010: 'DisputeAlreadyActive',
  1011: 'SlotUnavailable',
  1012: 'InsufficientPermissions',
};

/**
 * Localized human-friendly strings for contract error enums.
 */
export const CONTRACT_ERROR_MESSAGES: Record<string, Record<string, string>> = {
  en: {
    UnauthorizedDoctor: 'Doctor is unauthorized to perform this clinical operation on-chain.',
    ExpiredLicense: 'Doctor medical license has expired or has been revoked.',
    DoctorNotRegistered: 'Doctor is not registered in the healthcare provider directory.',
    RecordNotFound: 'The requested medical record was not found on-chain.',
    AccessDenied: 'Access to this health record or resource is denied.',
    InvalidRole: 'Account does not possess the required role for this action.',
    ConsentRequired: 'Explicit patient consent receipt is required to access or share this record.',
    AppointmentNotFound: 'The specified appointment was not found.',
    InvalidEscrowState: 'Consultation escrow is in an invalid state for this operation.',
    DisputeAlreadyActive: 'A dispute has already been filed for this consultation.',
    SlotUnavailable: 'The selected appointment slot is no longer available.',
    InsufficientPermissions: 'Insufficient permissions to perform this operation.',
    UnknownContractError: 'An unrecognized contract error occurred during simulation.',
  },
  es: {
    UnauthorizedDoctor: 'El médico no está autorizado para realizar esta operación clínica en la cadena.',
    ExpiredLicense: 'La licencia médica del profesional ha expirado o ha sido revocada.',
    DoctorNotRegistered: 'El médico no está registrado en el directorio de proveedores de salud.',
    RecordNotFound: 'El registro médico solicitado no fue encontrado en la cadena.',
    AccessDenied: 'El acceso a este historial médico o recurso ha sido denegado.',
    InvalidRole: 'La cuenta no posee el rol requerido para esta acción.',
    ConsentRequired: 'Se requiere el recibo de consentimiento explícito del paciente para esta acción.',
    AppointmentNotFound: 'No se encontró la cita especificada.',
    InvalidEscrowState: 'El depósito en garantía se encuentra en un estado inválido para esta operación.',
    DisputeAlreadyActive: 'Ya se ha presentado una disputa para esta consulta.',
    SlotUnavailable: 'El horario de la cita seleccionado ya no está disponible.',
    InsufficientPermissions: 'Permisos insuficientes para realizar esta operación.',
    UnknownContractError: 'Ocurrió un error de contrato no reconocido durante la simulación.',
  },
  fr: {
    UnauthorizedDoctor: 'Le médecin n\'est pas autorisé à effectuer cette opération clinique sur la blockchain.',
    ExpiredLicense: 'La licence médicale du professionnel a expiré ou a été révoquée.',
    DoctorNotRegistered: 'Le médecin n\'est pas enregistré dans l\'annuaire des professionnels de santé.',
    RecordNotFound: 'Le dossier médical demandé est introuvable sur la blockchain.',
    AccessDenied: 'L\'accès à ce dossier médical ou à cette ressource est refusé.',
    InvalidRole: 'Le compte ne dispose pas du rôle requis pour cette action.',
    ConsentRequired: 'Un reçu de consentement explicite du patient est requis pour cette action.',
    AppointmentNotFound: 'Le rendez-vous spécifié est introuvable.',
    InvalidEscrowState: 'Le séquestre de consultation est dans un état non valide pour cette opération.',
    DisputeAlreadyActive: 'Un litige a déjà été ouvert pour cette consultation.',
    SlotUnavailable: 'Le créneau de rendez-vous sélectionné n\'est plus disponible.',
    InsufficientPermissions: 'Autorisations insuffisantes pour effectuer cette opération.',
    UnknownContractError: 'Une erreur de contrat non reconnue s\'est produite lors de la simulation.',
  },
};

/**
 * Extracts numeric contract code from an ScVal if it represents an ScErrorContract.
 */
function extractCodeFromScVal(scVal: xdr.ScVal): number | null {
  try {
    if (scVal.switch().name === 'scvError') {
      const err = scVal.error();
      if (err.switch().name === 'sceContract') {
        return err.contractCode();
      }
    }
  } catch {
    // Non-fatal: value is not an ScError
  }
  return null;
}

/**
 * Parses DiagnosticEvent or ContractEvent XDR to locate ScErrorContract code.
 */
function extractCodeFromDiagnosticEvent(rawEvent: string): number | null {
  // 1. Try xdr.DiagnosticEvent
  try {
    const diag = xdr.DiagnosticEvent.fromXDR(rawEvent, 'base64');
    const evt = diag.event();
    const body = evt.body().value() as any;
    if (body) {
      if (typeof body.topics === 'function') {
        const topics = body.topics() as xdr.ScVal[];
        for (const topic of topics) {
          const code = extractCodeFromScVal(topic);
          if (code !== null) return code;
        }
      }
      if (typeof body.data === 'function') {
        const data = body.data() as xdr.ScVal;
        const code = extractCodeFromScVal(data);
        if (code !== null) return code;
      }
    }
  } catch {
    // Non-fatal: try next parsing shape
  }

  // 2. Try direct xdr.ContractEvent
  try {
    const evt = xdr.ContractEvent.fromXDR(rawEvent, 'base64');
    const body = evt.body().value() as any;
    if (body) {
      if (typeof body.topics === 'function') {
        const topics = body.topics() as xdr.ScVal[];
        for (const topic of topics) {
          const code = extractCodeFromScVal(topic);
          if (code !== null) return code;
        }
      }
      if (typeof body.data === 'function') {
        const data = body.data() as xdr.ScVal;
        const code = extractCodeFromScVal(data);
        if (code !== null) return code;
      }
    }
  } catch {
    // Non-fatal: try direct ScVal
  }

  // 3. Try direct xdr.ScVal
  try {
    const scVal = xdr.ScVal.fromXDR(rawEvent, 'base64');
    const code = extractCodeFromScVal(scVal);
    if (code !== null) return code;
  } catch {
    // Ignore invalid XDR
  }

  return null;
}

/**
 * Extracts ScErrorContract code from a Soroban simulation response.
 * Inspects results XDR, diagnostic events, and simulation error strings.
 */
export function extractContractErrorCode(simulation: unknown): number | null {
  if (!simulation || typeof simulation !== 'object') return null;
  const sim = simulation as Record<string, unknown>;

  // 1. Check results array for ScVal error
  if (Array.isArray(sim.results) && sim.results.length > 0) {
    for (const res of sim.results) {
      if (res && typeof res === 'object') {
        const xdrStr = (res as Record<string, unknown>).xdr;
        if (typeof xdrStr === 'string' && xdrStr) {
          try {
            const scVal = xdr.ScVal.fromXDR(xdrStr, 'base64');
            const code = extractCodeFromScVal(scVal);
            if (code !== null) return code;
          } catch {
            // Ignore non-ScVal
          }
        }
        const retVal = (res as Record<string, unknown>).retval;
        if (retVal && typeof (retVal as any).switch === 'function') {
          const code = extractCodeFromScVal(retVal as xdr.ScVal);
          if (code !== null) return code;
        }
      }
    }
  }

  // 2. Check diagnostic events XDR array
  const events = Array.isArray(sim.diagnosticEventsXdr)
    ? sim.diagnosticEventsXdr
    : Array.isArray(sim.events)
      ? sim.events
      : [];

  for (const ev of events) {
    if (typeof ev === 'string' && ev) {
      const code = extractCodeFromDiagnosticEvent(ev);
      if (code !== null) return code;
    } else if (ev && typeof ev === 'object') {
      try {
        const anyEv = ev as Record<string, unknown>;
        const eventObj = (anyEv.event || anyEv) as Record<string, unknown>;
        const body = (eventObj.body as any)?.value?.();
        if (body?.topics) {
          for (const t of body.topics()) {
            const code = extractCodeFromScVal(t);
            if (code !== null) return code;
          }
        }
        if (body?.data) {
          const code = extractCodeFromScVal(body.data());
          if (code !== null) return code;
        }
      } catch {
        // Ignore unparseable event object
      }
    }
  }

  // 3. Fallback regex inspection from error text
  const errorText = typeof sim.error === 'string' ? sim.error : '';
  if (errorText) {
    const patterns = [
      /Error\(Contract,\s*#?(\d+)\)/i,
      /ScErrorContract\((\d+)\)/i,
      /contract error\s*#?(\d+)/i,
      /contract_code:?\s*#?(\d+)/i,
    ];
    for (const pattern of patterns) {
      const match = errorText.match(pattern);
      if (match && match[1]) {
        const parsed = parseInt(match[1], 10);
        if (!isNaN(parsed)) return parsed;
      }
    }
  }

  return null;
}

/**
 * Resolves localized message for a contract error code and name.
 */
export function getContractErrorMessage(
  codeOrName: number | SorobanContractErrorName | string,
  locale = 'en',
): string {
  const langMessages = CONTRACT_ERROR_MESSAGES[locale] || CONTRACT_ERROR_MESSAGES.en;
  let errorName: string;

  if (typeof codeOrName === 'number') {
    errorName = CONTRACT_ERROR_NAME_MAP[codeOrName] || `UnknownContractError_${codeOrName}`;
  } else {
    errorName = codeOrName;
  }

  return (
    langMessages[errorName] ||
    CONTRACT_ERROR_MESSAGES.en[errorName] ||
    `${langMessages.UnknownContractError || 'Contract error'} (#${codeOrName})`
  );
}

/**
 * Custom Error class representing a decoded Soroban contract error.
 */
export class SorobanContractError extends Error {
  public readonly code: number;
  public readonly errorName: string;
  public readonly contractId?: string;
  public readonly rawError?: string;

  constructor(decoded: DecodedContractError) {
    super(decoded.message);
    this.name = 'SorobanContractError';
    this.code = decoded.code;
    this.errorName = decoded.name;
    this.contractId = decoded.contractId;
    this.rawError = decoded.rawError;
    Object.setPrototypeOf(this, SorobanContractError.prototype);
  }
}

/**
 * Records contract error details as a Sentry breadcrumb.
 */
export function recordContractErrorBreadcrumb(decoded: DecodedContractError): void {
  Sentry.addBreadcrumb({
    category: 'soroban.contract_error',
    level: 'error',
    message: `Contract error: ${decoded.name} (#${decoded.code}) - ${decoded.message}`,
    data: {
      code: decoded.code,
      name: decoded.name,
      contractId: decoded.contractId,
      rawError: decoded.rawError,
    },
  });
}

/**
 * Decodes a Soroban RPC simulation response into a typed contract error descriptor.
 * If a contract error is present, extracts the code, maps it to localized strings,
 * and records a Sentry breadcrumb.
 */
export function decodeSimulationError(
  simulation: unknown,
  locale = 'en',
  options: { recordBreadcrumb?: boolean; contractId?: string } = { recordBreadcrumb: true },
): DecodedContractError | null {
  const code = extractContractErrorCode(simulation);
  if (code === null) return null;

  const name = CONTRACT_ERROR_NAME_MAP[code] || `UnknownContractError_${code}`;
  const message = getContractErrorMessage(code, locale);
  const rawError =
    simulation && typeof simulation === 'object' && typeof (simulation as any).error === 'string'
      ? (simulation as any).error
      : undefined;

  const decoded: DecodedContractError = {
    code,
    name,
    message,
    rawError,
    contractId: options.contractId,
  };

  if (options.recordBreadcrumb !== false) {
    recordContractErrorBreadcrumb(decoded);
  }

  return decoded;
}

/* ─── Soroban State Archival & TTL Extension (#186) ──────────────── */

/**
 * Minimum remaining ledgers before a storage entry requires proactive TTL extension.
 * When liveUntilLedger - currentLedger < 50,000, extension is triggered.
 */
export const TTL_EXTENSION_THRESHOLD_LEDGERS = 50_000;

/** Default number of ledgers to extend footprint TTL to past current ledger. */
export const DEFAULT_EXTEND_TO_LEDGERS = 100_000;

export interface LedgerEntryTtlInfo {
  key: string;
  liveUntilLedgerSeq?: number;
  lastModifiedLedgerSeq?: number;
  remainingLedgers: number;
  isArchived: boolean;
  needsExtension: boolean;
}

/**
 * Checks whether a ledger entry is archived (expired or missing liveUntilLedgerSeq past current ledger).
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function isEntryArchived(
  entry: { liveUntilLedgerSeq?: number; liveUntilLedger?: number } | null | undefined,
  currentLedger: number,
): boolean {
  if (!entry) {
    return true;
  }
  const liveUntil = entry.liveUntilLedgerSeq ?? entry.liveUntilLedger;
  if (typeof liveUntil !== 'number') {
    return true;
  }
  return liveUntil <= currentLedger;
}

/**
 * Calculates remaining active ledgers for a ledger entry. Returns 0 if expired or archived.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function getRemainingLedgers(
  entry: { liveUntilLedgerSeq?: number; liveUntilLedger?: number } | null | undefined,
  currentLedger: number,
): number {
  if (!entry) {
    return 0;
  }
  const liveUntil = entry.liveUntilLedgerSeq ?? entry.liveUntilLedger;
  if (typeof liveUntil !== 'number') {
    return 0;
  }
  return Math.max(0, liveUntil - currentLedger);
}

/**
 * Evaluates whether an entry requires proactive TTL extension (< 50,000 remaining ledgers).
 * An entry already archived (0 remaining ledgers) requires restoration instead of extension.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function needsTtlExtension(
  entry: { liveUntilLedgerSeq?: number; liveUntilLedger?: number } | null | undefined,
  currentLedger: number,
  threshold: number = TTL_EXTENSION_THRESHOLD_LEDGERS,
): boolean {
  if (isEntryArchived(entry, currentLedger)) {
    return false;
  }
  const remaining = getRemainingLedgers(entry, currentLedger);
  return remaining < threshold;
}

/**
 * Queries getLedgerEntries on Soroban RPC to fetch entry status and liveUntilLedger sequences.
 * Time Complexity: O(N) where N is the number of keys.
 * Space Complexity: O(N) for returned entries.
 */
export async function fetchLedgerEntriesWithTtl(
  serverOrUrl: rpc.Server | string,
  keys: (string | xdr.LedgerKey)[],
): Promise<{
  latestLedger: number;
  entries: LedgerEntryTtlInfo[];
}> {
  const server = typeof serverOrUrl === 'string' ? new rpc.Server(serverOrUrl) : serverOrUrl;
  const ledgerKeys = keys.map((k) =>
    typeof k === 'string' ? xdr.LedgerKey.fromXDR(k, 'base64') : k,
  );

  const response = await server.getLedgerEntries(...ledgerKeys);
  const latestLedger = response.latestLedger;
  const responseEntries = response.entries || [];

  const entries: LedgerEntryTtlInfo[] = responseEntries.map((resEntry) => {
    const keyStr = typeof resEntry.key === 'string' ? resEntry.key : (resEntry.key as any).toXDR('base64');
    const liveUntil = resEntry.liveUntilLedgerSeq;
    const lastModified = resEntry.lastModifiedLedgerSeq;
    const archived = isEntryArchived({ liveUntilLedgerSeq: liveUntil }, latestLedger);
    const needsExt = needsTtlExtension({ liveUntilLedgerSeq: liveUntil }, latestLedger);
    const remaining = getRemainingLedgers({ liveUntilLedgerSeq: liveUntil }, latestLedger);

    return {
      key: keyStr,
      liveUntilLedgerSeq: liveUntil,
      lastModifiedLedgerSeq: lastModified,
      remainingLedgers: remaining,
      isArchived: archived,
      needsExtension: needsExt,
    };
  });

  return {
    latestLedger,
    entries,
  };
}

/**
 * Builds an extendFootprintTtl Soroban operation.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function buildExtendFootprintTtlOp(extendTo: number = DEFAULT_EXTEND_TO_LEDGERS) {
  return Operation.extendFootprintTtl({ extendTo });
}

/**
 * Builds a restoreFootprint Soroban operation.
 * Time Complexity: O(1)
 * Space Complexity: O(1)
 */
export function buildRestoreFootprintOp() {
  return Operation.restoreFootprint({});
}


