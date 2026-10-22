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

export type EligibilityKind = 'age18' | 'insurance';


export interface EligibilityProofToken {
  kind: EligibilityKind;
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

