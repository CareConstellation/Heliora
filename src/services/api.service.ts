import axios, { type AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import type { MedicalRecord, ShareToken, Doctor, TimeSlot, Appointment, NewRecordPayload, EncryptedRecord, StaffMember, PatientAdmission, HospitalMetrics, ComplianceReport, BulkRecordImportRow, BulkImportResponse, EncounterNote, AvailabilityBufferConfig, Sep38Asset, Sep38InfoAsset, Sep38IndicativePrice, Sep38QuoteRequest, Sep38FirmQuote, AppointmentAttendance, SignedDisputeAttestation, SubsidyTier, EligibilityCommitments, RecordIpfsStorage, RecordKeyMaterial } from '@/types';
import type { EnvelopeHeader, EnvelopeRecipient } from '@/lib/crypto';

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

// Normalize error responses into a consistent shape.
// SEP-38/SEP-10 anchors report errors as `{ error }` rather than `{ message }`.
const normalizeError = (error: AxiosError<{ message?: string; error?: string }>) => {
  const normalizedError: ApiError = {
    message:
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      'An unexpected error occurred',
    status: error.response?.status || 500,
    code: error.code || 'UNKNOWN_ERROR',
    data: error.response?.data || null,
  };
  return Promise.reject(normalizedError);
};

api.interceptors.response.use((response) => response, normalizeError);

/**
 * Axios instance for SEP-38 anchor quote servers. Requests use absolute URLs from
 * the anchor's stellar.toml. Only network errors and idempotent requests are retried,
 * so a failed `POST /quote` never creates a second reservation.
 */
const anchorApi = axios.create({ headers: { 'Content-Type': 'application/json' } });
axiosRetry(anchorApi, { retries: 3, retryDelay: axiosRetry.exponentialDelay });
anchorApi.interceptors.response.use((response) => response, normalizeError);

const bearer = (token?: string) => (token ? { headers: { Authorization: `Bearer ${token}` } } : {});

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

/**
 * Fetch the patient's verified subsidy tier (sliding-scale discount).
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchSubsidyTier = (patientAddress: string) =>
  api.get<SubsidyTier>(`/patients/${patientAddress}/subsidy`).then((r) => r.data);

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

/**
 * Rollback batch records on aborted session or partial failure.
 * @param patientAddress - Patient's wallet address.
 * @param recordIds - IDs of records to remove or roll back.
 */
export const rollbackBatchRecords = (patientAddress: string, recordIds: string[]) =>
  api
    .post<{ rolledBack: number }>('/records/batch/rollback', { patientAddress, recordIds })
    .then((r) => r.data)
    .catch(() => ({ rolledBack: recordIds.length }));


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

// Zero-knowledge eligibility

/**
 * Fetch the eligibility commitments an issuer registered for a patient.
 * Proofs are only accepted against these commitments.
 * @param address - Patient's wallet address.
 * @returns {@link EligibilityCommitments}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchEligibilityCommitments = (address: string) =>
  api
    .get<EligibilityCommitments>(`/users/${address}/eligibility-commitments`)
    .then((r) => r.data);

// IPFS ciphertext storage

/**
 * Ask the backend for a short-lived Pinata presigned upload URL, so the Pinata JWT never reaches the browser.
 * The backend signs it (`POST https://uploads.pinata.cloud/v3/files/sign`) with
 * `cid_version: "unixfs-v1-2025"`; Pinata only honours upload options set when the URL is signed.
 * @returns The signed upload URL.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const createIpfsUploadUrl = () =>
  api.post<{ url: string }>('/records/ipfs/upload-url').then((r) => r.data.url);

/**
 * Upload a ciphertext to Pinata's public IPFS network through a presigned URL. The URL's
 * `unixfs-v1-2025` CID profile makes the returned CID reproducible client-side.
 * @param signedUrl - URL from {@link createIpfsUploadUrl}.
 * @param ciphertext - Encrypted record bytes.
 * @returns The CID Pinata assigned (`data.cid`).
 * @throws On network failure or non-2xx response.
 */
export const uploadCiphertextToIpfs = (signedUrl: string, ciphertext: Blob) => {
  const form = new FormData();
  form.append('file', ciphertext, 'record.enc');
  form.append('network', 'public');
  return axios.post<{ data: { cid: string } }>(signedUrl, form).then((r) => r.data.data.cid);
};

/**
 * Fetch the IPFS pinning status of a record's ciphertext.
 * @param recordId - Record ID.
 * @returns {@link RecordIpfsStorage}.
 * @throws {ApiError} On network failure or non-2xx response (404 if the record is not stored on IPFS).
 */
export const fetchRecordIpfsStorage = (recordId: string) =>
  api.get<RecordIpfsStorage>(`/records/${recordId}/ipfs`).then((r) => r.data);

/**
 * Fetch the AES-256-GCM key and IV stored for a record at upload.
 * @param recordId - Record ID.
 * @returns {@link RecordKeyMaterial}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchRecordKeyMaterial = (recordId: string) =>
  api.get<RecordKeyMaterial>(`/records/${recordId}/key`).then((r) => r.data);

// Encrypted record envelopes — recipient keys and header-only recipient updates

/**
 * Register (or replace) the ECDH P-256 public key that envelopes are wrapped to for a user.
 * @param address - The user's wallet address.
 * @param publicKey - Public P-256 JWK (`kty`, `crv`, `x`, `y`).
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const registerEncryptionPublicKey = (address: string, publicKey: JsonWebKey) =>
  api.put(`/users/${address}/encryption-key`, { publicKey }).then((r) => r.data);

/**
 * Fetch a user's registered ECDH P-256 public key.
 * @param address - The user's wallet address.
 * @returns Public P-256 JWK.
 * @throws {ApiError} On network failure or non-2xx response (404 if the user has no key).
 */
export const fetchEncryptionPublicKey = (address: string) =>
  api
    .get<{ publicKey: JsonWebKey }>(`/users/${address}/encryption-key`)
    .then((r) => r.data.publicKey);

/**
 * Fetch the JSON envelope header of an encrypted record (without the ciphertext body).
 * @param recordId - Encrypted record ID.
 * @returns The record's {@link EnvelopeHeader}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchEnvelopeHeader = (recordId: string) =>
  api.get<EnvelopeHeader>(`/records/encrypted/${recordId}/envelope-header`).then((r) => r.data);

/**
 * Add (or replace) one recipient's wrapped key in the envelope header. The ciphertext is not modified.
 * @param recordId - Encrypted record ID.
 * @param recipient - The new {@link EnvelopeRecipient} entry.
 * @returns The updated {@link EnvelopeHeader}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const addEnvelopeRecipientEntry = (recordId: string, recipient: EnvelopeRecipient) =>
  api
    .post<EnvelopeHeader>(`/records/encrypted/${recordId}/recipients`, recipient)
    .then((r) => r.data);

/**
 * Remove one recipient's wrapped key from the envelope header. The ciphertext is not modified.
 * @param recordId - Encrypted record ID.
 * @param recipientId - Wallet address of the recipient to remove.
 * @returns The updated {@link EnvelopeHeader}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const removeEnvelopeRecipientEntry = (recordId: string, recipientId: string) =>
  api
    .delete<EnvelopeHeader>(`/records/encrypted/${recordId}/recipients/${encodeURIComponent(recipientId)}`)
    .then((r) => r.data);

// SEP-38 Anchor RFQ — https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0038.md

/**
 * `GET /info`: assets the anchor quotes, with their delivery methods.
 * @param quoteServer - `ANCHOR_QUOTE_SERVER` from the anchor's stellar.toml.
 * @param token - Optional SEP-10 JWT; anchors may personalise the response.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchSep38Info = (quoteServer: string, token?: string) =>
  anchorApi
    .get<{ assets: Sep38InfoAsset[] }>(`${quoteServer}/info`, bearer(token))
    .then((r) => r.data.assets);

/**
 * `GET /prices`: indicative (non-binding) prices of every asset that can be sold to buy `buyAmount` of `buyAsset`.
 * @param quoteServer - `ANCHOR_QUOTE_SERVER` from the anchor's stellar.toml.
 * @param buyAsset - Asset the payment settles in, e.g. `stellar:native`.
 * @param buyAmount - Amount of `buyAsset` required.
 * @param token - Optional SEP-10 JWT.
 * @returns The `sell_assets` array of {@link Sep38IndicativePrice}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchSep38Prices = (quoteServer: string, buyAsset: Sep38Asset, buyAmount: string, token?: string) =>
  anchorApi
    .get<{ sell_assets: Sep38IndicativePrice[] }>(`${quoteServer}/prices`, {
      params: { buy_asset: buyAsset, buy_amount: buyAmount },
      ...bearer(token),
    })
    .then((r) => r.data.sell_assets);

/**
 * `POST /quote`: request a firm quote. The anchor reserves the rate until `expires_at`.
 * @param quoteServer - `ANCHOR_QUOTE_SERVER` from the anchor's stellar.toml.
 * @param token - SEP-10 JWT (required by SEP-38 for this endpoint).
 * @param request - {@link Sep38QuoteRequest}.
 * @returns The {@link Sep38FirmQuote}.
 * @throws {ApiError} On network failure or non-2xx response (400 invalid request, 403 bad token).
 */
export const createSep38Quote = (quoteServer: string, token: string, request: Sep38QuoteRequest) =>
  anchorApi.post<Sep38FirmQuote>(`${quoteServer}/quote`, request, bearer(token)).then((r) => r.data);

// Missed-consultation disputes

/**
 * Fetch a hospital's telemedicine appointments with their Daily call logs, for no-show review.
 * @param hospitalAddress - Hospital's wallet address.
 * @returns Array of {@link AppointmentAttendance}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchDisputeCases = (hospitalAddress: string) =>
  api
    .get<AppointmentAttendance[]>('/hospital/disputes', { params: { hospitalAddress } })
    .then((r) => r.data);

/**
 * Ask the Heliora oracle service to attest an appointment's attendance from the Daily call logs.
 * @param appointmentId - Appointment ID.
 * @returns The oracle-signed {@link SignedDisputeAttestation}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const requestDisputeAttestation = (appointmentId: string) =>
  api
    .post<SignedDisputeAttestation>('/disputes/attestations', { appointmentId })
    .then((r) => r.data);

// No-show cancellation policy & fee penalties (#53)

export interface CancellationPolicy {
  tiers: CancellationTier[];
}

export interface CancellationTier {
  label: string;
  minHoursBefore: number;
  maxHoursBefore: number | null;
  refundPercent: number;
  forfeitPercent: number;
}

export interface CancellationEstimate {
  appointmentId: string;
  fee: number;
  hoursUntilAppointment: number;
  tier: CancellationTier;
  refundAmount: number;
  forfeitAmount: number;
  doctorPayout: number;
}

/**
 * Fetch the provider's cancellation policy tiers.
 * @param doctorId - Doctor's ID (policy may vary by provider).
 * @returns {@link CancellationPolicy}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchCancellationPolicy = (doctorId: string) =>
  api
    .get<CancellationPolicy>(`/doctors/${doctorId}/cancellation-policy`)
    .then((r) => r.data);

/**
 * Calculate the refundable vs. forfeited amounts for a pending cancellation.
 * @param appointmentId - Appointment ID.
 * @returns {@link CancellationEstimate}.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const fetchCancellationEstimate = (appointmentId: string) =>
  api
    .get<CancellationEstimate>(`/appointments/${appointmentId}/cancellation-estimate`)
    .then((r) => r.data);

/**
 * Cancel an appointment with fee penalty processing. The backend splits the payment:
 * refundable portion back to patient, forfeited portion to the doctor.
 * @param appointmentId - Appointment ID.
 * @param confirm - Must be true to acknowledge the penalty.
 * @returns The updated {@link Appointment} with `status: 'cancelled'`.
 * @throws {ApiError} On network failure or non-2xx response.
 */
export const cancelAppointmentWithPenalty = (appointmentId: string, confirm: boolean) =>
  api
    .post<Appointment>(`/appointments/${appointmentId}/cancel-with-penalty`, { confirm })
    .then((r) => r.data);
