export type UserRole = 'PATIENT' | 'DOCTOR' | 'HOSPITAL' | 'ADMIN';

export interface User {
  id: string;
  address: string;
  role: UserRole;
  name: string;
}

export interface MedicalRecord {
  id: string;
  date: string;
  doctorName: string;
  diagnosis: string;
  prescription?: string;
  notes?: string;
  patientAddress: string;
  /** Specialty of the treating provider, used as a search facet. */
  providerSpecialty?: string;
  /** Record classification (e.g. "lab", "imaging"), used as a search facet. */
  classification?: string;
  /** Standard code for the diagnosis, when the doctor picked one. */
  diagnosisCode?: DiagnosisCode;
  /** URL of a `.dcm` imaging study attached to this record. */
  dicomUrl?: string;
}

/** Standard diagnostic code, stored next to the human-readable diagnosis. */
export interface DiagnosisCode {
  code: string;
  system: 'ICD-10-CM' | 'SNOMED-CT';
  display: string;
}

/** Verified subsidy tier returned by the backend / contract for a patient. */
export interface SubsidyTier {
  tier: string;
  /** Percentage of the base fee covered by the grantor, 0–100. */
  discountPercent: number;
  /** Institution funding the subsidy, shown on the invoice. */
  grantor?: string;
}

export interface ShareToken {
  token: string;
  expiresAt: string;
  providerAddress: string;
}

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  address: string;
}

export interface TimeSlot {
  id: string;
  datetime: string;
  available: boolean;
  slotType?: 'regular' | 'emergency' | 'buffer';
}

export interface Appointment {
  id: string;
  doctorId: string;
  doctorName: string;
  patientAddress: string;
  patientName?: string;
  datetime: string;
  type: 'in-person' | 'telemedicine';
  notes?: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  fee: number;
  txHash?: string | undefined;
  videoRoomUrl?: string | undefined;
  videoRoomExpiresAt?: string | undefined;
  /** SEP-38 firm quote locked in at checkout when paying through an anchor. */
  quoteId?: string | undefined;
  /** RFC 5545 recurrence rule string, e.g. RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=4 */
  recurrenceRule?: string | undefined;
  isRecurring?: boolean | undefined;
  recurringPlan?: RecurringAppointmentPlan | undefined;
  bundleTotal?: number | undefined;
  eligibilityProofs?: EligibilityProofToken[] | undefined;
  intakeQuestionnaire?: EncryptedIntakePayload | undefined;
  intakeSummary?: PatientIntakeSummary | undefined;
}

export interface EncryptedIntakePayload {
  encryptedData: string;
  iv: string;
  providerKeyId: string;
  timestamp: string;
  previewSummary?: PatientIntakeSummary;
}

export interface PatientIntakeSummary {
  chiefComplaint: string;
  symptomOnset: string;
  symptoms: string[];
  allergies: string[];
  currentMedications?: string;
  additionalNotes?: string;
}

