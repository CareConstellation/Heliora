/**
 * Laplace-mechanism differential privacy noise for small aggregate buckets
 * (issue #40). Epsilon-budget tracking per session and admin warnings are
 * not covered here - this is just the noise/suppression primitive.
 */
export interface EpsilonBudget {
  totalEpsilon: number;
  consumedEpsilon: number;
  remainingEpsilon: number;
  isExhausted: boolean;
}

export function createEpsilonBudget(totalEpsilon: number): EpsilonBudget {
  return {
    totalEpsilon,
    consumedEpsilon: 0,
    remainingEpsilon: totalEpsilon,
    isExhausted: false,
  };
}

/** Consumes epsilon from the budget, throws if exhausted. */
export function consumeEpsilon(budget: EpsilonBudget, epsilon: number): void {
  if (budget.isExhausted) {
    throw new Error('Differential privacy budget exhausted.');
  }
  if (epsilon <= 0) throw new Error('epsilon must be positive');
  budget.consumedEpsilon += epsilon;
  budget.remainingEpsilon -= epsilon;
  if (budget.remainingEpsilon <= 0) {
    budget.isExhausted = true;
  }
}

/**
 * Generate Laplace mechanism noise scaled by sensitivity and epsilon.
 * Consumes epsilon from the budget if provided.
 */
export function laplaceNoise(
  sensitivity: number,
  epsilon: number,
  budget?: EpsilonBudget,
): number {
  if (!Number.isFinite(epsilon) || epsilon <= 0) {
    throw new Error("epsilon must be finite and greater than 0");
  }
  if (budget) {
    consumeEpsilon(budget, epsilon);
  }
  const scale = sensitivity / epsilon;
  const u = secureUnitRandom() - 0.5;
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

/** Internal secure random - uses crypto.getRandomValues. */
function secureUnitRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) / 4294967296; // [0, 1)
}

/** Applies DP noise to a count, suppressing noisy results below the k-anonymity floor. */
export function privatizeCount(
  trueCount: number,
  epsilon: number,
  minBucketSize = 5,
  budget?: EpsilonBudget,
): number | null {
  const noisy = Math.max(0, Math.round(trueCount + laplaceNoise(1, epsilon, budget)));
  return noisy < minBucketSize ? null : noisy;
}
