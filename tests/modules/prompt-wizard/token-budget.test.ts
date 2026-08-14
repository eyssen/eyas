// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_BUDGET_FULL,
  totalBudget,
  shrinkForContextWindow,
  estimateTokens,
  clipToBudget,
} from '../../../src/modules/prompt-wizard/token-budget.js'

describe('token-budget', () => {
  it('default budget sums to ~8400 ± 100', () => {
    const total = totalBudget(DEFAULT_BUDGET_FULL)
    expect(total).toBeGreaterThanOrEqual(8300)
    expect(total).toBeLessThanOrEqual(8500)
  })

  it('shrinkForContextWindow(8000) shrinks variable sections, locked sections preserved', () => {
    const result = shrinkForContextWindow(8000)
    // Locked sections must remain unchanged
    expect(result.coreIdentity).toBe(DEFAULT_BUDGET_FULL.coreIdentity)
    expect(result.coreRules).toBe(DEFAULT_BUDGET_FULL.coreRules)
    expect(result.activeVoice).toBe(DEFAULT_BUDGET_FULL.activeVoice)
    expect(result.runtime).toBe(DEFAULT_BUDGET_FULL.runtime)
    // Total should be smaller than default
    expect(totalBudget(result)).toBeLessThan(totalBudget(DEFAULT_BUDGET_FULL))
  })

  it('shrinkForContextWindow(200000) returns default budget unchanged', () => {
    const result = shrinkForContextWindow(200000)
    expect(result).toEqual(DEFAULT_BUDGET_FULL)
  })

  it('estimateTokens returns 100 for 400-char string', () => {
    expect(estimateTokens('x'.repeat(400))).toBe(100)
  })

  it('clipToBudget truncates and appends marker', () => {
    const result = clipToBudget('x'.repeat(1000), 100)
    expect(result.truncated).toBe(true)
    expect(result.content).toContain('\n\n[truncated — section budget]')
  })
})
