import axios from 'axios';
import axiosRetry from 'axios-retry';
import type { MedicalRecord, ShareToken, Doctor, TimeSlot, Appointment, NewRecordPayload, EncryptedRecord, StaffMember, PatientAdmission, HospitalMetrics, ComplianceReport, BulkRecordImportRow, BulkImportResponse, EncounterNote, AvailabilityBufferConfig } from '@/types';

/**
 * Shared axios instance for all API calls.
 * - `baseURL`: read from `NEXT_PUBLIC_API_URL` (empty string if unset, i.e. relative requests).
 * - `headers`: defaults to `Content-Type: application/json`; overridden per-call where needed
 *   (e.g. multipart uploads in {@link uploadEncryptedRecord}).
 */
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? '',
  headers: { 'Content-Type': 'application/json' },
});

// Implement retry-with-backoff for transient network failures
axiosRetry(api, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error) || (error.response ? error.response.status >= 500 : false);
  },
});

/** Normalized error shape produced by the response interceptor below. */
export interface ApiError {
  message: string;
  status: number;
  code: string;
  data: unknown;
}

// Normalize error responses into a consistent shape
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const normalizedError: ApiError = {
      message: error.response?.data?.message || error.message || 'An unexpected error occurred',
      status: error.response?.status || 500,
      code: error.code || 'UNKNOWN_ERROR',
      data: error.response?.data || null,
    };
    return Promise.reject(normalizedError);
  }
);

/** Generic cursor-paginated response envelope used by list endpoints. */
export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  total: number;
}

// Medical Records

