/* eslint-disable no-console -- command-line tool that reports to stdout/stderr */
/**
 * Circuit benchmark harness.
 *
 * For every `circuits/*.circom` it:
 *   1. compiles the circuit with circom (`--r1cs --wasm`),
 *   2. reads the R1CS and records constraints, wires and signal counts,
 *   3. (unless `--no-prove`) runs a Groth16 setup against the PSE Perpetual
 *      Powers of Tau and times `fullProve` (witness + proof) and `verify` on a
 *      known-good sample input,
 *   4. prints a markdown table (also written to `--markdown` and, on GitHub
 *      Actions, to the job summary),
 *   5. exits non-zero if any circuit's constraint count grew by more than
 *      `--threshold` (default 10%) over the baseline.
 *
 * The zkeys produced here come from a single-contributor phase 2 and are for
 * timing only — never ship them. Production artifacts come from `setup.sh`.
 *
 * Usage (from the repo root):
 *   npm --prefix circuits run benchmark -- [options]
 *
 * Options:
 *   --baseline <file>     JSON baseline to compare against: a baseline file or
 *                         a previous `--json` results file
 *                         (default: circuits/benchmark-baseline.json if present)
 *   --no-baseline         skip the regression check
 *   --update-baseline     write the measured counts to the baseline file
 *   --threshold <ratio>   allowed constraint growth, default 0.10
 *   --circuits <a,b>      only benchmark these circuits
 *   --circuits-dir <dir>  directory with the .circom sources (default: this dir)
 *   --no-prove            only compile and count constraints
 *   --runs <n>            proving runs per circuit (median reported), default 3
 *   --json <file>         write machine-readable results
 *   --markdown <file>     write the markdown report
 *                         (default: build/zk-bench/benchmark.md)
 *   --no-summary          do not append the report to $GITHUB_STEP_SUMMARY
 *
 * Environment: CIRCOM (circom binary, default `circom`), PTAU (use this
 * .ptau instead of downloading one), GITHUB_STEP_SUMMARY.
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { get } from 'node:https';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import * as snarkjs from 'snarkjs';
import { buildEddsa, buildPoseidon } from 'circomlibjs';

const CIRCUITS_DIR = __dirname;
// `npm --prefix circuits run …` changes into circuits/; resolve CLI paths from where it was invoked.
const CWD = process.env.INIT_CWD ?? process.cwd();
const resolveArg = (p: string) => path.resolve(CWD, p);
const ROOT = path.resolve(CIRCUITS_DIR, '..');
const PTAU_URL = (power: number) =>
  `https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_${String(power).padStart(2, '0')}.ptau`;

/* ── CLI ─────────────────────────────────────────────────────────── */

export interface Options {
  baseline: string | null;
  updateBaseline: boolean;
  threshold: number;
  only: string[] | null;
  circuitsDir: string;
  prove: boolean;
  runs: number;
  json: string | null;
  markdown: string;
  summary: boolean;
  buildDir: string;
}

export function parseArgs(argv: string[]): Options {
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  const defaultBaseline = path.join(CIRCUITS_DIR, 'benchmark-baseline.json');
  const threshold = Number(value('--threshold') ?? process.env.BENCH_REGRESSION_THRESHOLD ?? 0.1);
  const runs = Number(value('--runs') ?? 3);
  if (!(threshold >= 0)) throw new Error('--threshold must be a non-negative ratio');
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
  const baseline = argv.includes('--no-baseline')
    ? null
    : (value('--baseline') ?? (existsSync(defaultBaseline) ? defaultBaseline : null));
  const updateBaseline = argv.includes('--update-baseline');
  const buildDir = path.join(ROOT, 'build', 'zk-bench');
  return {
    baseline: baseline ? resolveArg(baseline) : updateBaseline ? defaultBaseline : null,
    updateBaseline,
    threshold,
    only:
      value('--circuits')
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? null,
    circuitsDir: resolveArg(value('--circuits-dir') ?? CIRCUITS_DIR),
    prove: !argv.includes('--no-prove'),
    runs,
    json: value('--json') ? resolveArg(value('--json')!) : null,
    markdown: resolveArg(value('--markdown') ?? path.join(buildDir, 'benchmark.md')),
    summary: !argv.includes('--no-summary'),
    buildDir,
  };
}

/* ── Sample inputs (must satisfy every constraint) ───────────────── */

type Input = Record<string, string | number | bigint>;
type Hash = (inputs: bigint[]) => bigint;

