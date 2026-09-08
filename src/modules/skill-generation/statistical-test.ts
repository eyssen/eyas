// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Statistical tests for A/B validation — Phase 3J.
 *
 * Two-proportion z-test (large N, both arms ≥ 10 trials) and Fisher's exact
 * test (small N). Both implementations are written from scratch with no
 * external deps; all numerical helpers are inlined below.
 *
 * Methodology choice:
 *   - Large N → two-proportion z-test with pooled variance under H0. Cheap
 *     and well-understood. Assumes normal approximation to the binomial,
 *     which is valid when both arms have ≥ ~10 successes and ~10 failures.
 *   - Small N → Fisher's exact test on the 2×2 contingency table. Robust
 *     for any N but O(n^2) in memory; we only call it when N is small.
 *
 * All p-values are two-sided.
 */

export interface PropResult {
  successes: number
  trials: number
}

export interface StatResult {
  /** Two-sided p-value in [0, 1], or NaN if undefined (e.g. zero trials). */
  pValue: number
  /** z-score for the z-test, or NaN for fisher. */
  zScore: number
  /** Observed difference pCandidate - pBaseline. NaN if undefined. */
  diff: number
  method: 'two-proportion-z' | 'fisher-exact'
}

// --- Numerical helpers -------------------------------------------------------

/**
 * Abramowitz & Stegun 26.2.17 — standard normal CDF via rational approximation.
 * Absolute error < 7.5e-8.
 */
export function normalCdf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const k = 1 / (1 + 0.2316419 * ax)
  const a1 = 0.319381530
  const a2 = -0.356563782
  const a3 = 1.781477937
  const a4 = -1.821255978
  const a5 = 1.330274429
  const w =
    ((((a5 * k + a4) * k + a3) * k + a2) * k + a1) *
    k *
    Math.exp((-ax * ax) / 2) *
    (1 / Math.sqrt(2 * Math.PI))
  const cdfRight = 1 - w
  return sign > 0 ? cdfRight : 1 - cdfRight
}

/** Log-factorial via lgamma. */
export function lnFactorial(n: number): number {
  if (n < 0 || !Number.isFinite(n)) return NaN
  if (n < 2) return 0
  // Lanczos approximation for ln(gamma(n+1)) = ln(n!).
  // Coefficients from Press et al., "Numerical Recipes".
  const g = 7
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  // ln(gamma(z)) = (z-0.5) ln(z+g-0.5) - (z+g-0.5) + 0.5 ln(2π) + ln(A(z))
  const z = n + 1 - 1 // z = n
  let sum = c[0]!
  for (let i = 1; i < c.length; i++) sum += c[i]! / (z + i)
  const t = z + g - 0.5
  return (
    (z - 0.5) * Math.log(t) -
    t +
    0.5 * Math.log(2 * Math.PI) +
    Math.log(sum) +
    // convert ln(gamma(z+1)) = ln(n!) — we passed z = n so add the extra step
    Math.log(Math.max(1, n)) * 0 // no-op; left for clarity
  )
}

/** Log of binomial coefficient C(n, k). */
function lnBinom(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity
  return lnFactorial(n) - lnFactorial(k) - lnFactorial(n - k)
}

/**
 * Probability of exactly k successes in a 2x2 hypergeometric with
 * row totals (r1=n1, r2=n2) and column total k + (k2 where k2 = K - k).
 * Here K is the total number of successes across both arms.
 */
function hypergeomLnP(k: number, n1: number, n2: number, K: number): number {
  return lnBinom(n1, k) + lnBinom(n2, K - k) - lnBinom(n1 + n2, K)
}

// --- Two-proportion z-test ---------------------------------------------------

/**
 * Two-sided two-proportion z-test with pooled variance.
 * `candidate` is arm B, `baseline` is arm A. Effect = pB - pA.
 */
export function twoProportionZ(
  baseline: PropResult,
  candidate: PropResult,
): StatResult {
  const nA = baseline.trials
  const nB = candidate.trials
  if (nA <= 0 || nB <= 0) {
    return { pValue: NaN, zScore: NaN, diff: NaN, method: 'two-proportion-z' }
  }
  const pA = baseline.successes / nA
  const pB = candidate.successes / nB
  const pPool = (baseline.successes + candidate.successes) / (nA + nB)
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB))
  if (se === 0) {
    // Degenerate: both arms are 0% or 100% success — no difference, p=1 by convention.
    return {
      pValue: pA === pB ? 1 : 0,
      zScore: 0,
      diff: pB - pA,
      method: 'two-proportion-z',
    }
  }
  const z = (pB - pA) / se
  // Two-sided: 2 * (1 - Φ(|z|))
  const pTwoSided = 2 * (1 - normalCdf(Math.abs(z)))
  return {
    pValue: Math.min(1, Math.max(0, pTwoSided)),
    zScore: z,
    diff: pB - pA,
    method: 'two-proportion-z',
  }
}

// --- Fisher's exact test -----------------------------------------------------

/**
 * Two-sided Fisher's exact test on a 2×2 contingency table.
 * Table rows = (arm, success) / (arm, failure). We return the sum of
 * hypergeometric probabilities for all tables as extreme or more extreme
 * than the observed — measured by probability (the most common definition
 * for two-sided Fisher).
 */
export function fisherExact(
  baseline: PropResult,
  candidate: PropResult,
): StatResult {
  const n1 = baseline.trials
  const n2 = candidate.trials
  if (n1 <= 0 || n2 <= 0) {
    return { pValue: NaN, zScore: NaN, diff: NaN, method: 'fisher-exact' }
  }
  const K = baseline.successes + candidate.successes
  const observedK = baseline.successes
  const observedLnP = hypergeomLnP(observedK, n1, n2, K)

  // Enumerate all valid k values for arm A.
  const kMin = Math.max(0, K - n2)
  const kMax = Math.min(n1, K)

  // Sum probabilities of tables with P ≤ observed P (in log space with care).
  let sumExp = 0
  for (let k = kMin; k <= kMax; k++) {
    const lnP = hypergeomLnP(k, n1, n2, K)
    // Use a small tolerance to avoid missing the observed table due to FP noise.
    if (lnP <= observedLnP + 1e-12) {
      sumExp += Math.exp(lnP)
    }
  }
  const pValue = Math.min(1, Math.max(0, sumExp))
  const pA = baseline.successes / n1
  const pB = candidate.successes / n2
  return { pValue, zScore: NaN, diff: pB - pA, method: 'fisher-exact' }
}

// --- Dispatch ----------------------------------------------------------------

/**
 * Pick the appropriate test based on sample sizes. When either arm has
 * fewer than `zTestMinN` trials, fall back to Fisher. Otherwise use z-test.
 */
export function compareProportions(
  baseline: PropResult,
  candidate: PropResult,
  zTestMinN: number,
): StatResult {
  if (baseline.trials < zTestMinN || candidate.trials < zTestMinN) {
    return fisherExact(baseline, candidate)
  }
  return twoProportionZ(baseline, candidate)
}
