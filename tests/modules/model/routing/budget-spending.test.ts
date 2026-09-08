import { describe, it, expect } from 'vitest'
import { resolveSpendAction, buildBudgetStatus } from '@modules/model/routing/spending'
import { MODEL_DOWNGRADE_PATH } from '@modules/model/routing/types'
import type { BudgetConfig } from '@modules/model/routing/types'

const budget: BudgetConfig = {
  dailyLimit: 10,
  weeklyLimit: 50,
  monthlyLimit: 100,
  warnAt: 0.8,
  downgradeAt: 1.0,
  hardStopAt: 1.2,
}

describe('resolveSpendAction', () => {
  it('returns ok when under the warn threshold', () => {
    expect(resolveSpendAction(5, 10, budget)).toBe('ok')
  })
  it('returns warn at 80% of the limit', () => {
    expect(resolveSpendAction(8, 10, budget)).toBe('warn')
  })
  it('returns downgrade at 100% of the limit', () => {
    expect(resolveSpendAction(10, 10, budget)).toBe('downgrade')
  })
  it('returns stop at 120% of the limit', () => {
    expect(resolveSpendAction(12, 10, budget)).toBe('stop')
  })
  it('is unconstrained (ok) when limit is null or non-positive', () => {
    expect(resolveSpendAction(999, null, budget)).toBe('ok')
    expect(resolveSpendAction(999, 0, budget)).toBe('ok')
  })
})

describe('buildBudgetStatus', () => {
  it('enforces a user-set daily cap (was previously always ok / fail-open)', () => {
    const status = buildBudgetStatus({ daily: 15, weekly: 10, monthly: 10 }, budget)
    expect(status.daily.action).toBe('stop')
    expect(status.daily.spent).toBe(15)
    expect(status.weekly.action).toBe('ok')
    expect(status.monthly.action).toBe('ok')
  })

  it('reports spent + limit per period', () => {
    const status = buildBudgetStatus({ daily: 8, weekly: 50, monthly: 60 }, budget)
    expect(status.daily).toEqual({ spent: 8, limit: 10, action: 'warn' })
    expect(status.weekly).toEqual({ spent: 50, limit: 50, action: 'downgrade' })
    expect(status.monthly.action).toBe('ok')
  })
})

describe('MODEL_DOWNGRADE_PATH', () => {
  it('uses model ids the anthropic provider actually serves (no stale dated ids)', () => {
    // The stale keys (claude-opus-4-20250514) made downgrade a no-op.
    expect(MODEL_DOWNGRADE_PATH['claude-opus-4-8']).toBe('claude-sonnet-4-6')
    expect(MODEL_DOWNGRADE_PATH['claude-sonnet-4-6']).toBe('claude-haiku-4-5')
    expect(MODEL_DOWNGRADE_PATH['claude-opus-4-20250514']).toBeUndefined()
  })
  it('covers claude-code and openai served ids', () => {
    expect(MODEL_DOWNGRADE_PATH['claude-code-fable']).toBe('claude-code-opus')
    expect(MODEL_DOWNGRADE_PATH['claude-code-opus']).toBe('claude-code-sonnet')
    expect(MODEL_DOWNGRADE_PATH['gpt-4o']).toBe('gpt-4o-mini')
    expect(MODEL_DOWNGRADE_PATH['o3-mini']).toBe('gpt-4o-mini')
  })
})
