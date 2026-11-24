import { z } from 'zod';
import type { FHIRPatient, HelioraPatient, MedicalRecord } from '@/types';

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

/* ─── HL7 FHIR R4 Patient Schemas & Bidirectional Converters (#274) ─── */

export const HELIORA_STELLAR_SYSTEM = 'urn:heliora:stellar';

const FHIR_DATE_REGEX = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

export const FHIRCodingSchema = z.object({
  system: z.string().optional(),
  code: z.string().min(1).optional(),
  display: z.string().optional(),
});

export const FHIRCodeableConceptSchema = z.object({
  coding: z.array(FHIRCodingSchema).optional(),
  text: z.string().optional(),
});

export const FHIRIdentifierSchema = z.object({
  use: z.enum(['usual', 'official', 'temp', 'secondary', 'old']).optional(),
  system: z.string().optional(),
  value: z.string().optional(),
  type: FHIRCodeableConceptSchema.optional(),
});

export const FHIRHumanNameSchema = z.object({
  use: z.enum(['usual', 'official', 'temp', 'nickname', 'anonymous', 'old', 'maiden']).optional(),
  text: z.string().optional(),
  family: z.string().optional(),
  given: z.array(z.string()).optional(),
  prefix: z.array(z.string()).optional(),
  suffix: z.array(z.string()).optional(),
});

export const FHIRContactPointSchema = z.object({
  system: z.enum(['phone', 'fax', 'email', 'pager', 'url', 'sms', 'other']).optional(),
  value: z.string().optional(),
  use: z.enum(['home', 'work', 'temp', 'old', 'mobile']).optional(),
  rank: z.number().int().positive().optional(),
});

export const FHIRAddressSchema = z.object({
  use: z.enum(['home', 'work', 'temp', 'old', 'billing']).optional(),
  type: z.enum(['postal', 'physical', 'both']).optional(),
  text: z.string().optional(),
  line: z.array(z.string()).optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
});

