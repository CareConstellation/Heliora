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
  txHash?: string;
  videoRoomUrl?: string;
  videoRoomExpiresAt?: string;
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
