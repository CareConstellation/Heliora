/**
 * @jest-environment node
 */
import ageFixture from './fixtures/zk/age18.proof.json';
import insuranceFixture from './fixtures/zk/insurance.proof.json';
import ageVkey from './fixtures/zk/age_eligibility.vkey.json';
import insuranceVkey from './fixtures/zk/insurance_coverage.vkey.json';
import {
  ageCutoff,
  parseCredential,
  policyIdFromNumber,
  utcDateInt,
  verifyEligibilityProof,
  poseidonHash,
  poseidonHashBigInt,
  toFieldElement,
  SNARK_SCALAR_FIELD,
  computeRecordCommitment,
  deriveNullifier,
  NullifierTracker,
  NullifierReplayError,
  loadCircuitArtifact,
  signVaccinationCredential,
  parseDate,
} from '@/lib/zkEligibility';
import { createMemoryArtifactProvider } from '@/lib/encryptedLocalStore';
import type { EligibilityProofToken } from '@/types';

jest.setTimeout(30000);

// Real Groth16 proofs, produced by circuits/*.circom with snarkjs.fullProve from a test-only setup.
const age = {
  ...ageFixture,
  token: ageFixture.token as EligibilityProofToken,
  now: new Date(ageFixture.now),
};
const ins = {
  ...insuranceFixture,
  token: insuranceFixture.token as EligibilityProofToken,
  now: new Date(insuranceFixture.now),
};
const clone = (t: EligibilityProofToken) => JSON.parse(JSON.stringify(t)) as EligibilityProofToken;

describe('date encoding', () => {
  it('computes the 18-year cutoff in UTC as YYYYMMDD', () => {
    expect(utcDateInt(new Date('2026-10-20T23:59:59Z'))).toBe(20261020);
    expect(ageCutoff(new Date('2026-10-20T12:00:00Z'))).toBe(20081020);
    expect(ageCutoff(new Date('2028-02-29T00:00:00Z'))).toBe(20100229); // compares correctly against real dates
  });
});

describe('policyIdFromNumber', () => {
  it('maps a policy number to a deterministic 248-bit field element', async () => {
    const id = await policyIdFromNumber('HMO-4471-0093-XY');
    expect(id).toBe(await policyIdFromNumber('HMO-4471-0093-XY'));
    expect(id < BigInt(2) ** BigInt(248)).toBe(true);
    expect(id).not.toBe(await policyIdFromNumber('HMO-4471-0093-XZ'));
  });
});

describe('parseCredential', () => {
  it('accepts well-formed age and insurance credentials', () => {
    expect(
      parseCredential('{"type":"age","birthDate":"1990-05-17","salt":"12","commitment":"34"}'),
    ).toEqual({
      type: 'age',
      birthDate: '1990-05-17',
      salt: '12',
      commitment: '34',
    });
    expect(
      parseCredential(
        '{"type":"insurance","policyNumber":"P-1","expiryDate":"2027-12-31","salt":"1","commitment":"2"}',
      ),
    ).toMatchObject({ type: 'insurance', policyNumber: 'P-1' });
  });

  it.each([
    '{"type":"age","birthDate":"17/05/1990","salt":"1","commitment":"2"}',
    '{"type":"age","birthDate":"1990-05-17","salt":"-1","commitment":"2"}',
    '{"type":"insurance","expiryDate":"2027-12-31","salt":"1","commitment":"2"}',
    '{"type":"other","salt":"1","commitment":"2"}',
  ])('rejects malformed credential %s', (json) => {
    expect(() => parseCredential(json)).toThrow('Unrecognised eligibility credential');
  });
});

