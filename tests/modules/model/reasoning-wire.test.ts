// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// levelToBudget — the one level → thinking-budget translation shared by the
// resolver and every budget-driven provider (Anthropic budget models, Gemini 2.5).

import { describe, it, expect } from 'vitest'
import { ANSWER_HEADROOM_TOKENS, BUDGET_RATIO, levelToBudget, type BudgetLevel } from '@modules/model/reasoning-wire'
import { resolveEffortPlan } from '@modules/model/reasoning/resolve'
import { createReasoningRegistry, loadBundledOverlay } from '@modules/model/reasoning/registry'

const RUNGS: BudgetLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']

describe('levelToBudget (positive)', () => {
  it('is monotonic in the level for a given range and cap', () => {
    for (const cap of [8192, 21_333, 64_000, 128_000]) {
      const budgets = RUNGS.map((level) => levelToBudget(level, { min: 1024 }, cap))
      for (let i = 1; i < budgets.length; i++) expect(budgets[i]).toBeGreaterThanOrEqual(budgets[i - 1])
    }
  })

  it('takes the documented share of the cap when the range allows it', () => {
    expect(levelToBudget('medium', { min: 1024 }, 64_000)).toBe(Math.floor(BUDGET_RATIO.medium * 64_000))
    expect(levelToBudget('low', { min: 1024 }, 64_000)).toBe(Math.floor(BUDGET_RATIO.low * 64_000))
  })

  it('respects the range: never below min, never above max', () => {
    for (const level of RUNGS) {
      const budget = levelToBudget(level, { min: 128, max: 32_768 }, 128_000)
      expect(budget).toBeGreaterThanOrEqual(128)
      expect(budget).toBeLessThanOrEqual(32_768)
    }
    expect(levelToBudget('minimal', { min: 1024 }, 8192)).toBe(1024)
  })

  it('stays strictly below max_tokens, leaving room for the answer', () => {
    for (const cap of [8192, 16_000, 64_000]) {
      for (const level of RUNGS) {
        const budget = levelToBudget(level, { min: 1024 }, cap)
        expect(budget).toBeLessThan(cap)
        expect(budget).toBeLessThanOrEqual(cap - ANSWER_HEADROOM_TOKENS)
      }
    }
  })

  it('an explicit per-level budget wins over the ratio', () => {
    expect(levelToBudget('high', { min: 1024, perLevel: { high: 5000 } }, 64_000)).toBe(5000)
  })

  it('is the resolver\'s own budget: a Haiku-4.5 plan carries exactly this value', () => {
    const registry = createReasoningRegistry({ overlay: loadBundledOverlay(), getDiscovered: () => null })
    const capability = registry.get('anthropic', 'claude-haiku-4-5')
    const { plan } = resolveEffortPlan({ intent: { level: 'high', source: 'request' }, capability, maxOutputTokens: 64_000, streaming: true })
    expect(plan.budgetTokens).toBe(levelToBudget('high', capability.budget!, 64_000))
  })
})

describe('levelToBudget (negative: out-of-range input is clamped)', () => {
  it('a per-level value outside the range is pulled back into it', () => {
    expect(levelToBudget('high', { min: 1024, max: 4000, perLevel: { high: 999_999 } }, 64_000)).toBe(4000)
    expect(levelToBudget('low', { min: 1024, perLevel: { low: 10 } }, 64_000)).toBe(1024)
  })

  it('a cap too small for the vendor minimum yields the minimum, never less', () => {
    expect(levelToBudget('max', { min: 1024 }, 3000)).toBe(1024)
    expect(levelToBudget('max', { min: 1024 }, 3000)).toBeLessThan(3000)
  })

  it('a non-finite, zero or negative cap never produces a runaway or negative budget', () => {
    for (const cap of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5000]) {
      expect(levelToBudget('max', { min: 1024 }, cap)).toBe(1024)
    }
  })

  it('a negative minimum is treated as zero and the result is a whole number', () => {
    const budget = levelToBudget('medium', { min: -50 }, 10_001)
    expect(budget).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(budget)).toBe(true)
  })
})
