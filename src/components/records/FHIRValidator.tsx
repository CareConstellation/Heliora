'use client';

import { useState } from 'react';
import { AlertCircle, CheckCircle, Download } from 'lucide-react';
import type { FHIRValidationError } from '@/lib/fhirValidator';
import { validateFHIRBundle, convertRecordsToFHIRBundle, exportFHIRBundle } from '@/lib/fhirValidator';
import type { MedicalRecord } from '@/types';

interface FHIRValidatorProps {
  records: MedicalRecord[];
  onValidationComplete?: (isValid: boolean, errors: FHIRValidationError[]) => void;
}

export function FHIRValidator({ records, onValidationComplete }: FHIRValidatorProps) {
  const [validationErrors, setValidationErrors] = useState<FHIRValidationError[]>([]);
  const [isValid, setIsValid] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  const handleValidate = async () => {
    setIsValidating(true);
    try {
      const bundle = convertRecordsToFHIRBundle(records);
      const errors = validateFHIRBundle(bundle as unknown as Record<string, unknown>);

      setValidationErrors(errors);
      const valid = errors.length === 0;
      setIsValid(valid);
      onValidationComplete?.(valid, errors);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Validation failed';
      setValidationErrors([{ field: 'bundle', message: errorMsg }]);
      setIsValid(false);
      onValidationComplete?.(false, [{ field: 'bundle', message: errorMsg }]);
    } finally {
      setIsValidating(false);
    }
  };

  const handleExport = () => {
    try {
      const bundle = convertRecordsToFHIRBundle(records);
      const jsonString = exportFHIRBundle(bundle);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `fhir-bundle-${new Date().getTime()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">FHIR R4 Validation</h3>
        <button
          onClick={handleValidate}
          disabled={isValidating || records.length === 0}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:bg-gray-400"
        >
          {isValidating ? 'Validating...' : 'Validate Records'}
        </button>
      </div>

      {isValid && (
        <div className="flex items-start gap-3 rounded bg-green-50 p-3 dark:bg-green-900/20">
          <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
          <div>
            <p className="font-medium text-green-900 dark:text-green-100">All records are FHIR R4 compliant</p>
            <p className="text-sm text-green-700 dark:text-green-200">{records.length} records validated successfully</p>
            <button
              onClick={handleExport}
              className="mt-2 inline-flex items-center gap-2 text-sm text-green-600 hover:text-green-700 dark:text-green-400"
            >
              <Download className="h-4 w-4" />
              Export FHIR Bundle
            </button>
          </div>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-start gap-3 rounded bg-red-50 p-3 dark:bg-red-900/20">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <div>
              <p className="font-medium text-red-900 dark:text-red-100">Validation errors found</p>
              <p className="text-sm text-red-700 dark:text-red-200">{validationErrors.length} issue(s) detected</p>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto space-y-2">
            {validationErrors.map((error, idx) => (
              <div key={idx} className="rounded bg-gray-50 p-3 text-sm dark:bg-gray-800">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono font-medium text-gray-900 dark:text-gray-100">{error.field}</p>
                    <p className="mt-1 text-gray-600 dark:text-gray-400">{error.message}</p>
                  </div>
                  {error.lineNumber && (
                    <span className="ml-2 whitespace-nowrap rounded bg-gray-200 px-2 py-1 text-xs font-mono dark:bg-gray-700">
                      Line {error.lineNumber}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