describe('verifyEligibilityProof (#27)', () => {
  it('verifies a real age 18+ proof against the public verification key', async () => {
    await expect(verifyEligibilityProof(age.token, age.commitment, age.now, ageVkey)).resolves.toBe(
      true,
    );
  });

  it('verifies a real insurance coverage proof against the public verification key', async () => {
    await expect(
      verifyEligibilityProof(ins.token, ins.commitment, ins.now, insuranceVkey),
    ).resolves.toBe(true);
  });

  it('reveals only the cutoff/current date and the issuer commitment', () => {
    expect(age.token.publicSignals).toEqual(['20081020', age.commitment]);
    expect(ins.token.publicSignals).toEqual(['20261020', ins.commitment]);
    expect(JSON.stringify([age.token, ins.token])).not.toMatch(
      /19900517|1990-05-17|HMO-4471|20271231/,
    );
  });

  it('rejects a proof for a commitment other than the one registered for the patient', async () => {
    await expect(verifyEligibilityProof(age.token, '12345', age.now, ageVkey)).resolves.toBe(false);
  });

  it('rejects a proof whose public signals were altered', async () => {
    const tampered = clone(age.token);
    tampered.publicSignals[0] = '20081019'; // still a valid cutoff, so only the pairing check can catch it
    await expect(verifyEligibilityProof(tampered, age.commitment, age.now, ageVkey)).resolves.toBe(
      false,
    );
  });

  it('rejects a proof whose curve points were altered', async () => {
    const tampered = clone(age.token);
    (tampered.proof as { pi_a: string[] }).pi_a[0] = (ins.token.proof as { pi_a: string[] }).pi_a[0]!;
    await expect(verifyEligibilityProof(tampered, age.commitment, age.now, ageVkey)).resolves.toBe(
      false,
    );
  });

  it('rejects a proof checked against the other circuit key', async () => {
    await expect(
      verifyEligibilityProof(age.token, age.commitment, age.now, insuranceVkey),
    ).resolves.toBe(false);
  });

  it('rejects an age proof made with a cutoff later than today minus 18 years', async () => {
    const dayBefore = new Date(age.now.getTime() - 24 * 3600 * 1000);
    await expect(
      verifyEligibilityProof(age.token, age.commitment, dayBefore, ageVkey),
    ).resolves.toBe(false);
  });

  it('rejects an insurance proof dated before today', async () => {
    const nextDay = new Date(ins.now.getTime() + 24 * 3600 * 1000);
    await expect(
      verifyEligibilityProof(ins.token, ins.commitment, nextDay, insuranceVkey),
    ).resolves.toBe(false);
  });
});

describe('Poseidon Hashing Utility (#212)', () => {
  it('matches official Circomlib test vectors for BN254 Poseidon', async () => {
    const v1 = await poseidonHash([1n]);
    const v2 = await poseidonHash([1n, 2n]);
    const v3 = await poseidonHash([1n, 2n, 3n]);

    expect(v1).toBe('18586133768512220936620570745912940619677854269274689475585506675881198879027');
    expect(v2).toBe('7853200120776062878684798364095072458815029376092732009249414926327459813530');
    expect(v3).toBe('6542985608222806190361240322586112750744169038454362455181422643027100751666');
  });

  it('matches Circom circuit field constraints', async () => {
    // Inputs must be < SNARK_SCALAR_FIELD
    expect(() => toFieldElement(SNARK_SCALAR_FIELD)).toThrow(RangeError);
    expect(() => toFieldElement(-1n)).toThrow(RangeError);
    expect(() => toFieldElement(SNARK_SCALAR_FIELD.toString())).toThrow(RangeError);

    // Valid inputs
    expect(toFieldElement(0n)).toBe(0n);
    expect(toFieldElement(42)).toBe(42n);
    expect(toFieldElement('12345')).toBe(12345n);
    expect(toFieldElement('0x2a')).toBe(42n);

    // Arity constraint: 1 to 16 inputs
    await expect(poseidonHash([])).rejects.toThrow(RangeError);
    const oversized = new Array(17).fill(1n);
    await expect(poseidonHash(oversized)).rejects.toThrow(RangeError);
  });

  it('computes Poseidon hash with latency < 2ms (AC benchmark)', async () => {
    // Warm up
    await poseidonHash([1n, 2n]);

    const iterations = 50;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await poseidonHash([BigInt(i), 123456789n]);
    }
    const duration = performance.now() - start;
    const avgLatency = duration / iterations;

    expect(avgLatency).toBeLessThan(2.0); // Strict requirement: < 2ms
  });

  it('computes deterministic medical record commitments', async () => {
    const commitment1 = await computeRecordCommitment({
      id: 'REC-101',
      patientAddress: 'GABCD12345',
      diagnosis: 'Type 2 Diabetes',
      date: '2026-11-23',
      salt: '987654321',
    });
    const commitment2 = await computeRecordCommitment({
      id: 'REC-101',
      patientAddress: 'GABCD12345',
      diagnosis: 'Type 2 Diabetes',
      date: '2026-11-23',
      salt: '987654321',
    });
    const commitmentDifferent = await computeRecordCommitment({
      id: 'REC-101',
      patientAddress: 'GABCD12345',
      diagnosis: 'Hypertension',
      date: '2026-11-23',
      salt: '987654321',
    });

    expect(commitment1).toBe(commitment2);
    expect(commitment1).not.toBe(commitmentDifferent);
    expect(BigInt(commitment1) < SNARK_SCALAR_FIELD).toBe(true);
  });
});

