/**
 * @jest-environment node
 *
 * Issue #222 — circuit benchmark harness (circuits/benchmark.ts).
 * Compiling and proving needs circom and runs in CI; these tests cover the
 * regression gate, report and sample inputs without it.
 */
import fs from 'fs';
import path from 'path';
import {
  SAMPLE_INPUTS,
  compare,
  markdown,
  parseArgs,
  ptauPower,
  type Result,
} from '../../circuits/benchmark';

jest.setTimeout(30000);

const CIRCUITS_DIR = path.resolve(__dirname, '../../circuits');
const circuits = fs
  .readdirSync(CIRCUITS_DIR)
  .filter((f) => f.endsWith('.circom'))
  .map((f) => f.replace(/\.circom$/, ''));

const result = (circuit: string, constraints: number): Result => ({
  circuit,
  constraints,
  wires: constraints + 10,
  privateInputs: 2,
  publicInputs: 2,
  outputs: 0,
  compileMs: 120,
  proveMs: 850,
  verifyMs: 12,
});

describe('regression gate', () => {
  const baseline = { a: { constraints: 1000, wires: 1010 }, b: { constraints: 1000, wires: 1010 } };

  it('allows growth up to the threshold and fails above it', () => {
    const cmp = compare([result('a', 1100), result('b', 1101)], baseline, 0.1);
    expect(cmp.map((c) => c.regressed)).toEqual([false, true]);
    expect(cmp[1]!.ratio).toBeCloseTo(0.101);
  });

  it('never fails on reductions or circuits missing from the baseline', () => {
    const cmp = compare([result('a', 400), result('new', 99999)], baseline, 0.1);
    expect(cmp.every((c) => !c.regressed)).toBe(true);
    expect(cmp[1]!.before).toBeNull();
  });

  it('skips the gate without a baseline', () => {
    expect(compare([result('a', 99999)], null, 0.1)[0]!.regressed).toBe(false);
  });
});

describe('markdown report', () => {
  it('renders a row per circuit with totals and regression markers', () => {
    const results = [result('age_eligibility', 1000), result('financial_hardship', 1500)];
    const cmp = compare(results, { age_eligibility: { constraints: 800, wires: 0 } }, 0.1);
    const md = markdown(results, cmp, {
      prove: true,
      runs: 3,
      baseline: path.resolve(CIRCUITS_DIR, 'benchmark-baseline.json'),
      threshold: 0.1,
    });
    expect(md).toContain('| Circuit | Constraints | Δ vs baseline | Wires |');
    expect(md).toContain('| `age_eligibility` | 1,000 | +25.0% ❌ | 1,010 |');
    expect(md).toContain('| `financial_hardship` | 1,500 | new |');
    expect(md).toContain('| 850 ms | 12 ms |');
    expect(md).toContain('| **Total** | **2,500** |');
    expect(md).toContain('median of 3 run(s)');
  });
});

describe('powers of tau sizing', () => {
  it('picks the smallest sufficient power, at least 2^8', () => {
    expect(ptauPower({ constraints: 10, publicInputs: 2, outputs: 0 })).toBe(8);
    expect(ptauPower({ constraints: 4600, publicInputs: 4, outputs: 1 })).toBe(13);
    expect(ptauPower({ constraints: 8191, publicInputs: 0, outputs: 0 })).toBe(13);
    expect(ptauPower({ constraints: 8192, publicInputs: 0, outputs: 0 })).toBe(14);
  });
});

describe('CLI options', () => {
  it('parses flags and defaults the threshold to 10%', () => {
    const opts = parseArgs(['--no-prove', '--circuits', 'a, b', '--runs', '5']);
    expect(opts).toMatchObject({ prove: false, only: ['a', 'b'], runs: 5, threshold: 0.1 });
    expect(parseArgs(['--threshold', '0.25']).threshold).toBe(0.25);
    expect(() => parseArgs(['--runs', '0'])).toThrow();
    expect(() => parseArgs(['--baseline'])).toThrow(/needs a value/);
  });
});

describe('sample inputs', () => {
  it('has a sample input for every circuit', () => {
    expect(Object.keys(SAMPLE_INPUTS).sort()).toEqual([...circuits].sort());
  });

  it.each(circuits)('%s sample matches the circuit signal inputs exactly', async (circuit) => {
    const code = fs.readFileSync(path.join(CIRCUITS_DIR, `${circuit}.circom`), 'utf8');
    const declared = [...code.matchAll(/signal input (\w+);/g)].map((m) => m[1]).sort();
    const input = await SAMPLE_INPUTS[circuit]!();
    expect(Object.keys(input).sort()).toEqual(declared);
  });

  it('signs EdDSA samples with a valid signature', async () => {
    const { buildEddsa, buildPoseidon } = await import('circomlibjs');
    const eddsa = await buildEddsa();
    const poseidon = await buildPoseidon();
    const c = await SAMPLE_INPUTS.clinician_credential!();
    const n = (key: string) => BigInt(c[key]!);
    const msg = poseidon([n('licenseId'), n('specialtyCode'), n('expiryDate')]);
    expect(
      eddsa.verifyPoseidon(
        msg,
        { R8: [eddsa.F.e(n('sigR8x')), eddsa.F.e(n('sigR8y'))], S: n('sigS') },
        [eddsa.F.e(n('issuerAx')), eddsa.F.e(n('issuerAy'))],
      ),
    ).toBe(true);
  });
});