let hashers: { poseidon: Hash; eddsa: Awaited<ReturnType<typeof buildEddsa>> } | null = null;

async function primitives() {
  if (!hashers) {
    const poseidon = await buildPoseidon();
    const eddsa = await buildEddsa();
    hashers = { poseidon: (xs) => BigInt(poseidon.F.toString(poseidon(xs))), eddsa };
  }
  return hashers;
}

/** Signs `Poseidon(message)` with a fixed test key; returns public key and signature as strings. */
async function sign(message: bigint[]) {
  const { poseidon, eddsa } = await primitives();
  const priv = Buffer.from('42'.repeat(32), 'hex');
  const pub = eddsa.prv2pub(priv);
  const sig = eddsa.signPoseidon(priv, eddsa.F.e(poseidon(message)));
  const F = eddsa.F;
  return {
    Ax: F.toString(pub[0]),
    Ay: F.toString(pub[1]),
    R8x: F.toString(sig.R8[0]),
    R8y: F.toString(sig.R8[1]),
    S: sig.S.toString(),
  };
}

export const SAMPLE_INPUTS: Record<string, () => Promise<Input>> = {
  async age_eligibility() {
    const { poseidon } = await primitives();
    const birthDate = 19900517n;
    const salt = 123456789n;
    return { birthDate, salt, cutoffDate: 20081124, commitment: poseidon([birthDate, salt]) };
  },
  async insurance_coverage() {
    const { poseidon } = await primitives();
    const policyId = 987654321n;
    const expiryDate = 20291231n;
    const salt = 55n;
    return {
      policyId,
      expiryDate,
      salt,
      currentDate: 20261124,
      commitment: poseidon([policyId, expiryDate, salt]),
    };
  },
  async insurance_deductible() {
    const { poseidon } = await primitives();
    const policyId = 987654321n;
    const spend = 250_000n;
    const salt = 77n;
    return {
      policyId,
      spend,
      salt,
      deductible: 150_000,
      commitment: poseidon([policyId, spend, salt]),
    };
  },
  async prescription_dosage() {
    const { poseidon } = await primitives();
    const patientWeight = 70n;
    const salt = 99n;
    return {
      patientWeight,
      salt,
      dosage: 500,
      safeThreshold: 20,
      commitment: poseidon([patientWeight, salt]),
    };
  },
  async vaccine_verification() {
    const patientSecret = 1234567n;
    const vaccineCode = 1n;
    const validUntil = 20290101n;
    const s = await sign([patientSecret, vaccineCode, validUntil]);
    return {
      patientSecret,
      vaccineCode,
      validUntil,
      clinicAx: s.Ax,
      clinicAy: s.Ay,
      sigR8x: s.R8x,
      sigR8y: s.R8y,
      sigS: s.S,
      currentDate: 20261124,
      expectedClinicAx: s.Ax,
      expectedClinicAy: s.Ay,
      externalNullifier: 42,
    };
  },
  async clinician_credential() {
    const licenseId = 31415926535n;
    const specialtyCode = 207n;
    const expiryDate = 20280630n;
    const s = await sign([licenseId, specialtyCode, expiryDate]);
    return {
      specialtyCode,
      currentDate: 20261124,
      issuerAx: s.Ax,
      issuerAy: s.Ay,
      licenseId,
      expiryDate,
      sigR8x: s.R8x,
      sigR8y: s.R8y,
      sigS: s.S,
    };
  },
  async financial_hardship() {
    const { poseidon } = await primitives();
    const householdIncome = 30_000n;
    const householdSize = 4n;
    const salt = 2024n;
    return {
      householdIncome,
      householdSize,
      salt,
      guidelineBase: 15650,
      guidelinePerPerson: 5500,
      commitment: poseidon([householdIncome, householdSize, salt]),
    };
  },
};

/* ── Steps ───────────────────────────────────────────────────────── */

export interface Result {
  circuit: string;
  constraints: number;
  wires: number;
  privateInputs: number;
  publicInputs: number;
  outputs: number;
  compileMs: number;
  setupMs?: number;
  proveMs?: number;
  verifyMs?: number;
  note?: string;
}

export type Baseline = Record<string, { constraints: number; wires: number }>;

function circomLibDir(): string {
  // Directory that contains `circomlib/`, so `include "circomlib/circuits/…"` resolves.
  return path.resolve(path.dirname(require.resolve('circomlib/package.json')), '..');
}