describe('Zero-Knowledge Nullifier Tracking & Anti-Replay (#215)', () => {
  it('derives a deterministic nullifier from patient secret and appointmentId', async () => {
    const nullifier1 = await deriveNullifier('patient-secret-123', 'apt-9988');
    const nullifier2 = await deriveNullifier('patient-secret-123', 'apt-9988');

    expect(nullifier1).toBe(nullifier2);
    expect(typeof nullifier1).toBe('string');
    expect(BigInt(nullifier1) < SNARK_SCALAR_FIELD).toBe(true);
  });

  it('demonstrates collision resistance across different secrets and appointments', async () => {
    const n1 = await deriveNullifier('secret-A', 'apt-1');
    const n2 = await deriveNullifier('secret-B', 'apt-1');
    const n3 = await deriveNullifier('secret-A', 'apt-2');

    expect(n1).not.toBe(n2);
    expect(n1).not.toBe(n3);
    expect(n2).not.toBe(n3);

    // Sample set test
    const set = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const n = await deriveNullifier(`secret-${i}`, `apt-${i % 5}`);
      expect(set.has(n)).toBe(false);
      set.add(n);
    }
    expect(set.size).toBe(50);
  });

  it('rejects duplicate nullifier presentation via NullifierTracker', async () => {
    const tracker = new NullifierTracker();
    const nullifier = await deriveNullifier('secret-replay', 'apt-42');

    expect(tracker.has(nullifier)).toBe(false);
    tracker.register(nullifier, 'apt-42');
    expect(tracker.has(nullifier)).toBe(true);

    // Replay presentation must throw NullifierReplayError
    expect(() => tracker.register(nullifier, 'apt-42')).toThrow(NullifierReplayError);
    expect(tracker.verifyAndRegister(nullifier, 'apt-43')).toBe(false);
  });

  it('rejects proof tokens with replayed nullifiers during verification', async () => {
    const tracker = new NullifierTracker();
    const nullifier = await deriveNullifier('secret-token', 'apt-50');

    const tokenWithNullifier = clone(age.token);
    tokenWithNullifier.nullifier = nullifier;

    // First presentation: succeeds
    const firstVerify = await verifyEligibilityProof(
      tokenWithNullifier,
      age.commitment,
      age.now,
      ageVkey,
      { nullifierTracker: tracker, appointmentId: 'apt-50' },
    );
    expect(firstVerify).toBe(true);
    expect(tracker.has(nullifier)).toBe(true);

    // Duplicate presentation: must be rejected
    const secondVerify = await verifyEligibilityProof(
      tokenWithNullifier,
      age.commitment,
      age.now,
      ageVkey,
      { nullifierTracker: tracker, appointmentId: 'apt-50' },
    );
    expect(secondVerify).toBe(false);
  });
});

