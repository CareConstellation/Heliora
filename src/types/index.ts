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
  /** Zero-knowledge eligibility proofs; no birth date or policy data is ever included. */
  eligibilityProofs?: EligibilityProofToken[];
}

export type EligibilityKind = 'age18' | 'insurance';

/** A Groth16 proof plus its public signals: the only eligibility data that leaves the browser. */
export interface EligibilityProofToken {
  kind: EligibilityKind;
  proof: import('snarkjs').Groth16Proof;
  publicSignals: string[];
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