export const FHIRPatientSchema = z
  .object({
    resourceType: z.literal('Patient'),
    id: z.string().min(1).optional(),
    active: z.boolean().optional(),
    identifier: z.array(FHIRIdentifierSchema).optional(),
    name: z.array(FHIRHumanNameSchema).optional(),
    telecom: z.array(FHIRContactPointSchema).optional(),
    gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
    birthDate: z
      .string()
      .regex(FHIR_DATE_REGEX, 'birthDate must follow FHIR R4 date format (YYYY, YYYY-MM, or YYYY-MM-DD)')
      .optional(),
    deceasedBoolean: z.boolean().optional(),
    deceasedDateTime: z.string().optional(),
    address: z.array(FHIRAddressSchema).optional(),
    maritalStatus: FHIRCodeableConceptSchema.optional(),
    communication: z
      .array(
        z.object({
          language: FHIRCodeableConceptSchema,
          preferred: z.boolean().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

export const HelioraPatientSchema = z.object({
  id: z.string().min(1),
  walletAddress: z.string().min(1).optional(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string().optional(),
  birthDate: z.string().regex(FHIR_DATE_REGEX).optional(),
  gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
  active: z.boolean().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z
    .object({
      line: z.array(z.string()).optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),
  maritalStatus: z.string().optional(),
  preferredLanguage: z.string().optional(),
});

export interface FHIRPatientValidationResult {
  valid: boolean;
  data?: FHIRPatient;
  errors: FHIRValidationError[];
}

/** Validates an unknown object against the HL7 FHIR R4 Patient schema. */
export function validateFHIRPatient(resource: unknown): FHIRPatientValidationResult {
  const result = FHIRPatientSchema.safeParse(resource);
  if (result.success) {
    return { valid: true, data: result.data as FHIRPatient, errors: [] };
  }
  const errors: FHIRValidationError[] = result.error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : 'root',
    message: issue.message,
  }));
  return { valid: false, errors };
}

/** Parses a JSON string or object into a validated HL7 FHIR R4 Patient resource. */
export function parseFHIRPatient(input: string | Record<string, unknown>): FHIRPatient {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  const validation = validateFHIRPatient(raw);
  if (!validation.valid || !validation.data) {
    const summary = validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
    throw new Error(`Invalid HL7 FHIR R4 Patient resource: ${summary}`);
  }
  return validation.data;
}

/** Converts an HL7 FHIR R4 Patient resource into a HelioraPatient model. */
export function fhirPatientToHeliora(fhirPatient: FHIRPatient): HelioraPatient {
  const parsed = parseFHIRPatient(fhirPatient);

  const preferredName =
    parsed.name?.find((n) => n.use === 'official') ??
    parsed.name?.find((n) => n.use === 'usual') ??
    parsed.name?.[0];

  const firstName = preferredName?.given?.[0] ?? '';
  const lastName = preferredName?.family ?? '';
  const fullName =
    preferredName?.text ?? ([...((preferredName?.given ?? [])), lastName].filter(Boolean).join(' ') || undefined);

  const stellarIdentifier = parsed.identifier?.find((id) => id.system === HELIORA_STELLAR_SYSTEM);
  const fallbackIdentifier = parsed.identifier?.[0];
  const walletAddress = stellarIdentifier?.value ?? fallbackIdentifier?.value;

  const phone = parsed.telecom?.find((t) => t.system === 'phone')?.value;
  const email = parsed.telecom?.find((t) => t.system === 'email')?.value;

  const primaryAddr = parsed.address?.find((a) => a.use === 'home') ?? parsed.address?.[0];
  const address = primaryAddr
    ? {
        ...(primaryAddr.line ? { line: primaryAddr.line } : {}),
        ...(primaryAddr.city ? { city: primaryAddr.city } : {}),
        ...(primaryAddr.state ? { state: primaryAddr.state } : {}),
        ...(primaryAddr.postalCode ? { postalCode: primaryAddr.postalCode } : {}),
        ...(primaryAddr.country ? { country: primaryAddr.country } : {}),
      }
    : undefined;

  const maritalStatus =
    parsed.maritalStatus?.text ??
    parsed.maritalStatus?.coding?.[0]?.display ??
    parsed.maritalStatus?.coding?.[0]?.code;

  const preferredComm =
    parsed.communication?.find((c) => c.preferred) ?? parsed.communication?.[0];
  const preferredLanguage =
    preferredComm?.language.text ??
    preferredComm?.language.coding?.[0]?.display ??
    preferredComm?.language.coding?.[0]?.code;

  return {
    id: parsed.id ?? walletAddress ?? 'unknown',
    ...(walletAddress ? { walletAddress } : {}),
    firstName,
    lastName,
    ...(fullName ? { fullName } : {}),
    ...(parsed.birthDate ? { birthDate: parsed.birthDate } : {}),
    ...(parsed.gender ? { gender: parsed.gender } : {}),
    ...(parsed.active !== undefined ? { active: parsed.active } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(address && Object.keys(address).length > 0 ? { address } : {}),
    ...(maritalStatus ? { maritalStatus } : {}),
    ...(preferredLanguage ? { preferredLanguage } : {}),
  };
}

/** Converts a HelioraPatient model into an HL7 FHIR R4 Patient resource. */
export function helioraToFhirPatient(patient: HelioraPatient): FHIRPatient {
  const validated = HelioraPatientSchema.parse(patient);

  const telecom: FHIRPatient['telecom'] = [];
  if (validated.phone) {
    telecom.push({ system: 'phone', value: validated.phone, use: 'mobile' });
  }
  if (validated.email) {
    telecom.push({ system: 'email', value: validated.email, use: 'home' });
  }

  const fullName =
    validated.fullName ?? ([validated.firstName, validated.lastName].filter(Boolean).join(' ') || undefined);

  const fhir: FHIRPatient = {
    resourceType: 'Patient',
    id: validated.id,
    active: validated.active ?? true,
    ...(validated.walletAddress
      ? {
          identifier: [
            {
              use: 'official',
              system: HELIORA_STELLAR_SYSTEM,
              value: validated.walletAddress,
            },
          ],
        }
      : {}),
    name: [
      {
        use: 'official',
        family: validated.lastName,
        given: validated.firstName ? [validated.firstName] : [],
        ...(fullName ? { text: fullName } : {}),
      },
    ],
    ...(telecom.length > 0 ? { telecom } : {}),
    ...(validated.gender ? { gender: validated.gender } : {}),
    ...(validated.birthDate ? { birthDate: validated.birthDate } : {}),
    ...(validated.address
      ? {
          address: [
            {
              use: 'home',
              ...validated.address,
            },
          ],
        }
      : {}),
    ...(validated.maritalStatus
      ? {
          maritalStatus: {
            text: validated.maritalStatus,
          },
        }
      : {}),
    ...(validated.preferredLanguage
      ? {
          communication: [
            {
              language: { text: validated.preferredLanguage },
              preferred: true,
            },
          ],
        }
      : {}),
  };

  return fhir;
}
