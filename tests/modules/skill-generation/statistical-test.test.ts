// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  twoProportionZ,
  fisherExact,
  compareProportions,
  normalCdf,
} from '../../../src/modules/skill-generation/statistical-test.js'

describe('normalCdf (sanity)', () => {
  it('has CDF(0) ≈ 0.5', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
  })

  it('has CDF(1.96) ≈ 0.975', () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3)
  })

  it('is symmetric: CDF(-x) ≈ 1 - CDF(x)', () => {
    for (const x of [0.5, 1.0, 1.5, 2.0, 2.5]) {
      expect(normalCdf(-x)).toBeCloseTo(1 - normalCdf(x), 6)
    }
  })
})

describe('twoProportionZ — known values', () => {
  it('p1=0.5, n1=100, p2=0.7, n2=100 → z≈2.89, p≈0.0039', () => {
    const r = twoProportionZ({ successes: 50, trials: 100 }, { successes: 70, trials: 100 })
    expect(r.method).toBe('two-proportion-z')
    expect(r.zScore).toBeCloseTo(2.887, 2)
    expect(r.pValue).toBeLessThan(0.01)
    expect(r.pValue).toBeGreaterThan(0.001)
    expect(r.diff).toBeCloseTo(0.2, 6)
  })

  it('identical proportions → z=0, p≈1', () => {
    const r = twoProportionZ({ successes: 50, trials: 100 }, { successes: 50, trials: 100 })
    expect(r.zScore).toBeCloseTo(0, 6)
    expect(r.pValue).toBeCloseTo(1, 3)
    expect(r.diff).toBe(0)
  })

  it('degenerate: both arms 100% success → diff=0, p=1', () => {
    const r = twoProportionZ({ successes: 5, trials: 5 }, { successes: 5, trials: 5 })
    expect(r.diff).toBe(0)
    expect(r.pValue).toBe(1)
  })

  it('zero trials → NaN p-value', () => {
    const r = twoProportionZ({ successes: 0, trials: 0 }, { successes: 1, trials: 5 })
    expect(Number.isNaN(r.pValue)).toBe(true)
  })

  it('larger improvement gives smaller p-value', () => {
    const small = twoProportionZ({ successes: 50, trials: 100 }, { successes: 55, trials: 100 })
    const big = twoProportionZ({ successes: 50, trials: 100 }, { successes: 80, trials: 100 })
    expect(big.pValue).toBeLessThan(small.pValue)
  })
})

describe("fisherExact — known 2x2 tables", () => {
  it('classical Fisher example (Agresti): successes [1,9]/[11,3] → p ≈ 0.00137', () => {
    // Table: arm A = 1 success / 9 failures; arm B = 11 successes / 3 failures.
    const r = fisherExact({ successes: 1, trials: 10 }, { successes: 11, trials: 14 })
    expect(r.method).toBe('fisher-exact')
    expect(r.pValue).toBeLessThan(0.01)
    expect(r.pValue).toBeGreaterThan(0)
  })

  it('symmetric case: 5/10 vs 5/10 → p=1', () => {
    const r = fisherExact({ successes: 5, trials: 10 }, { successes: 5, trials: 10 })
    expect(r.pValue).toBeCloseTo(1, 3)
  })

  it('extreme case: 0/5 vs 5/5 → p small', () => {
    const r = fisherExact({ successes: 0, trials: 5 }, { successes: 5, trials: 5 })
    expect(r.pValue).toBeLessThan(0.01)
  })

  it('p-value in [0, 1]', () => {
    for (const a of [1, 3, 5]) {
      for (const b of [1, 3, 5]) {
        const r = fisherExact({ successes: a, trials: 8 }, { successes: b, trials: 8 })
        expect(r.pValue).toBeGreaterThanOrEqual(0)
        expect(r.pValue).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('compareProportions dispatch', () => {
  it('uses z-test when both arms ≥ zTestMinN', () => {
    const r = compareProportions(
      { successes: 5, trials: 20 },
      { successes: 10, trials: 20 },
      10,
    )
    expect(r.method).toBe('two-proportion-z')
  })

  it('falls back to Fisher when an arm < zTestMinN', () => {
    const r = compareProportions(
      { successes: 2, trials: 5 },
      { successes: 4, trials: 5 },
      10,
    )
    expect(r.method).toBe('fisher-exact')
  })
})
