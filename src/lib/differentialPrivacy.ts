/**
 * Laplace-mechanism differential privacy noise for small aggregate buckets
 * (issue #40). Epsilon-budget tracking per session and admin warnings are
 * not covered here - this is just the noise/suppression primitive.
 */
function secureUnitRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) / 4294967296; // [0, 1)
}

export function laplaceNoise(sensitivity: number, epsilon: number): number {
  if (!Number.isFinite(epsilon) || epsilon <= 0) {
    throw new Error("epsilon must be finite and greater than 0");
  }
  const scale = sensitivity / epsilon;
  const u = secureUnitRandom() - 0.5;
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

/** Applies DP noise to a count, suppressing noisy results below the k-anonymity floor. */
export function privatizeCount(trueCount: number, epsilon: number, minBucketSize = 5): number | null {
  const noisy = Math.max(0, Math.round(trueCount + laplaceNoise(1, epsilon)));
  return noisy < minBucketSize ? null : noisy;
}