function compile(source: string, outDir: string): number {
  const circom = process.env.CIRCOM || 'circom';
  const started = performance.now();
  const res = spawnSync(circom, [source, '--r1cs', '--wasm', '-l', circomLibDir(), '-o', outDir], {
    encoding: 'utf8',
  });
  if (res.error) {
    throw new Error(
      `Could not run circom (${circom}): ${res.error.message}. Install circom >= 2.1.6 or set CIRCOM.`,
    );
  }
  if (res.status !== 0) {
    throw new Error(`circom failed for ${path.basename(source)}:\n${res.stdout}\n${res.stderr}`);
  }
  return performance.now() - started;
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GET ${url}: HTTP ${res.statusCode}`));
        return;
      }
      const tmp = `${dest}.part`;
      const file = createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () =>
        file.close(() => {
          renameSync(tmp, dest);
          resolve();
        }),
      );
      file.on('error', reject);
    }).on('error', reject);
  });
}

/** Smallest power of two whose domain fits the circuit (Groth16 needs constraints + public + 1). */
export function ptauPower(r: Pick<Result, 'constraints' | 'publicInputs' | 'outputs'>): number {
  return Math.max(8, Math.ceil(Math.log2(r.constraints + r.publicInputs + r.outputs + 1)));
}

async function ptauFor(power: number, dir: string): Promise<string> {
  if (process.env.PTAU) return resolveArg(process.env.PTAU);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ppot_0080_${String(power).padStart(2, '0')}.ptau`);
  if (!existsSync(file)) {
    console.log(`Downloading Powers of Tau 2^${power}…`);
    await download(PTAU_URL(power), file);
  }
  return file;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

async function benchmarkProof(result: Result, outDir: string, opts: Options): Promise<void> {
  const sample = SAMPLE_INPUTS[result.circuit];
  if (!sample) {
    result.note = 'no sample input; add one to SAMPLE_INPUTS in circuits/benchmark.ts';
    return;
  }
  const ptau = await ptauFor(ptauPower(result), path.join(opts.buildDir, 'ptau'));
  const r1cs = path.join(outDir, `${result.circuit}.r1cs`);
  const wasm = path.join(outDir, `${result.circuit}_js`, `${result.circuit}.wasm`);
  const zkey = path.join(outDir, `${result.circuit}.bench.zkey`);

  let t = performance.now();
  await snarkjs.zKey.newZKey(r1cs, ptau, zkey);
  result.setupMs = performance.now() - t;
  const vkey = await snarkjs.zKey.exportVerificationKey(zkey);

  const input = await sample();
  const prove: number[] = [];
  const verify: number[] = [];
  for (let i = 0; i < opts.runs; i++) {
    t = performance.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
    prove.push(performance.now() - t);
    t = performance.now();
    const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    verify.push(performance.now() - t);
    if (!ok) throw new Error(`${result.circuit}: sample proof did not verify`);
  }
  result.proveMs = median(prove);
  result.verifyMs = median(verify);
}

/* ── Report ──────────────────────────────────────────────────────── */

export interface Comparison {
  circuit: string;
  before: number | null;
  after: number;
  ratio: number | null;
  regressed: boolean;
}

export function compare(
  results: Result[],
  baseline: Baseline | null,
  threshold: number,
): Comparison[] {
  return results.map((r) => {
    const before = baseline?.[r.circuit]?.constraints ?? null;
    const ratio = before ? (r.constraints - before) / before : null;
    return {
      circuit: r.circuit,
      before,
      after: r.constraints,
      ratio,
      regressed: ratio !== null && ratio > threshold,
    };
  });
}

