import type { MedicalRecord } from '@/types';

export interface FHIRValidationError {
  field: string;
  message: string;
  lineNumber?: number;
}

export interface FHIRResource {
  resourceType: string;
  id?: string;
  [key: string]: unknown;
}

export interface FHIRBundle {
  resourceType: 'Bundle';
  type: 'document';
  timestamp: string;
  entry: Array<{
    fullUrl?: string;
    resource: FHIRResource;
  }>;
}

const FHIR_R4_REQUIRED_FIELDS = {
  DiagnosticReport: ['resourceType', 'status', 'code', 'subject', 'effectiveDateTime'],
  Observation: ['resourceType', 'status', 'code', 'subject', 'effectiveDateTime', 'value'],
  Condition: ['resourceType', 'clinicalStatus', 'verificationStatus', 'code', 'subject'],
};

const VALID_STATUSES = {
  DiagnosticReport: ['registered', 'partial', 'preliminary', 'final', 'amended', 'corrected', 'appended', 'cancelled', 'entered-in-error'],
  Observation: ['registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered-in-error', 'unknown'],
  Condition: ['active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved'],
};

export function validateFHIRResource(
  resource: Record<string, unknown>,
  resourceType: 'DiagnosticReport' | 'Observation' | 'Condition',
): FHIRValidationError[] {
  const errors: FHIRValidationError[] = [];

  if (resource.resourceType !== resourceType) {
    errors.push({
      field: 'resourceType',
      message: `Expected resourceType "${resourceType}", got "${resource.resourceType}"`,
    });
  }

  const requiredFields = FHIR_R4_REQUIRED_FIELDS[resourceType] || [];
  for (const field of requiredFields) {
    if (!resource[field]) {
      errors.push({
        field,
        message: `Required field "${field}" is missing or empty`,
      });
    }
  }

  if (resource.status) {
    const validStatuses = VALID_STATUSES[resourceType] || [];
    if (!validStatuses.includes(resource.status as string)) {
      errors.push({
        field: 'status',
        message: `Invalid status "${resource.status}". Valid values: ${validStatuses.join(', ')}`,
      });
    }
  }

  if (resourceType === 'Observation' && resource.value) {
    const value = resource.value as Record<string, unknown>;
    if (typeof value === 'object' && !('valueQuantity' in value) && !('valueCodeableConcept' in value)) {
      errors.push({
        field: 'value',
        message: 'Value must be either a Quantity or CodeableConcept',
      });
    }
  }

  return errors;
}

export function validateFHIRBundle(bundle: Record<string, unknown>): FHIRValidationError[] {
  const errors: FHIRValidationError[] = [];

  if (bundle.resourceType !== 'Bundle') {
    errors.push({
      field: 'resourceType',
      message: 'Expected resourceType "Bundle"',
    });
  }

  if (bundle.type !== 'document') {
    errors.push({
      field: 'type',
      message: 'Bundle type must be "document"',
    });
  }

  const entries = (bundle.entry as Array<Record<string, unknown>>) || [];
  if (entries.length === 0) {
    errors.push({
      field: 'entry',
      message: 'Bundle must contain at least one entry',
    });
  }

  entries.forEach((entry, idx) => {
    const resource = (entry.resource as Record<string, unknown>) || {};
    const resourceType = (resource.resourceType as string) || 'Unknown';

    if (!resource.resourceType) {
      errors.push({
        field: `entry[${idx}].resource`,
        message: 'Resource is missing resourceType',
        lineNumber: idx + 1,
      });
      return;
    }

    if (['DiagnosticReport', 'Observation', 'Condition'].includes(resourceType)) {
      const resourceErrors = validateFHIRResource(
        resource,
        resourceType as 'DiagnosticReport' | 'Observation' | 'Condition',
      );
      resourceErrors.forEach((err) => {
        errors.push({
          ...err,
          field: `entry[${idx}].${err.field}`,
          lineNumber: idx + 1,
        });
      });
    }
  });

  return errors;
}

export function convertRecordToFHIRObservation(record: MedicalRecord): FHIRResource {
  return {
    resourceType: 'Observation',
    id: record.id,
    status: 'final',
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '11557-6',
          display: 'Fasting glucose [Mass/volume] in blood',
        },
      ],
      text: record.diagnosis,
    },
    subject: {
      reference: `Patient/${record.patientAddress}`,
    },
    effectiveDateTime: record.date,
    performer: [
      {
        reference: `Practitioner/${record.doctorName}`,
        display: record.doctorName,
      },
    ],
    note: record.notes
      ? [
          {
            text: record.notes,
          },
        ]
      : [],
  };
}

export function convertRecordsToFHIRBundle(records: MedicalRecord[]): FHIRBundle {
  const entries = records.map((record) => ({
    fullUrl: `urn:uuid:${record.id}`,
    resource: convertRecordToFHIRObservation(record),
  }));

  return {
    resourceType: 'Bundle',
    type: 'document',
    timestamp: new Date().toISOString(),
    entry: entries,
  };
}

export function exportFHIRBundle(bundle: FHIRBundle): string {
  return JSON.stringify(bundle, null, 2);
}