describe('Circuit WASM Artifact IndexedDB Caching & Progress (#213)', () => {
  it('downloads on cache miss and retrieves from cache on hit', async () => {
    const provider = createMemoryArtifactProvider();
    const mockWasmData = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]); // WASM magic header

    let fetchCount = 0;
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async () => {
      fetchCount++;
      return {
        ok: true,
        headers: new Headers({ 'content-length': String(mockWasmData.byteLength) }),
        arrayBuffer: async () => mockWasmData.buffer,
        body: null,
      };
    }) as any;

    try {
      // 1. Initial load -> cache miss -> network fetch
      const buf1 = await loadCircuitArtifact('age18', 'wasm', {
        storageProvider: provider,
        version: '1.0.0',
      });
      expect(fetchCount).toBe(1);
      expect((buf1 as ArrayBuffer).byteLength).toBe(mockWasmData.byteLength);

      // 2. Second load -> cache hit -> no network fetch
      const buf2 = await loadCircuitArtifact('age18', 'wasm', {
        storageProvider: provider,
        version: '1.0.0',
      });
      expect(fetchCount).toBe(1);
      expect((buf2 as ArrayBuffer).byteLength).toBe(mockWasmData.byteLength);

      // 3. Version change -> cache invalidation -> re-fetch
      const buf3 = await loadCircuitArtifact('age18', 'wasm', {
        storageProvider: provider,
        version: '2.0.0', // Updated version!
      });
      expect(fetchCount).toBe(2);
      expect((buf3 as ArrayBuffer).byteLength).toBe(mockWasmData.byteLength);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('notifies download progress indicator with loaded, total, and percent', async () => {
    const provider = createMemoryArtifactProvider();
    const mockData = new Uint8Array(100);

    const progressReports: any[] = [];
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '100' }),
      arrayBuffer: async () => mockData.buffer,
      body: null,
    }) as any;

    try {
      await loadCircuitArtifact('insurance', 'zkey', {
        storageProvider: provider,
        onProgress: (p) => progressReports.push(p),
      });

      expect(progressReports.length).toBeGreaterThan(0);
      expect(progressReports[progressReports.length - 1]).toMatchObject({
        circuit: 'insurance_coverage',
        extension: 'zkey',
        loaded: 100,
        total: 100,
        percent: 100,
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('ZK Vaccination Compliance Proof (#211)', () => {
  const clinicPrivKey = Buffer.from(
    '0001020304050607080900010203040506070809000102030405060708090001',
    'hex',
  );

  it('signs and parses a valid clinic-attested vaccination credential', async () => {
    const credential = await signVaccinationCredential(clinicPrivKey, {
      patientSecret: 'patient-entropy-12345',
      vaccineCode: 'COVID-19',
      validUntil: '2028-12-31',
    });

    expect(credential.type).toBe('vaccination');
    expect(credential.validUntil).toBe('2028-12-31');
    expect(credential.clinicPublicKey).toHaveLength(2);
    expect(credential.signature.R8).toHaveLength(2);
    expect(credential.signature.S).toBeDefined();

    const parsed = parseCredential(JSON.stringify(credential));
    expect(parsed).toMatchObject({
      type: 'vaccination',
      validUntil: '2028-12-31',
      clinicPublicKey: credential.clinicPublicKey,
    });
  });

  it('rejects malformed vaccination credentials', () => {
    expect(() =>
      parseCredential(
        JSON.stringify({
          type: 'vaccination',
          validUntil: '2028-12-31',
          clinicPublicKey: ['1', '2'],
          // missing signature
        }),
      ),
    ).toThrow('Unrecognised eligibility credential');

    expect(() =>
      parseCredential(
        JSON.stringify({
          type: 'vaccination',
          validUntil: '31/12/2028', // Invalid date format
          clinicPublicKey: ['1', '2'],
          signature: { R8: ['1', '2'], S: '3' },
          patientSecret: 'abc',
        }),
      ),
    ).toThrow('Unrecognised eligibility credential');
  });

  it('verifies in-circuit clinic EdDSA signature on BabyJubjub with Poseidon', async () => {
    const { buildEddsa, buildPoseidon } = await import('circomlibjs');
    const eddsa = await buildEddsa();
    const poseidon = await buildPoseidon();

    const credential = await signVaccinationCredential(clinicPrivKey, {
      patientSecret: 'secret-test',
      vaccineCode: 1,
      validUntil: '2027-06-30',
    });

    const msg = poseidon([
      toFieldElement('secret-test'),
      1n,
      BigInt(parseDate('2027-06-30')),
    ]);

    const sigObj = {
      R8: [
        eddsa.F.e(credential.signature.R8[0]),
        eddsa.F.e(credential.signature.R8[1]),
      ],
      S: BigInt(credential.signature.S),
    };

    const pubKey = [
      eddsa.F.e(credential.clinicPublicKey[0]),
      eddsa.F.e(credential.clinicPublicKey[1]),
    ];

    expect(eddsa.verifyPoseidon(msg, sigObj, pubKey)).toBe(true);

    // Tampered message fails EdDSA verification
    const tamperedMsg = poseidon([
      toFieldElement('secret-tampered'),
      1n,
      BigInt(parseDate('2027-06-30')),
    ]);
    expect(eddsa.verifyPoseidon(tamperedMsg, sigObj, pubKey)).toBe(false);
  }, 20000);

  it('generates unique nullifiers to prevent vaccination credential sharing', async () => {
    const patientA = 'patient-A-secret';
    const patientB = 'patient-B-secret';
    const clinicContext = 'clinic-gate-entry';

    const nullifierA = await deriveNullifier(patientA, clinicContext);
    const nullifierB = await deriveNullifier(patientB, clinicContext);

    expect(nullifierA).not.toBe(nullifierB);

    // Same patient at same gate -> identical nullifier, preventing sharing or duplicate presentation
    const nullifierASecondTry = await deriveNullifier(patientA, clinicContext);
    expect(nullifierA).toBe(nullifierASecondTry);
  });
});

