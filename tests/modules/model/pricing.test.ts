// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { estimateCost, createCostAccumulator, DEFAULT_MODEL_PRICING } from '@shared/model-pricing'

describe('estimateCost', () => {
  it('prefers usage.costUsd when the provider supplies it, ignoring token counts entirely', () => {
    const cost = estimateCost('anthropic', 'claude-sonnet-4-6', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      costUsd: 0.0042,
    })
    expect(cost).toBe(0.0042)
  })

  it('estimates from the default table when no costUsd is supplied', () => {
    const cost = estimateCost('anthropic', 'claude-sonnet-4-6', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
    // 3 (input) + 15 (output) per 1M tokens
    expect(cost).toBeCloseTo(18, 6)
  })

  it('pins local providers (ollama, lmstudio) to $0 regardless of token volume', () => {
    expect(estimateCost('ollama', 'llama3', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(0)
    expect(estimateCost('lmstudio', 'whatever-model', { inputTokens: 500_000, outputTokens: 500_000 })).toBe(0)
  })

  it('falls back to a conservative default rate for an unrecognized provider/model', () => {
    const cost = estimateCost('some-new-provider', 'brand-new-model', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
    // Conservative fallback must be at the high end (Opus-class), never $0 and
    // never underpriced relative to the cheapest known model.
    expect(cost).toBeGreaterThan(estimateCost('anthropic', 'claude-haiku-4-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 }))
  })

  it('bills cache tokens when the model has cache rates configured', () => {
    const withoutCache = estimateCost('anthropic', 'claude-sonnet-4-6', { inputTokens: 100, outputTokens: 100 })
    const withCache = estimateCost('anthropic', 'claude-sonnet-4-6', {
      inputTokens: 100,
      outputTokens: 100,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    })
    expect(withCache).toBeGreaterThan(withoutCache)
    // 0.3 (cacheRead) + 3.75 (cacheWrite) per 1M on top of the base cost.
    expect(withCache - withoutCache).toBeCloseTo(0.3 + 3.75, 6)
  })

  it('ignores cache tokens for a model with no configured cache rates (no crash, no charge)', () => {
    const cost = estimateCost('openai', 'gpt-4o', {
      inputTokens: 100,
      outputTokens: 100,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    })
    const withoutCache = estimateCost('openai', 'gpt-4o', { inputTokens: 100, outputTokens: 100 })
    expect(cost).toBe(withoutCache)
  })

  describe('config override', () => {
    it('a full override for a known model replaces its default rate entirely', () => {
      const overrides = { 'anthropic/claude-sonnet-4-6': { input: 1, output: 2 } }
      const cost = estimateCost('anthropic', 'claude-sonnet-4-6', { inputTokens: 1_000_000, outputTokens: 1_000_000 }, overrides)
      expect(cost).toBeCloseTo(3, 6) // 1 + 2, not the default 3 + 15
    })

    it('an override can price a model the default table has no entry for', () => {
      const overrides = { 'custom-provider/custom-model': { input: 10, output: 20 } }
      const cost = estimateCost('custom-provider', 'custom-model', { inputTokens: 1_000_000, outputTokens: 1_000_000 }, overrides)
      expect(cost).toBeCloseTo(30, 6)
    })

    it('leaves every other model unaffected', () => {
      const overrides = { 'anthropic/claude-sonnet-4-6': { input: 1, output: 2 } }
      const cost = estimateCost('anthropic', 'claude-haiku-4-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 }, overrides)
      const defaultCost = estimateCost('anthropic', 'claude-haiku-4-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
      expect(cost).toBe(defaultCost)
    })
  })

  it('exposes a non-empty default pricing table', () => {
    expect(Object.keys(DEFAULT_MODEL_PRICING).length).toBeGreaterThan(0)
  })

  // Fix round 1 (Critical 1) — the original table priced Opus-tier models at
  // 3x their real rate (a stale $15/$75 guess vs. the real $5/$25). Pin the
  // corrected values so a future stale edit is caught here, not in prod spend.
  describe('corrected Anthropic rates (fix round 1 Critical 1)', () => {
    it('prices Opus-tier models (4.6/4.7/4.8) at $5/$25 per 1M, not the old $15/$75', () => {
      for (const model of ['claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8']) {
        const cost = estimateCost('anthropic', model, { inputTokens: 1_000_000, outputTokens: 1_000_000 })
        expect(cost).toBeCloseTo(5 + 25, 6)
      }
    })

    it('prices Claude Fable 5 at $10/$50 per 1M, not the old $5/$25', () => {
      const cost = estimateCost('anthropic', 'claude-fable-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
      expect(cost).toBeCloseTo(10 + 50, 6)
    })

    it('prices Haiku 4.5 at $1/$5 per 1M, not the old $0.8/$4', () => {
      const cost = estimateCost('anthropic', 'claude-haiku-4-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
      expect(cost).toBeCloseTo(1 + 5, 6)
    })

    it('leaves Sonnet 4.6 at $3/$15 (already correct)', () => {
      const cost = estimateCost('anthropic', 'claude-sonnet-4-6', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
      expect(cost).toBeCloseTo(3 + 15, 6)
    })

    it('bills opus/haiku cache rates off the corrected base (read 0.1x, write 1.25x)', () => {
      const opusBase = estimateCost('anthropic', 'claude-opus-4-8', { inputTokens: 0, outputTokens: 0 })
      const opusWithCache = estimateCost('anthropic', 'claude-opus-4-8', {
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000,
      })
      expect(opusWithCache - opusBase).toBeCloseTo(0.5 + 6.25, 6)

      const haikuBase = estimateCost('anthropic', 'claude-haiku-4-5', { inputTokens: 0, outputTokens: 0 })
      const haikuWithCache = estimateCost('anthropic', 'claude-haiku-4-5', {
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000,
      })
      expect(haikuWithCache - haikuBase).toBeCloseTo(0.1 + 1.25, 6)
    })

    it('claude-code aliases inherit their real model rate (fable/opus/haiku/sonnet)', () => {
      expect(estimateCost('claude-code', 'claude-code-fable', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(10 + 50, 6)
      expect(estimateCost('claude-code', 'claude-code-opus', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(5 + 25, 6)
      expect(estimateCost('claude-code', 'claude-code-haiku', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(1 + 5, 6)
      expect(estimateCost('claude-code', 'claude-code-sonnet', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(3 + 15, 6)
    })
  })

  // Fix round 1 (Critical 2) — a pinned agent model with no resolvable
  // provider (team-member / delegation runs never carry a separate provider
  // field) must price against its real model rate, not the fallback.
  describe('provider-less model resolution (fix round 1 Critical 2)', () => {
    it('resolves a known model to its real rate when no provider is given at all', () => {
      const cost = estimateCost(undefined, 'claude-sonnet-4-6', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
      expect(cost).toBeCloseTo(3 + 15, 6) // NOT the $15/$75 fallback
    })

    it('resolves via prefix match when no provider is given and the model id has a suffix', () => {
      const cost = estimateCost(undefined, 'claude-opus-4-8-some-suffix', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
      expect(cost).toBeCloseTo(5 + 25, 6)
    })

    it('a genuinely unrecognized model with no provider still falls back conservatively', () => {
      const cost = estimateCost(undefined, 'totally-unknown-model-xyz', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
      expect(cost).toBeCloseTo(15 + 75, 6)
    })

    it('a KNOWN provider still wins its provider-scoped rate over a same-named model under another provider', () => {
      // claude-code-sonnet only exists under claude-code/, not anthropic/ — an
      // explicit (but wrong) provider must not accidentally cross-resolve.
      const cost = estimateCost('anthropic', 'claude-code-sonnet', { inputTokens: 1_000_000, outputTokens: 1_000_000 })
      expect(cost).toBeCloseTo(15 + 75, 6) // falls back — no anthropic/claude-code-sonnet entry
    })
  })
})

describe('createCostAccumulator', () => {
  it('sums direct per-turn costUsd values without ever calling estimateCost', () => {
    const acc = createCostAccumulator()
    acc.addTurn({ inputTokens: 10, outputTokens: 5, costUsd: 0.01 })
    acc.addTurn({ inputTokens: 20, outputTokens: 10, costUsd: 0.02 })
    // No provider/model resolvable at all — if this fell through to
    // estimateCost it would use the (non-zero) fallback rate, so an exact
    // 0.03 proves only the direct costUsd path ran.
    expect(acc.finalize(undefined, undefined)).toBeCloseTo(0.03, 6)
  })

  it('pools tokens from turns with no costUsd and prices them ONCE at finalize', () => {
    const acc = createCostAccumulator()
    acc.addTurn({ inputTokens: 500_000, outputTokens: 0 })
    acc.addTurn({ inputTokens: 500_000, outputTokens: 1_000_000 })
    const total = acc.finalize('anthropic', 'claude-sonnet-4-6')
    // 1M input @ 3 + 1M output @ 15
    expect(total).toBeCloseTo(18, 6)
  })

  it('mixes direct costUsd turns with estimated turns (mid-run failover)', () => {
    const acc = createCostAccumulator()
    acc.addTurn({ inputTokens: 0, outputTokens: 0, costUsd: 0.05 }) // claude-code turn, authoritative
    acc.addTurn({ inputTokens: 1_000_000, outputTokens: 1_000_000 }) // anthropic failover turn, estimated
    const total = acc.finalize('anthropic', 'claude-sonnet-4-6')
    expect(total).toBeCloseTo(0.05 + 18, 6)
  })

  it('returns exactly 0 for a run with no turns', () => {
    const acc = createCostAccumulator()
    expect(acc.finalize('anthropic', 'claude-sonnet-4-6')).toBe(0)
  })

  it('threads config overrides through to the finalize-time estimate', () => {
    const acc = createCostAccumulator()
    acc.addTurn({ inputTokens: 1_000_000, outputTokens: 1_000_000 })
    const total = acc.finalize('anthropic', 'claude-sonnet-4-6', { 'anthropic/claude-sonnet-4-6': { input: 1, output: 1 } })
    expect(total).toBeCloseTo(2, 6)
  })
})
