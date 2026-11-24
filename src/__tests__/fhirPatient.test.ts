/**
 * @jest-environment node
 */
import {
  fhirPatientToHeliora,
  helioraToFhirPatient,
  parseFHIRPatient,
  validateFHIRPatient,
} from '@/lib/fhirValidator';
import type { FHIRPatient, HelioraPatient } from '@/types';

/** Official HL7 FHIR R4 Patient sample (adapted from hl7.org/fhir/R4/patient-example.json). */
const HL7_R4_SAMPLE_PATIENT: FHIRPatient = {
  resourceType: 'Patient',
  id: 'example',
  text: {
    status: 'generated',
    div: '<div xmlns="http://www.w3.org/1999/xhtml">Peter James Chalmers</div>',
  },
  identifier: [
    {
      use: 'usual',
      type: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
            code: 'MR',
          },
        ],
      },
      system: 'urn:oid:1.2.36.146.595.217.0.1',
      value: '12345',
    },
  ],
  active: true,
  name: [
    {
      use: 'official',
      family: 'Chalmers',
      given: ['Peter', 'James'],
    },
    {
      use: 'usual',
      given: ['Jim'],
    },
  ],
  telecom: [
    { system: 'phone', value: '(03) 5555 6473', use: 'work', rank: 1 },
    { system: 'email', value: 'peter.chalmers@example.org', use: 'home' },
  ],
  gender: 'male',
  birthDate: '1974-12-25',
  deceasedBoolean: false,
  address: [
    {
      use: 'home',
      type: 'both',
      text: '534 Erewhon St PeasantVille, Rainbow, Vic 3999',
      line: ['534 Erewhon St'],
      city: 'PleasantVille',
      district: 'Rainbow',
      state: 'Vic',
      postalCode: '3999',
    },
  ],
  maritalStatus: {
    coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-MaritalStatus', code: 'M', display: 'Married' }],
  },
  communication: [
    {
      language: {
        coding: [{ system: 'urn:ietf:bcp:47', code: 'en', display: 'English' }],
        text: 'English',
      },
      preferred: true,
    },
  ],
};

describe('HL7 FHIR R4 Patient parser and bidirectional converter (#274)', () => {
  it('validates an official HL7 FHIR R4 Patient sample', () => {
    const result = validateFHIRPatient(HL7_R4_SAMPLE_PATIENT);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.data?.id).toBe('example');
  });

  it('parses a serialized FHIR R4 Patient JSON string', () => {
    const parsed = parseFHIRPatient(JSON.stringify(HL7_R4_SAMPLE_PATIENT));
    expect(parsed.resourceType).toBe('Patient');
    expect(parsed.birthDate).toBe('1974-12-25');
  });

  it('rejects invalid resourceType, gender, and birthDate format', () => {
    const result = validateFHIRPatient({
      resourceType: 'Observation',
      gender: 'invalid-gender',
      birthDate: '25/12/1974',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'resourceType')).toBe(true);
    expect(result.errors.some((e) => e.field === 'gender')).toBe(true);
    expect(result.errors.some((e) => e.field === 'birthDate')).toBe(true);
  });

  it('converts HL7 R4 Patient to HelioraPatient', () => {
    const heliora = fhirPatientToHeliora(HL7_R4_SAMPLE_PATIENT);

    expect(heliora).toMatchObject({
      id: 'example',
      walletAddress: '12345',
      firstName: 'Peter',
      lastName: 'Chalmers',
      fullName: 'Peter James Chalmers',
      birthDate: '1974-12-25',
      gender: 'male',
      active: true,
      phone: '(03) 5555 6473',
      email: 'peter.chalmers@example.org',
      maritalStatus: 'Married',
      preferredLanguage: 'English',
      address: {
        line: ['534 Erewhon St'],
        city: 'PleasantVille',
        state: 'Vic',
        postalCode: '3999',
      },
    });
  });

  it('performs lossless round-trip conversion HelioraPatient -> FHIRPatient -> HelioraPatient', () => {
    const input: HelioraPatient = {
      id: 'pat-001',
      walletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      firstName: 'Ada',
      lastName: 'Lovelace',
      birthDate: '1990-04-12',
      gender: 'female',
      active: true,
      phone: '+1-555-0199',
      email: 'ada@heliora.health',
      address: {
        line: ['10 Downing St'],
        city: 'London',
        postalCode: 'SW1A 2AA',
        country: 'UK',
      },
      maritalStatus: 'Single',
      preferredLanguage: 'English',
    };

    const fhir = helioraToFhirPatient(input);
    expect(validateFHIRPatient(fhir).valid).toBe(true);
    expect(fhir.resourceType).toBe('Patient');
    expect(fhir.identifier?.[0]?.system).toBe('urn:heliora:stellar');

    const roundTrip = fhirPatientToHeliora(fhir);
    expect(roundTrip).toEqual({
      ...input,
      fullName: 'Ada Lovelace',
    });
  });
});