/**
 * Fetch all medical records for a patient.
 * @param patientAddress - Patient's wallet address.
 * @returns Array of {@link MedicalRecord}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchRecords = (patientAddress: string) =>
  api.get<MedicalRecord[]>('/records', { params: { patientAddress } }).then((r) => r.data);

/**
 * Fetch a patient's medical records with cursor-based pagination.
 * @param patientAddress - Patient's wallet address.
 * @param cursor - Opaque cursor from a previous page's `nextCursor`; omit for the first page.
 * @param limit - Max records per page (default 10).
 * @returns {@link PaginatedResponse} of {@link MedicalRecord}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchRecordsPaginated = (patientAddress: string, cursor?: string, limit = 10) =>
  api
    .get<PaginatedResponse<MedicalRecord>>('/records', {
      params: { patientAddress, cursor, limit },
    })
    .then((r) => r.data);

/**
 * Share a medical record with another provider.
 * @param recordId - ID of the record to share.
 * @param providerAddress - Wallet address of the receiving provider.
 * @returns The generated {@link ShareToken}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const shareRecord = (recordId: string, providerAddress: string) =>
  api.post<ShareToken>(`/records/${recordId}/share`, { providerAddress }).then((r) => r.data);

// Doctors & Slots

/**
 * Fetch the list of doctors, optionally filtered by specialty.
 * @param specialty - Optional specialty filter.
 * @param signal - Optional {@link AbortSignal} to cancel the request.
 * @returns Array of {@link Doctor}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchDoctors = (specialty?: string, signal?: AbortSignal) =>
  api
    .get<Doctor[]>('/doctors', {
      params: specialty ? { specialty } : {},
      ...(signal ? { signal } : {}),
    })
    .then((r) => r.data);

/**
 * Fetch a doctor's patients with cursor-based pagination.
 * @param doctorAddress - Doctor's wallet address.
 * @param cursor - Opaque cursor from a previous page's `nextCursor`; omit for the first page.
 * @param limit - Max patients per page (default 10).
 * @returns {@link PaginatedResponse} of patient summary records.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchDoctorPatientsPaginated = (doctorAddress: string, cursor?: string, limit = 10) =>
  api
    .get<
      PaginatedResponse<{
        name: string;
        initials: string;
        age: number;
        lastVisit: string;
        status: string;
        records: number;
        addr: string;
      }>
    >('/doctors/patients', {
      params: { doctorAddress, cursor, limit },
    })
    .then((r) => r.data);

/**
 * Fetch available appointment slots for a doctor.
 * @param doctorId - Doctor's ID.
 * @returns Array of {@link TimeSlot}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchSlots = (doctorId: string) =>
  api.get<TimeSlot[]>(`/doctors/${doctorId}/slots`).then((r) => r.data);

// Appointments

/**
 * Fetch appointments for a patient or doctor.
 * @param address - Wallet address of the patient or doctor.
 * @param role - Whether `address` identifies a `'patient'` or `'doctor'`.
 * @returns Array of {@link Appointment}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchAppointments = (address: string, role: 'patient' | 'doctor') =>
  api.get<Appointment[]>('/appointments', { params: { address, role } }).then((r) => r.data);

/**
 * Create a new appointment.
 * @param payload - Appointment fields, excluding server-assigned `id`, `status`, and `txHash`.
 * @returns The created {@link Appointment}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const createAppointment = (payload: Omit<Appointment, 'id' | 'status' | 'txHash'>) =>
  api.post<Appointment>('/appointments', payload).then((r) => r.data);

/**
 * Cancel an appointment.
 * @param id - Appointment ID.
 * @returns The updated {@link Appointment}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const cancelAppointment = (id: string) =>
  api.patch<Appointment>(`/appointments/${id}/cancel`).then((r) => r.data);

/**
 * Update an appointment's status.
 * @param id - Appointment ID.
 * @param status - New status value.
 * @returns The updated {@link Appointment}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const updateAppointmentStatus = (id: string, status: Appointment['status']) =>
  api.patch<Appointment>(`/appointments/${id}/status`, { status }).then((r) => r.data);

/**
 * Create a new medical record (doctor-initiated).
 * @param payload - New record fields; see {@link NewRecordPayload}.
 * @returns The created {@link MedicalRecord}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const createRecord = (payload: NewRecordPayload) =>
  api.post<MedicalRecord>('/records', payload).then((r) => r.data);

export default api;

/**
 * Upload an encrypted medical record.
 * @param formData - Multipart form data containing the encrypted payload; sent with
 *   `Content-Type: multipart/form-data`, overriding the instance default.
 * @returns The stored {@link EncryptedRecord}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const uploadEncryptedRecord = (formData: FormData) =>
  api
    .post<EncryptedRecord>('/records/encrypted', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    .then((r) => r.data);

// Hospital — metrics, staff, admissions, compliance

/**
 * Fetch aggregate metrics for a hospital.
 * @param hospitalAddress - Hospital's wallet address.
 * @returns {@link HospitalMetrics}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchHospitalMetrics = (hospitalAddress: string) =>
  api
    .get<HospitalMetrics>('/hospital/metrics', { params: { hospitalAddress } })
    .then((r) => r.data);

/**
 * Fetch a hospital's staff list.
 * @param hospitalAddress - Hospital's wallet address.
 * @returns Array of {@link StaffMember}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchStaff = (hospitalAddress: string) =>
  api.get<StaffMember[]>('/hospital/staff', { params: { hospitalAddress } }).then((r) => r.data);

/**
 * Fetch a hospital's current patient admissions.
 * @param hospitalAddress - Hospital's wallet address.
 * @returns Array of {@link PatientAdmission}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchAdmissions = (hospitalAddress: string) =>
  api
    .get<PatientAdmission[]>('/hospital/admissions', { params: { hospitalAddress } })
    .then((r) => r.data);

/**
 * Fetch compliance reports for a hospital.
 * @param hospitalAddress - Hospital's wallet address.
 * @returns Array of {@link ComplianceReport}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchComplianceReports = (hospitalAddress: string) =>
  api
    .get<ComplianceReport[]>('/hospital/compliance', { params: { hospitalAddress } })
    .then((r) => r.data);

/**
 * Apply a bulk action to a set of hospital staff members.
 * @param hospitalAddress - Hospital's wallet address.
 * @param staffIds - IDs of the staff members to update.
 * @param action - Action to apply: `'activate'`, `'deactivate'`, or `'remove'`.
 * @returns Server response payload for the bulk operation.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const bulkUpdateStaff = (
  hospitalAddress: string,
  staffIds: string[],
  action: 'activate' | 'deactivate' | 'remove',
) => api.post('/hospital/staff/bulk', { hospitalAddress, staffIds, action }).then((r) => r.data);

/**
 * Bulk import medical records for a patient.
 * @param patientAddress - Patient's wallet address.
 * @param records - Rows to import; see {@link BulkRecordImportRow}.
 * @returns {@link BulkImportResponse} summarizing successes/failures.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const bulkImportRecords = (patientAddress: string, records: BulkRecordImportRow[]) =>
  api.post<BulkImportResponse>('/records/batch', { patientAddress, records }).then((r) => r.data);

// Encounter Notes

export const fetchEncounterNote = (appointmentId: string) =>
  api.get<EncounterNote>(`/appointments/${appointmentId}/notes`).then((r) => r.data);

export const saveEncounterNote = (appointmentId: string, content: string) =>
  api.post<EncounterNote>(`/appointments/${appointmentId}/notes`, { content }).then((r) => r.data);

// Doctor Availability Configuration

export const fetchAvailabilityConfig = (doctorAddress: string) =>
  api
    .get<AvailabilityBufferConfig>('/doctors/availability-config', { params: { doctorAddress } })
    .then((r) => r.data);

export const updateAvailabilityConfig = (
  doctorAddress: string,
  config: AvailabilityBufferConfig,
) =>
  api
    .put<AvailabilityBufferConfig>('/doctors/availability-config', { doctorAddress, ...config })
    .then((r) => r.data);
