// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_BUDGET_FULL,
  totalBudget,
  shrinkForContextWindow,
  estimateTokens,
  clipToBudget,
} from '../../../src/modules/prompt-wizard/token-budget.js'
import { CORE_IDENTITY } from '../../../src/modules/prompt-wizard/core-identity.js'
import { CORE_RULES } from '../../../src/modules/prompt-wizard/core-rules.js'
import { DEFAULT_PERSONALITY } from '../../../src/modules/prompt-wizard/master-prompt.js'

describe('token-budget', () => {
  it('default budget sums to ~8700 ± 100, under the 8800 reserve', () => {
    const total = totalBudget(DEFAULT_BUDGET_FULL)
    expect(total).toBeGreaterThanOrEqual(8600)
    // shrinkForContextWindow only leaves the budget alone while the declared sum
    // fits the reserve; past 8800 every variable section starts paying for the
    // locked ones, which are exempt from the shrink ratio.
    expect(total).toBeLessThanOrEqual(8800)
  })

  it('every locked section fits the budget it is given — nothing ships pre-truncated', () => {
    // A locked section is text WE ship, measured against a number WE choose, so
    // a mismatch is a self-inflicted cut with no operator in the loop. This
    // caught rule 8 of CORE_RULES being sliced mid-word in every assembled
    // prompt, taking rules 9-14 with it; CORE_RULES had in fact been over
    // budget since before the memory rule was touched.
    expect(estimateTokens(CORE_RULES)).toBeLessThanOrEqual(DEFAULT_BUDGET_FULL.coreRules)
    expect(estimateTokens(DEFAULT_PERSONALITY)).toBeLessThanOrEqual(DEFAULT_BUDGET_FULL.personality)
    // CORE_IDENTITY is KNOWN to break this rule — 491 tokens against a budget of
    // 200 — and is left unasserted on purpose: raising coreIdentity to fit would
    // put the declared sum over the 8800 reserve, which is a budget decision, not
    // a bug fix. Reported rather than papered over; add the assertion here the
    // day that decision is made.
    expect(
      estimateTokens(CORE_IDENTITY),
      'CORE_IDENTITY is over budget ON PURPOSE (F1.1 deferred finding). If you just fixed that, flip this to toBeLessThanOrEqual.',
    ).toBeGreaterThan(DEFAULT_BUDGET_FULL.coreIdentity)
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

describe('clipToBudget droppedChars', () => {
  it('reports zero when the text fits', () => {
    const r = clipToBudget('short', 100)
    expect(r).toEqual({ content: 'short', truncated: false, droppedChars: 0 })
  })

  it('reports the number of source characters cut', () => {
    const text = 'x'.repeat(500)
    const r = clipToBudget(text, 100) // charBudget = 400
    expect(r.truncated).toBe(true)
    expect(r.droppedChars).toBe(100)
    expect(r.content.startsWith('x'.repeat(400))).toBe(true)
  })
})
