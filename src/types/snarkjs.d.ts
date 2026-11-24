// Minimal typings for the snarkjs Groth16 API used here (snarkjs ships no type declarations).
declare module 'snarkjs' {
  export interface Groth16Proof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: 'groth16';
    curve: string;
  }

  export const groth16: {
    fullProve(
      // Signal values (decimal strings, numbers, bigints, or nested arrays of them).
      input: Record<string, unknown>,
      // Path/URL of the artifact, or its bytes.
      wasmFile: string | Uint8Array,
      zkeyFile: string | Uint8Array,
    ): Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
    verify(verificationKey: object, publicSignals: string[], proof: Groth16Proof): Promise<boolean>;
  };

  /** Used by `circuits/benchmark.ts`. */
  export const r1cs: {
    info(
      r1csFile: string,
      logger?: unknown,
    ): Promise<{
      nConstraints: number;
      nVars: number;
      nPrvInputs: number;
      nPubInputs: number;
      nOutputs: number;
      nLabels: number;
    }>;
  };

  /** Used by `circuits/benchmark.ts`. */
  export const zKey: {
    newZKey(r1csFile: string, ptauFile: string, zkeyFile: string, logger?: unknown): Promise<unknown>;
    exportVerificationKey(zkeyFile: string, logger?: unknown): Promise<object>;
  };
}
