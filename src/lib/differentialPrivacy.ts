/**
 * Laplace-mechanism differential privacy noise for small aggregate buckets
 * (issue #40). Epsilon-budget tracking per session and admin warnings are
 * not covered here - this is just the noise/suppression primitive.
 */
export function laplaceNoise(sensitivity: number, epsilon: number): number {
  const scale = sensitivity / epsilon;
  const u = Math.random() - 0.5;
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

/** Applies DP noise to a count, suppressing counts below the k-anonymity floor. */
export function privatizeCount(trueCount: number, epsilon: number, minBucketSize = 5): number | null {
  if (trueCount < minBucketSize) return null;
  return Math.max(0, Math.round(trueCount + laplaceNoise(1, epsilon)));
}