export interface IntakeQuestion {
  id: string;
  label: string;
  type: 'text' | 'radio' | 'multiselect';
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

export type EligibilityKind = 'age18' | 'insurance' | 'vaccination';

export interface EligibilityProofToken {
  kind: EligibilityKind;
  proof: unknown;
  publicSignals: string[];
  nullifier?: string;
  protocol?: 'groth16' | 'plonk';
}

/**
 * Proof of patient residency in an authorized state/region jurisdiction (#220).
 * Public signals are `[authorizedRoot, residencyCommitment]`; the exact ZIP code stays private.
 */
export interface GeoResidencyProofToken {
  kind: 'geoResidency';
  proof: unknown;
  publicSignals: string[];
  protocol?: 'groth16' | 'plonk';
}

/**
 * Proof that a policy's spend meets its deductible.
 * Public signals are `[deductible, commitment]`; the spend stays private.
 */
export interface DeductibleProofToken {
  kind: 'deductible';
  proof: unknown;
  publicSignals: string[];
}

/**
 * Proof of current medical-board certification in a subspecialty.
 * Public signals are `[specialtyCode, currentDate, issuerAx, issuerAy]`;
 * the state license ID stays private.
 */
export interface ClinicianCredentialProofToken {
  kind: 'clinicianCredential';
  proof: unknown;
  publicSignals: string[];
}

/**
 * Proof that household income is within 200% of the poverty guideline.
 * Public signals are `[subsidizedTier, guidelineBase, guidelinePerPerson, commitment]`.
 */
export interface FinancialHardshipProofToken {
  kind: 'financialHardship';
  proof: unknown;
  publicSignals: string[];
}

export interface NewRecordPayload {
  patientAddress: string;
  diagnosis: string;
  prescription?: string;
  notes?: string;
  diagnosisCode?: DiagnosisCode;
  overrideRationale?: string;
}

export interface MedicationConflict {
  id: string;
  type: 'drug_interaction' | 'allergy_conflict';
  severity: 'severe' | 'moderate' | 'minor';
  drug: string;
  conflictingWith: string;
  title: string;
  description: string;
  recommendation?: string;
}

export interface MedicationCheckResult {
  hasConflicts: boolean;
  hasSevereContraindications: boolean;
  hasAllergyConflicts: boolean;
  conflicts: MedicationConflict[];
}

export interface ClinicalNoteAmendment {
  id: string;
  recordId: string;
  version: number;
  parentHash: string;
  amendmentHash: string;
  ledgerTxHash: string;
  amendingDoctorName: string;
  amendingDoctorAddress: string;
  timestamp: string;
  clinicalJustification: string;
  amendedField: 'notes' | 'diagnosis' | 'prescription' | 'addendum';
  previousContent: string;
  newContent: string;
}



export interface EncryptedRecord {
  id: string;
  patientAddress: string;
  fileName: string;
  fileType: string;
  contentHash: string;
  encryptedMetadataPointer: string;
  uploadedAt: string;
  txHash?: string;
}

export interface UploadEncryptedRecordPayload {
  patientAddress: string;
  fileName: string;
  fileType: string;
  encryptedFile: ArrayBuffer;
  iv: Uint8Array;
  exportedKey: ArrayBuffer;
}

export interface StaffMember {
  id: string;
  name: string;
  role: 'DOCTOR' | 'NURSE' | 'ADMIN';
  specialty?: string;
  department: string;
  address: string;
  status: 'active' | 'inactive' | 'pending';
  joinDate: string;
}

export interface PatientAdmission {
  id: string;
  patientName: string;
  patientAddress: string;
  admissionDate: string;
  dischargeDate?: string;
  department: string;
  status: 'admitted' | 'discharged' | 'pending';
  assignedDoctor: string;
}

export interface HospitalMetrics {
  totalPatients: number;
  activeAdmissions: number;
  totalAppointments: number;
  monthlyRevenue: number;
  complianceScore: number;
  staffCount: number;
}

export interface ComplianceReport {
  id: string;
  title: string;
  type: 'HIPAA' | 'DATA_PRIVACY' | 'LICENSING' | 'SAFETY';
  status: 'compliant' | 'review_needed' | 'non_compliant';
  lastAudit: string;
  nextAudit: string;
  score: number;
}

export interface BulkRecordImportRow {
  date: string;
  doctorName: string;
  diagnosis: string;
  prescription?: string;
  notes?: string;
}

export interface BulkImportResponse {
  imported: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
  records: MedicalRecord[];
}

/** Poseidon commitments an identity issuer or insurer registered for a patient (decimal field elements). */
export interface EligibilityCommitments {
  age18?: string;
  insurance?: string;
  vaccination?: string;
}

/** Normalised pinning state reported by the backend for a record ciphertext. */
export type IpfsPinStatus = 'pinned' | 'queued' | 'failed';

export interface RecordIpfsStorage {
  /** CIDv1 (unixfs-v1-2025 profile) of the record ciphertext. */
  cid: string;
  pinStatus: IpfsPinStatus;
  pinnedAt?: string;
}

/** Base64 AES-256-GCM key material and original file details for a record ciphertext. */
export interface RecordKeyMaterial {
  key: string;
  iv: string;
  fileName: string;
  fileType: string;
}

export interface EncounterNote {
  id: string;
  appointmentId: string;
  doctorAddress: string;
  patientAddress: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export type AnnotationTool = 'pen' | 'arrow' | 'highlighter' | 'text';

export interface AnnotationStroke {
  id: string;
  tool: AnnotationTool;
  points: { x: number; y: number }[];
  color: string;
  lineWidth: number;
  text?: string;
}

export interface AvailabilityBufferConfig {
  bufferMinutes: number;
  minNoticeHours: number;
  emergencySlotsPerDay: number;
  emergencySlotIds: string[];
}
/* ── SEP-38 Anchor RFQ (https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0038.md) ── */

/** Asset identifier: `stellar:CODE:ISSUER`, `stellar:native` or `iso4217:CCY`. */
export type Sep38Asset = string;

export interface Sep38DeliveryMethod {
  name: string;
  description: string;
}

/** `GET /info` → `assets[]` */
export interface Sep38InfoAsset {
  asset: Sep38Asset;
  sell_delivery_methods?: Sep38DeliveryMethod[];
  buy_delivery_methods?: Sep38DeliveryMethod[];
  country_codes?: string[];
}

/** `GET /prices` → `sell_assets[]` (when `buy_asset` is sent) or `buy_assets[]` (when `sell_asset` is sent). */
export interface Sep38IndicativePrice {
  asset: Sep38Asset;
  price: string;
  decimals: number;
}

export interface Sep38Fee {
  total: string;
  asset: Sep38Asset;
  details?: Array<{ name: string; description?: string; amount: string }>;
}

export type Sep38Context = 'sep6' | 'sep24' | 'sep31';

/** `POST /quote` request body. Exactly one of `sell_amount` / `buy_amount` is sent. */
export interface Sep38QuoteRequest {
  sell_asset: Sep38Asset;
  buy_asset: Sep38Asset;
  sell_amount?: string;
  buy_amount?: string;
  expire_after?: string;
  sell_delivery_method?: string;
  buy_delivery_method?: string;
  country_code?: string;
  context: Sep38Context;
}

/** `POST /quote` (201) response: a firm quote reserved until `expires_at`. */
export interface Sep38FirmQuote {
  id: string;
  expires_at: string;
  total_price: string;
  price: string;
  sell_asset: Sep38Asset;
  sell_amount: string;
  sell_delivery_method?: string;
  buy_asset: Sep38Asset;
  buy_amount: string;
  buy_delivery_method?: string;
  fee: Sep38Fee;
}

/* ── Missed-consultation disputes ──────────────────────────────────── */

/**
 * One participant session from Daily's REST `GET /meetings` (`participants[]`).
 * `join_time` is Unix seconds and `duration` is seconds, both with ~15 s granularity.
 */
export interface DailyParticipant {
  user_id: string | null;
  participant_id: string;
  user_name: string | null;
  join_time: number;
  duration: number;
}

/** A telemedicine appointment with its Daily call log, served by the backend (which holds the Daily API key). */
export interface AppointmentAttendance {
  appointmentId: string;
  doctorAddress: string;
  patientAddress: string;
  scheduledStart: string;
  scheduledEnd: string;
  /** Daily meeting-token `user_id` (UUID, max 36 chars) issued to the doctor. */
  doctorUserId: string;
  /** Daily meeting-token `user_id` (UUID, max 36 chars) issued to the patient. */
  patientUserId: string;
  participants: DailyParticipant[];
  /** Set once the arbitration contract has refunded the patient. */
  refundTxHash?: string;
}

export type AttendanceVerdict = 'PENDING' | 'DOCTOR_NO_SHOW' | 'PATIENT_NO_SHOW' | 'ATTENDED';

/** Attendance facts attested by the Heliora oracle; times are Unix seconds. */
export interface DisputeAttestation {
  appointmentId: string;
  arbitrationContract: string;
  doctor: string;
  patient: string;
  scheduledStart: number;
  doctorJoinedAt: number | null;
  patientJoinedAt: number | null;
  verdict: Exclude<AttendanceVerdict, 'PENDING'>;
  issuedAt: number;
}

export interface SignedDisputeAttestation {
  attestation: DisputeAttestation;
  /** Hex ed25519 signature by the oracle key over the attestation's `ScVal` XDR. */
  signature: string;
}

/* ── Cancellation policy (#53) ───────────────────────────────────── */

export interface CancellationTier {
  label: string;
  minHoursBefore: number;
  maxHoursBefore: number | null;
  refundPercent: number;
  forfeitPercent: number;
}

/* Recurring appointments and multi-slot cadence engine (#45) */

export type RecurrenceCadence = 'none' | 'weekly' | 'bi-weekly';

export interface TargetSlotOccurrence {
  occurrenceIndex: number;
  datetime: string;
  matchedSlot?: TimeSlot | undefined;
  isAvailable: boolean;
  conflictReason?: string | undefined;
}

export interface RecurringAppointmentPlan {
  rrule: string;
  cadence: RecurrenceCadence;
  interval: number;
  count: number;
  occurrences: TargetSlotOccurrence[];
  allAvailable: boolean;
  baseFeePerSlot: number;
  totalOriginalFee: number;
  bundleDiscountPercent: number;
  finalBundleFee: number;
}

/* Dynamic waiting room queue management (#49) */

export type QueueStatusStage =
  | 'waiting'
  | 'doctor_reviewing_charts'
  | 'doctor_delayed'
  | 'doctor_entering'
  | 'ready';

export interface QueuePositionUpdate {
  appointmentId: string;
  queuePosition: number;
  estimatedWaitMinutes: number;
  statusMessage: string;
  statusStage: QueueStatusStage;
  doctorStatus: 'in_consultation' | 'reviewing_charts' | 'entering_room' | 'ready';
}

export interface StepAwayContact {
  type: 'sms' | 'email';
  target: string;
}



/* ─── Insurance policy claim tracker & smart contract auto-reimbursement (#164) ─── */

export type ClaimStatus = 'Submitted' | 'In Review' | 'Approved' | 'Disbursed';

export interface InsurancePolicyRecord {
  policyNumber: string;
  providerName: string;
  planType: string;
  subscriberId: string;
  groupNumber: string;
  coveragePercent: number;
  copayAmountUsd: number;
  deductibleRemainingUsd: number;
  status: 'ACTIVE' | 'EXPIRED' | 'PENDING_VERIFICATION';
  smartContractVerifierAddress: string;
}

export interface ClaimExpenseItem {
  code: string;
  description: string;
  grossAmount: number;
  insuranceCoveredAmount: number;
  patientCopayAmount: number;
}

export interface InsuranceClaimRecord {
  claimId: string;
  appointmentId: string;
  receiptNumber: string;
  serviceDate: string;
  submittedAt: string;
  providerName: string;
  facilityName: string;
  policyNumber: string;
  status: ClaimStatus;
  statusTimestamp: string;
  items: ClaimExpenseItem[];
  totalGrossAmount: number;
  totalCoveredAmount: number;
  totalCopayAmount: number;
  reimbursementTx?: {
    txHash: string;
    tokenSymbol: string;
    amount: number;
    payoutTimestamp: string;
    settledOnChain: boolean;
  };
}

/* ─── Admin role verification queue (#145) ───────────────────────── */

export type VerifiableRole = 'DOCTOR' | 'HOSPITAL';

export interface CredentialDocument {
  id: string;
  fileName: string;
  /** Credential category, e.g. medical board certificate or hospital registration. */
  kind: 'medical_license' | 'board_certificate' | 'hospital_registration' | 'identity' | 'other';
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface RoleVerificationApplication {
  id: string;
  applicantAddress: string;
  displayName: string;
  email: string;
  requestedRole: VerifiableRole;
  submittedAt: string;
  licenseNumber?: string;
  issuingAuthority?: string;
  jurisdiction?: string;
  licenseExpiresAt?: string;
  specialty?: string;
  organization?: string;
  documents: CredentialDocument[];
}

export type RejectionReasonCode =
  | 'LICENSE_UNVERIFIABLE'
  | 'LICENSE_EXPIRED'
  | 'DOCUMENT_ILLEGIBLE'
  | 'NAME_MISMATCH'
  | 'JURISDICTION_UNSUPPORTED'
  | 'INCOMPLETE_SUBMISSION'
  | 'SUSPECTED_FRAUD'
  | 'OTHER';

export type RoleVerificationDecisionPayload =
  | { decision: 'approved'; grantTxHash: string; reviewerAddress: string }
  | {
      decision: 'rejected';
      reasonCode: RejectionReasonCode;
      note?: string;
      reviewerAddress: string;
    };

export interface NotificationDispatch {
  channel: 'email';
  status: 'queued' | 'sent' | 'failed';
  dispatchedAt?: string;
  error?: string;
}

export interface RoleVerificationDecisionResult {
  applicationId: string;
  decision: 'approved' | 'rejected';
  decidedAt: string;
  notification: NotificationDispatch;
}

/* ─── Doctor schedule templates (#143) ───────────────────────────── */

/** 0 = Monday … 6 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** A recurring working-hours block, in minutes after local midnight. */
export interface WeeklyHoursBlock {
  id: string;
  day: Weekday;
  startMinute: number;
  endMinute: number;
}

export interface ScheduleTemplate {
  id: string;
  name: string;
  slotMinutes: number;
  blocks: WeeklyHoursBlock[];
}

export type DateOverrideKind = 'holiday' | 'conference' | 'custom';

export interface DateOverride {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  kind: DateOverrideKind;
  label: string;
  /** Replacement hours for `custom`; ignored for `holiday`/`conference` (day off). */
  blocks?: Array<Pick<WeeklyHoursBlock, 'startMinute' | 'endMinute'>>;
}

export interface DoctorScheduleSettings {
  templates: ScheduleTemplate[];
  activeTemplateId: string | null;
  overrides: DateOverride[];
  /** Optimistic-concurrency version from the backend. */
  version?: number;
}

export interface SlotConflict {
  slotId: string;
  datetime: string;
  reason: 'overlaps_existing_slot' | 'overlaps_booked_appointment' | 'in_past' | string;
}

export interface BulkSlotPublishResult {
  published: number;
  slots: TimeSlot[];
  batchId: string;
}

/* ─── Soroban Contract Error Decoding (#191) ─────────────────────── */

export enum SorobanContractErrorCode {
  UnauthorizedDoctor = 1001,
  ExpiredLicense = 1002,
  DoctorNotRegistered = 1003,
  RecordNotFound = 1004,
  AccessDenied = 1005,
  InvalidRole = 1006,
  ConsentRequired = 1007,
  AppointmentNotFound = 1008,
  InvalidEscrowState = 1009,
  DisputeAlreadyActive = 1010,
  SlotUnavailable = 1011,
  InsufficientPermissions = 1012,
}

export type SorobanContractErrorName = keyof typeof SorobanContractErrorCode;

export interface DecodedContractError {
  code: number;
  name: SorobanContractErrorName | string;
  message: string;
  rawError?: string;
  contractId?: string;
}

/* ─── HL7 FHIR R4 Patient Interoperability (#274) ────────────────── */

export interface FHIRIdentifier {
  use?: 'usual' | 'official' | 'temp' | 'secondary' | 'old';
  system?: string;
  value?: string;
  type?: {
    coding?: Array<{ system?: string; code?: string; display?: string }>;
    text?: string;
  };
}

export interface FHIRHumanName {
  use?: 'usual' | 'official' | 'temp' | 'nickname' | 'anonymous' | 'old' | 'maiden';
  text?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
  suffix?: string[];
}

export interface FHIRContactPoint {
  system?: 'phone' | 'fax' | 'email' | 'pager' | 'url' | 'sms' | 'other';
  value?: string;
  use?: 'home' | 'work' | 'temp' | 'old' | 'mobile';
  rank?: number;
}

export interface FHIRAddress {
  use?: 'home' | 'work' | 'temp' | 'old' | 'billing';
  type?: 'postal' | 'physical' | 'both';
  text?: string;
  line?: string[];
  city?: string;
  district?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface FHIRPatient {
  resourceType: 'Patient';
  id?: string;
  active?: boolean;
  identifier?: FHIRIdentifier[];
  name?: FHIRHumanName[];
  telecom?: FHIRContactPoint[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
  deceasedBoolean?: boolean;
  deceasedDateTime?: string;
  address?: FHIRAddress[];
  maritalStatus?: {
    coding?: Array<{ system?: string; code: string; display?: string }>;
    text?: string;
  };
  communication?: Array<{
    language: {
      coding?: Array<{ system?: string; code: string; display?: string }>;
      text?: string;
    };
    preferred?: boolean;
  }>;
  [key: string]: unknown;
}

export interface HelioraPatientAddress {
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface HelioraPatient {
  id: string;
  walletAddress?: string;
  firstName: string;
  lastName: string;
  fullName?: string;
  birthDate?: string;
  gender?: 'male' | 'female' | 'other' | 'unknown';
  active?: boolean;
  phone?: string;
  email?: string;
  address?: HelioraPatientAddress;
  maritalStatus?: string;
  preferredLanguage?: string;
}


/* ── Video Call Transcription & Clinical Notes (#64) ───────────────── */

export interface TranscriptionConsentState {
  doctorConsented: boolean;
  patientConsented: boolean;
  isMutualConsent: boolean;
  timestamp?: number | undefined;
}

export interface TranscriptSegment {
  id: string;
  speaker: 'doctor' | 'patient';
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface ClinicalDraftNote {
  appointmentId: string;
  patientAddress: string;
  generatedAt: string;
  diagnosis: string;
  notes: string;
  prescription: string;
  rawTranscripts: TranscriptSegment[];
}

/* ── WebRTC Automated Reconnection & State Recovery (#66) ─────────── */

export type ReconnectionState = 'connected' | 'reconnecting' | 'failed';

export interface ReconnectionStatus {
  state: ReconnectionState;
  remainingSeconds: number;
  attemptCount: number;
  message?: string | undefined;
}
