import { xdr } from '@stellar/stellar-sdk';
import * as Sentry from '@sentry/nextjs';
import {
  extractContractErrorCode,
  getContractErrorMessage,
  decodeSimulationError,
  SorobanContractError,
  CONTRACT_ERROR_NAME_MAP,
} from '@/lib/sorobanRpc';
import { SorobanContractErrorCode } from '@/types';

jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
}));

describe('Soroban RPC Contract Error Decoding (#191)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('extractContractErrorCode', () => {
    it('extracts contract error code from results XDR', () => {
      const errVal = xdr.ScVal.scvError(xdr.ScError.sceContract(1001));
      const sim = {
        results: [
          {
            auth: [],
            xdr: errVal.toXDR('base64'),
          },
        ],
      };

      const code = extractContractErrorCode(sim);
      expect(code).toBe(1001);
    });

    it('extracts contract error code from diagnostic events XDR (ScVal in topics)', () => {
      const errVal = xdr.ScVal.scvError(xdr.ScError.sceContract(1002));
      const diag = new xdr.DiagnosticEvent({
        inSuccessfulContractCall: false,
        event: new xdr.ContractEvent({
          ext: new xdr.ExtensionPoint(0),
          contractId: null,
          type: xdr.ContractEventType.diagnostic(),
          body: new xdr.ContractEventBody(
            0,
            new xdr.ContractEventV0({
              topics: [xdr.ScVal.scvSymbol('error'), errVal],
              data: xdr.ScVal.scvVoid(),
            }),
          ),
        }),
      });

      const sim = {
        events: [diag.toXDR('base64')],
      };

      const code = extractContractErrorCode(sim);
      expect(code).toBe(1002);
    });

    it('extracts contract error code from diagnostic events data field', () => {
      const errVal = xdr.ScVal.scvError(xdr.ScError.sceContract(1005));
      const diag = new xdr.DiagnosticEvent({
        inSuccessfulContractCall: false,
        event: new xdr.ContractEvent({
          ext: new xdr.ExtensionPoint(0),
          contractId: null,
          type: xdr.ContractEventType.diagnostic(),
          body: new xdr.ContractEventBody(
            0,
            new xdr.ContractEventV0({
              topics: [xdr.ScVal.scvSymbol('core_metrics')],
              data: errVal,
            }),
          ),
        }),
      });

      const sim = {
        diagnosticEventsXdr: [diag.toXDR('base64')],
      };

      const code = extractContractErrorCode(sim);
      expect(code).toBe(1005);
    });

    it('extracts contract error code from Error(Contract, #N) simulation error string', () => {
      const sim = {
        error: 'HostError: Error(Contract, #1001) in contract C123 at function call',
      };

      const code = extractContractErrorCode(sim);
      expect(code).toBe(1001);
    });

    it('extracts contract error code from ScErrorContract(N) string pattern', () => {
      const sim = {
        error: 'transaction simulation failed: ScErrorContract(1002)',
      };

      const code = extractContractErrorCode(sim);
      expect(code).toBe(1002);
    });

    it('returns null when no contract error is present', () => {
      const sim = {
        error: 'CPU budget exceeded',
        results: [],
        events: [],
      };

      expect(extractContractErrorCode(sim)).toBeNull();
      expect(extractContractErrorCode(null)).toBeNull();
      expect(extractContractErrorCode(undefined)).toBeNull();
    });
  });

  describe('Contract Error Mapping & Localized Strings', () => {
    it('maps UnauthorizedDoctor and ExpiredLicense codes correctly', () => {
      expect(CONTRACT_ERROR_NAME_MAP[1001]).toBe('UnauthorizedDoctor');
      expect(CONTRACT_ERROR_NAME_MAP[1002]).toBe('ExpiredLicense');
      expect(CONTRACT_ERROR_NAME_MAP[1]).toBe('UnauthorizedDoctor');
      expect(CONTRACT_ERROR_NAME_MAP[2]).toBe('ExpiredLicense');
    });

    it('returns localized English strings', () => {
      const msgDoctor = getContractErrorMessage(SorobanContractErrorCode.UnauthorizedDoctor, 'en');
      expect(msgDoctor).toContain('Doctor is unauthorized');

      const msgLicense = getContractErrorMessage(SorobanContractErrorCode.ExpiredLicense, 'en');
      expect(msgLicense).toContain('license has expired');
    });

    it('returns localized Spanish strings', () => {
      const msgDoctorEs = getContractErrorMessage(SorobanContractErrorCode.UnauthorizedDoctor, 'es');
      expect(msgDoctorEs).toContain('El médico no está autorizado');

      const msgLicenseEs = getContractErrorMessage(SorobanContractErrorCode.ExpiredLicense, 'es');
      expect(msgLicenseEs).toContain('licencia médica');
    });

    it('returns localized French strings', () => {
      const msgDoctorFr = getContractErrorMessage(SorobanContractErrorCode.UnauthorizedDoctor, 'fr');
      expect(msgDoctorFr).toContain('Le médecin n\'est pas autorisé');

      const msgLicenseFr = getContractErrorMessage(SorobanContractErrorCode.ExpiredLicense, 'fr');
      expect(msgLicenseFr).toContain('licence médicale');
    });

    it('falls back gracefully on unknown error codes', () => {
      const msgUnknown = getContractErrorMessage(9999, 'en');
      expect(msgUnknown).toContain('#9999');
    });
  });

  describe('Sentry Integration & decodeSimulationError', () => {
    it('decodes simulation error, creates DecodedContractError and records Sentry breadcrumb', () => {
      const errVal = xdr.ScVal.scvError(xdr.ScError.sceContract(1001));
      const sim = {
        results: [{ xdr: errVal.toXDR('base64') }],
        error: 'transaction simulation failed: host invocation failed: Error(Contract, #1001)',
      };

      const decoded = decodeSimulationError(sim, 'en', {
        recordBreadcrumb: true,
        contractId: 'CCONTR123',
      });

      expect(decoded).not.toBeNull();
      expect(decoded?.code).toBe(1001);
      expect(decoded?.name).toBe('UnauthorizedDoctor');
      expect(decoded?.contractId).toBe('CCONTR123');
      expect(decoded?.message).toContain('Doctor is unauthorized');

      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'soroban.contract_error',
          level: 'error',
          data: expect.objectContaining({
            code: 1001,
            name: 'UnauthorizedDoctor',
            contractId: 'CCONTR123',
          }),
        }),
      );
    });

    it('returns null when simulation has no contract error and does not record breadcrumb', () => {
      const sim = { success: true };
      const decoded = decodeSimulationError(sim);

      expect(decoded).toBeNull();
      expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
    });

    it('SorobanContractError instantiates with decoded contract properties', () => {
      const decoded = {
        code: 1002,
        name: 'ExpiredLicense',
        message: 'Doctor medical license has expired or has been revoked.',
        contractId: 'CEXP999',
        rawError: 'Error(Contract, #1002)',
      };

      const customError = new SorobanContractError(decoded);
      expect(customError).toBeInstanceOf(Error);
      expect(customError.name).toBe('SorobanContractError');
      expect(customError.code).toBe(1002);
      expect(customError.errorName).toBe('ExpiredLicense');
      expect(customError.contractId).toBe('CEXP999');
      expect(customError.rawError).toBe('Error(Contract, #1002)');
      expect(customError.message).toBe(decoded.message);
    });
  });
});
