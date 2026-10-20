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
  txHash?: string;
  videoRoomUrl?: string;
  videoRoomExpiresAt?: string;
  /** SEP-38 firm quote locked in at checkout when paying through an anchor. */
  quoteId?: string;
}

export interface NewRecordPayload {
  patientAddress: string;
  diagnosis: string;
  prescription?: string;
  notes?: string;
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
