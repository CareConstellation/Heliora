import api, {
  fetchRecords,
  fetchRecordsPaginated,
  shareRecord,
  fetchDoctors,
  fetchDoctorPatientsPaginated,
  fetchSlots,
  fetchAppointments,
  createAppointment,
  cancelAppointment,
  updateAppointmentStatus,
  createRecord,
  uploadEncryptedRecord,
  fetchHospitalMetrics,
  fetchStaff,
  fetchAdmissions,
  fetchComplianceReports,
  bulkUpdateStaff,
  bulkImportRecords,
} from '@/services/api.service';

// `var` keeps these hoisted above the jest.mock factory, which runs before imports.
// eslint-disable-next-line no-var
var mockInterceptorFulfilled: (res: any) => any;
// eslint-disable-next-line no-var
var mockInterceptorRejected: (err: any) => Promise<any>;

jest.mock('axios', () => {
  const mockApi = {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: {
        use: jest.fn((fulfilled, rejected) => {
          mockInterceptorFulfilled = fulfilled;
          mockInterceptorRejected = rejected;
        }),
      },
    },
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => mockApi),
    },
  };
});

jest.mock('axios-retry', () => {
  const mockAxiosRetry = jest.fn();
  (mockAxiosRetry as any).exponentialDelay = jest.fn();
  (mockAxiosRetry as any).isNetworkOrIdempotentRequestError = jest.fn();
  return mockAxiosRetry;
});

