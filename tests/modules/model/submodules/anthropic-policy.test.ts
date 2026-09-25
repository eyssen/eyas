// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The built-in Anthropic catalog (the fallback when the Models API cannot be
// reached): current ids only, and every id it lists is priced, downgradable
// and known to the reasoning overlay. There is no hard-coded model policy in
// the adapter any more — the capability registry is the only source.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ANTHROPIC_MODELS } from '@modules/model/submodules/anthropic/provider.js'
import { MODEL_DOWNGRADE_PATH } from '@modules/model/routing/types.js'
import { DEFAULT_MODEL_PRICING, estimateCost } from '@shared/model-pricing.js'
import { createReasoningRegistry, loadBundledOverlay } from '@modules/model/reasoning/registry.js'

const ids = ANTHROPIC_MODELS.map((m) => m.id)

describe('anthropic built-in catalog (positive)', () => {
  it('lists the current models', () => {
    expect(ids).toEqual([
      'claude-fable-5-1', 'claude-fable-5', 'claude-opus-5-5', 'claude-opus-5',
      'claude-opus-4-8', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-4-5',
    ])
  })

  it('every listed model has an exact pricing row', () => {
    for (const id of ids) expect(DEFAULT_MODEL_PRICING[`anthropic/${id}`], id).toBeDefined()
    expect(estimateCost('anthropic', 'claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(4 + 20, 6)
    expect(estimateCost('anthropic', 'claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(2 + 10, 6)
  })

  it('a dated Opus 5.5 id prices as Opus 5.5, not as its Opus 5 prefix', () => {
    expect(estimateCost('anthropic', 'claude-opus-5-5-20260901', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(4, 6)
  })

  it('every listed model but the cheapest has a budget downgrade to another listed model', () => {
    for (const id of ids.filter((i) => i !== 'claude-haiku-4-5')) {
      expect(ids, id).toContain(MODEL_DOWNGRADE_PATH[id])
    }
  })

  it('every listed model has a verified reasoning capability in the overlay', () => {
    const registry = createReasoningRegistry({ overlay: loadBundledOverlay(), getDiscovered: () => null })
    for (const id of ids) {
      const capability = registry.get('anthropic', id)
      expect(capability.source, id).toBe('overlay')
      expect(capability.levels.length, id).toBeGreaterThan(0)
    }
  })
})

describe('anthropic built-in catalog (negative)', () => {
  it('lists no stale or dated ids', () => {
    for (const stale of ['claude-sonnet-4-5-20250514', 'claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-3-5-20241022']) {
      expect(ids).not.toContain(stale)
    }
    for (const id of ids) expect(id).not.toMatch(/-\d{8}$/)
  })

  it('the adapter carries no per-model allowlists any more', () => {
    const adapter = readFileSync(new URL('../../../../src/modules/model/submodules/anthropic/adapter.ts', import.meta.url), 'utf8')
    expect(adapter).not.toMatch(/ADAPTIVE_THINKING_MODELS|NO_SAMPLING_MODELS|EFFORT_BUDGET_TOKENS|applyAnthropicThinking|allowsTemperature/)
    expect(adapter).not.toMatch(/'claude-[a-z]+-\d/)
  })
})
