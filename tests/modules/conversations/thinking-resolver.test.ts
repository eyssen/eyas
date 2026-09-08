// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { resolveThinkingAndEffort } from '@modules/conversations/thinking-resolver.js'

describe('resolveThinkingAndEffort', () => {
  it('off + no effort → neither thinking nor effort', () => {
    expect(resolveThinkingAndEffort({ thinking: 'off', thinkingBudget: null, effort: null }))
      .toEqual({ thinking: undefined, effort: undefined })
  })

  it('legacy thinking on without effort → budget config only', () => {
    expect(resolveThinkingAndEffort({ thinking: 'on', thinkingBudget: 25000, effort: null }))
      .toEqual({ thinking: { enabled: true, budgetTokens: 25000 }, effort: undefined })
  })

  it('thinking on without budget defaults to 10000', () => {
    expect(resolveThinkingAndEffort({ thinking: 'on', thinkingBudget: null, effort: null }))
      .toEqual({ thinking: { enabled: true, budgetTokens: 10000 }, effort: undefined })
  })

  it('effort set → thinking enabled + effort forwarded (budget kept for budget-based providers)', () => {
    expect(resolveThinkingAndEffort({ thinking: 'on', thinkingBudget: 100000, effort: 'max' }))
      .toEqual({ thinking: { enabled: true, budgetTokens: 100000 }, effort: 'max' })
  })

  it('effort set while thinking column still off → effort wins and enables thinking', () => {
    expect(resolveThinkingAndEffort({ thinking: 'off', thinkingBudget: null, effort: 'high' }))
      .toEqual({ thinking: { enabled: true, budgetTokens: 10000 }, effort: 'high' })
  })

  it('invalid effort values are dropped', () => {
    expect(resolveThinkingAndEffort({ thinking: 'off', thinkingBudget: null, effort: 'turbo' as any }))
      .toEqual({ thinking: undefined, effort: undefined })
  })
})