describe('api.service unit tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Medical Records API', () => {
    it('fetchRecords calls GET /records with correct patientAddress param', async () => {
      const mockData = [{ id: '1', diagnosis: 'Flu' }];
      (api.get as jest.Mock).mockResolvedValueOnce({ data: mockData });

      const res = await fetchRecords('G123');
      expect(api.get).toHaveBeenCalledWith('/records', { params: { patientAddress: 'G123' } });
      expect(res).toEqual(mockData);
    });

    it('fetchRecordsPaginated calls GET /records with patientAddress, cursor, and limit params', async () => {
      const mockResponse = { data: [{ id: '1' }], nextCursor: 'cursor_2', total: 1 };
      (api.get as jest.Mock).mockResolvedValueOnce({ data: mockResponse });

      const res = await fetchRecordsPaginated('G123', 'cursor_1', 10);
      expect(api.get).toHaveBeenCalledWith('/records', {
        params: { patientAddress: 'G123', cursor: 'cursor_1', limit: 10 },
      });
      expect(res).toEqual(mockResponse);
    });

    it('fetchRecordsPaginated uses default limit = 10 when cursor and limit are omitted', async () => {
      const mockResponse = { data: [], nextCursor: null, total: 0 };
      (api.get as jest.Mock).mockResolvedValueOnce({ data: mockResponse });

      const res = await fetchRecordsPaginated('G123');
      expect(api.get).toHaveBeenCalledWith('/records', {
        params: { patientAddress: 'G123', cursor: undefined, limit: 10 },
      });
      expect(res).toEqual(mockResponse);
    });

    it('shareRecord calls POST /records/:id/share with providerAddress', async () => {
      const mockToken = { token: 'token123', expiresAt: '2026-12-31' };
      (api.post as jest.Mock).mockResolvedValueOnce({ data: mockToken });

      const res = await shareRecord('rec-99', 'GPROVIDER');
      expect(api.post).toHaveBeenCalledWith('/records/rec-99/share', { providerAddress: 'GPROVIDER' });
      expect(res).toEqual(mockToken);
    });

    it('createRecord calls POST /records with record payload', async () => {
      const payload = { patientAddress: 'GPATIENT', doctorName: 'Dr. Smith', diagnosis: 'Checkup' } as any;
      const mockCreated = { id: 'rec-100', ...payload };
      (api.post as jest.Mock).mockResolvedValueOnce({ data: mockCreated });

      const res = await createRecord(payload);
      expect(api.post).toHaveBeenCalledWith('/records', payload);
      expect(res).toEqual(mockCreated);
    });

    it('uploadEncryptedRecord calls POST /records/encrypted with FormData and header', async () => {
      const formData = new FormData();
      const mockEncrypted = { id: 'enc-1', fileName: 'test.pdf' };
      (api.post as jest.Mock).mockResolvedValueOnce({ data: mockEncrypted });

      const res = await uploadEncryptedRecord(formData);
      expect(api.post).toHaveBeenCalledWith('/records/encrypted', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      expect(res).toEqual(mockEncrypted);
    });

    it('bulkImportRecords calls POST /records/batch with patientAddress and records', async () => {
      const records = [{ diagnosis: 'Asthma' }] as any;
      const mockImportRes = { importedCount: 1, failedCount: 0 };
      (api.post as jest.Mock).mockResolvedValueOnce({ data: mockImportRes });

      const res = await bulkImportRecords('GPATIENT', records);
      expect(api.post).toHaveBeenCalledWith('/records/batch', { patientAddress: 'GPATIENT', records });
      expect(res).toEqual(mockImportRes);
    });
  });

  describe('Doctors & Slots API', () => {
    it('fetchDoctors calls GET /doctors without specialty when omitted', async () => {
      const mockDoctors = [{ id: 'doc1', name: 'Dr. A' }];
      (api.get as jest.Mock).mockResolvedValueOnce({ data: mockDoctors });

      const res = await fetchDoctors();
      expect(api.get).toHaveBeenCalledWith('/doctors', { params: {} });
      expect(res).toEqual(mockDoctors);
    });

    it('fetchDoctors calls GET /doctors with specialty and abort signal when provided', async () => {
      const controller = new AbortController();
      (api.get as jest.Mock).mockResolvedValueOnce({ data: [] });

      await fetchDoctors('Cardiology', controller.signal);
      expect(api.get).toHaveBeenCalledWith('/doctors', {
        params: { specialty: 'Cardiology' },
        signal: controller.signal,
      });
    });

    it('fetchDoctorPatientsPaginated calls GET /doctors/patients with doctorAddress, cursor, and limit', async () => {
      const mockPatientsRes = { data: [], nextCursor: null, total: 0 };
      (api.get as jest.Mock).mockResolvedValueOnce({ data: mockPatientsRes });

      const res = await fetchDoctorPatientsPaginated('GDOCTOR', 'cur1', 5);
      expect(api.get).toHaveBeenCalledWith('/doctors/patients', {
        params: { doctorAddress: 'GDOCTOR', cursor: 'cur1', limit: 5 },
      });
      expect(res).toEqual(mockPatientsRes);
    });

    it('fetchSlots calls GET /doctors/:doctorId/slots', async () => {
      const mockSlots = [{ id: 's1', time: '10:00 AM' }];
      (api.get as jest.Mock).mockResolvedValueOnce({ data: mockSlots });

      const res = await fetchSlots('doc-45');
      expect(api.get).toHaveBeenCalledWith('/doctors/doc-45/slots');
      expect(res).toEqual(mockSlots);
    });
  });

  describe('Appointments API', () => {
    it('fetchAppointments calls GET /appointments with address and role', async () => {
      const mockAppts = [{ id: 'app1' }];
      (api.get as jest.Mock).mockResolvedValueOnce({ data: mockAppts });

      const res = await fetchAppointments('G123', 'patient');
      expect(api.get).toHaveBeenCalledWith('/appointments', { params: { address: 'G123', role: 'patient' } });
      expect(res).toEqual(mockAppts);
    });

    it('createAppointment calls POST /appointments with payload', async () => {
      const payload = { doctorId: 'doc1', date: '2026-08-01', time: '10:00 AM' } as any;
      const mockRes = { id: 'app-99', ...payload, status: 'pending' };
      (api.post as jest.Mock).mockResolvedValueOnce({ data: mockRes });

      const res = await createAppointment(payload);
      expect(api.post).toHaveBeenCalledWith('/appointments', payload);
      expect(res).toEqual(mockRes);
    });

    it('cancelAppointment calls PATCH /appointments/:id/cancel', async () => {
      const mockRes = { id: 'app-99', status: 'cancelled' };
      (api.patch as jest.Mock).mockResolvedValueOnce({ data: mockRes });

      const res = await cancelAppointment('app-99');
      expect(api.patch).toHaveBeenCalledWith('/appointments/app-99/cancel');
      expect(res).toEqual(mockRes);
    });

    it('updateAppointmentStatus calls PATCH /appointments/:id/status with status body', async () => {
      const mockRes = { id: 'app-99', status: 'completed' };
      (api.patch as jest.Mock).mockResolvedValueOnce({ data: mockRes });

      const res = await updateAppointmentStatus('app-99', 'completed' as any);
      expect(api.patch).toHaveBeenCalledWith('/appointments/app-99/status', { status: 'completed' });
      expect(res).toEqual(mockRes);
    });
  });

  describe('Hospital Management API', () => {
    it('fetchHospitalMetrics calls GET /hospital/metrics', async () => {
      const mockMetrics = { totalPatients: 150 };
      (api.get as jest.Mock).mockResolvedValueOnce({ data: mockMetrics });

      const res = await fetchHospitalMetrics('GHOSPITAL');
      expect(api.get).toHaveBeenCalledWith('/hospital/metrics', { params: { hospitalAddress: 'GHOSPITAL' } });
      expect(res).toEqual(mockMetrics);
    });

    it('fetchStaff calls GET /hospital/staff', async () => {
      const mockStaff = [{ id: 'staff-1' }];
      (api.get as jest.Mock).mockResolvedValueOnce({ data: mockStaff });

      const res = await fetchStaff('GHOSPITAL');
      expect(api.get).toHaveBeenCalledWith('/hospital/staff', { params: { hospitalAddress: 'GHOSPITAL' } });
      expect(res).toEqual(mockStaff);
    });

    it('fetchAdmissions calls GET /hospital/admissions', async () => {
      const mockAdmissions = [{ id: 'adm-1' }];
      (api.get as jest.Mock).mockResolvedValueOnce({ data: mockAdmissions });

      const res = await fetchAdmissions('GHOSPITAL');
      expect(api.get).toHaveBeenCalledWith('/hospital/admissions', { params: { hospitalAddress: 'GHOSPITAL' } });
      expect(res).toEqual(mockAdmissions);
    });

    it('fetchComplianceReports calls GET /hospital/compliance', async () => {
      const mockReports = [{ id: 'rep-1' }];
      (api.get as jest.Mock).mockResolvedValueOnce({ data: mockReports });

      const res = await fetchComplianceReports('GHOSPITAL');
      expect(api.get).toHaveBeenCalledWith('/hospital/compliance', { params: { hospitalAddress: 'GHOSPITAL' } });
      expect(res).toEqual(mockReports);
    });

    it('bulkUpdateStaff calls POST /hospital/staff/bulk with action and staffIds', async () => {
      const mockRes = { success: true };
      (api.post as jest.Mock).mockResolvedValueOnce({ data: mockRes });

      const res = await bulkUpdateStaff('GHOSPITAL', ['staff-1', 'staff-2'], 'activate');
      expect(api.post).toHaveBeenCalledWith('/hospital/staff/bulk', {
        hospitalAddress: 'GHOSPITAL',
        staffIds: ['staff-1', 'staff-2'],
        action: 'activate',
      });
      expect(res).toEqual(mockRes);
    });
  });

  describe('Response Interceptor & Error Normalization', () => {
    it('normalizes response errors into standard ApiError shape', async () => {
      // Test fulfilled handler
      const mockSuccessResponse = { data: { success: true } };
      expect(mockInterceptorFulfilled(mockSuccessResponse)).toBe(mockSuccessResponse);

      // Test error handler with server error payload
      const serverError = {
        response: {
          status: 404,
          data: { message: 'Patient not found' },
        },
        code: 'ERR_NOT_FOUND',
      };

      await expect(mockInterceptorRejected(serverError)).rejects.toEqual({
        message: 'Patient not found',
        status: 404,
        code: 'ERR_NOT_FOUND',
        data: { message: 'Patient not found' },
      });

      // Test error handler with generic fallback error
      const genericError = {
        message: 'Network Failure',
      };

      await expect(mockInterceptorRejected(genericError)).rejects.toEqual({
        message: 'Network Failure',
        status: 500,
        code: 'UNKNOWN_ERROR',
        data: null,
      });
    });
  });
});
