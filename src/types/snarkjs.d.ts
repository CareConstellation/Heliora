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
      input: Record<string, string | number | bigint>,
      wasmFile: string,
      zkeyFile: string,
    ): Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
    verify(verificationKey: object, publicSignals: string[], proof: Groth16Proof): Promise<boolean>;
  };
}