const ms = (v?: number) =>
  v === undefined ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(0)} ms`;
const pct = (v: number | null) =>
  v === null ? 'new' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const fmt = (n: number) => n.toLocaleString('en-US');

export function markdown(
  results: Result[],
  cmp: Comparison[],
  opts: Pick<Options, 'prove' | 'runs' | 'baseline' | 'threshold'>,
): string {
  const lines = [
    '## ZK circuit benchmarks',
    '',
    '| Circuit | Constraints | Δ vs baseline | Wires | Private in | Public in | Outputs | Compile | Prove (median) | Verify |',
    '|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|',
  ];
  for (const r of results) {
    const c = cmp.find((x) => x.circuit === r.circuit)!;
    const delta = `${pct(c.ratio)}${c.regressed ? ' ❌' : ''}`;
    lines.push(
      `| \`${r.circuit}\` | ${fmt(r.constraints)} | ${delta} | ${fmt(r.wires)} | ${r.privateInputs} | ${r.publicInputs} | ${r.outputs} | ${ms(r.compileMs)} | ${ms(r.proveMs)} | ${ms(r.verifyMs)} |`,
    );
  }
  const total = results.reduce((a, r) => ({ c: a.c + r.constraints, w: a.w + r.wires }), {
    c: 0,
    w: 0,
  });
  lines.push(`| **Total** | **${fmt(total.c)}** | | **${fmt(total.w)}** | | | | | | |`, '');
  if (opts.prove) {
    lines.push(
      `Prove = \`groth16.fullProve\` (witness + proof), median of ${opts.runs} run(s) on ${process.platform}/${process.arch}, Node ${process.version}.`,
    );
  }
  lines.push(
    opts.baseline
      ? `Constraint growth above ${(opts.threshold * 100).toFixed(0)}% over \`${path.relative(ROOT, opts.baseline)}\` fails the run.`
      : 'No baseline: regression check skipped.',
  );
  const notes = results.filter((r) => r.note);
  if (notes.length) {
    lines.push('', ...notes.map((r) => `- \`${r.circuit}\`: ${r.note}`));
  }
  return `${lines.join('\n')}\n`;
}

/* ── Main ────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = path.join(opts.buildDir, 'circuits');
  mkdirSync(outDir, { recursive: true });

  const circuits = readdirSync(opts.circuitsDir)
    .filter((f) => f.endsWith('.circom'))
    .map((f) => f.replace(/\.circom$/, ''))
    .filter((c) => !opts.only || opts.only.includes(c))
    .sort();
  if (circuits.length === 0) throw new Error(`No circuits found in ${opts.circuitsDir}`);

  const results: Result[] = [];
  for (const circuit of circuits) {
    console.log(`▶ ${circuit}`);
    const compileMs = compile(path.join(opts.circuitsDir, `${circuit}.circom`), outDir);
    const info = await snarkjs.r1cs.info(path.join(outDir, `${circuit}.r1cs`));
    const result: Result = {
      circuit,
      constraints: info.nConstraints,
      wires: info.nVars,
      privateInputs: info.nPrvInputs,
      publicInputs: info.nPubInputs,
      outputs: info.nOutputs,
      compileMs,
    };
    if (opts.prove) await benchmarkProof(result, outDir, opts);
    console.log(
      `  ${fmt(result.constraints)} constraints, ${fmt(result.wires)} wires${result.proveMs ? `, prove ${ms(result.proveMs)}` : ''}`,
    );
    results.push(result);
  }

  let baseline: Baseline | null = null;
  if (opts.baseline && existsSync(opts.baseline) && !opts.updateBaseline) {
    baseline = JSON.parse(readFileSync(opts.baseline, 'utf8')) as Baseline;
  } else if (opts.baseline && !opts.updateBaseline) {
    console.warn(`Baseline ${opts.baseline} not found: regression check skipped.`);
    opts.baseline = null;
  }

  const cmp = compare(results, baseline, opts.threshold);
  const report = markdown(results, cmp, opts);
  console.log(`\n${report}`);

  mkdirSync(path.dirname(opts.markdown), { recursive: true });
  writeFileSync(opts.markdown, report);
  if (opts.summary && process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  if (opts.json) {
    mkdirSync(path.dirname(opts.json), { recursive: true });
    writeFileSync(
      opts.json,
      `${JSON.stringify(Object.fromEntries(results.map((r) => [r.circuit, r])), null, 2)}\n`,
    );
  }

  if (opts.updateBaseline && opts.baseline) {
    const next: Baseline = Object.fromEntries(
      results.map((r) => [r.circuit, { constraints: r.constraints, wires: r.wires }]),
    );
    writeFileSync(opts.baseline, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Baseline written to ${path.relative(ROOT, opts.baseline)}`);
    return;
  }

  const regressions = cmp.filter((c) => c.regressed);
  if (regressions.length) {
    for (const r of regressions) {
      console.error(
        `::error title=Constraint regression::${r.circuit}: ${fmt(r.before!)} → ${fmt(r.after)} constraints (${pct(r.ratio)}, limit +${(opts.threshold * 100).toFixed(0)}%)`,
      );
    }
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main()
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    // snarkjs keeps worker threads alive; exit explicitly once done.
    .finally(() => process.exit(process.exitCode ?? 0));
}
