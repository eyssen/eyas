// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// resolveEffortPlan: intent / tier default + capability → EffortPlan (what the
// provider sends) and EffortOutcome (requested vs effective).

import { describe, it, expect } from 'vitest'
import {
  resolveEffortPlan,
  ANSWER_HEADROOM_TOKENS,
  FALLBACK_OUTPUT_TOKENS,
  NON_STREAMING_MAX_TOKENS,
} from '@modules/model/reasoning/resolve.js'
import { createReasoningRegistry, loadBundledOverlay } from '@modules/model/reasoning/registry.js'
import type { ReasoningCapability } from '@modules/model/reasoning/capability.js'

const registry = createReasoningRegistry({ overlay: loadBundledOverlay(), getDiscovered: () => null })
const cap = (provider: string, model: string) => registry.get(provider, model)

const opus48 = cap('anthropic', 'claude-opus-4-8')
const opus46 = cap('anthropic', 'claude-opus-4-6')
const haiku45 = cap('anthropic', 'claude-haiku-4-5')

describe('resolveEffortPlan — auto and the requested level', () => {
  it('auto → plan level auto, thinking omitted, nothing clamped', () => {
    const { plan, outcome } = resolveEffortPlan({ intent: { level: 'auto', source: 'conversation' }, capability: opus46, maxOutputTokens: 128_000, streaming: true })
    expect(plan.level).toBe('auto')
    expect(plan.thinking).toBe('omit')
    expect(plan.budgetTokens).toBeUndefined()
    expect(plan.maxTokensFloor).toBeUndefined()
    expect(outcome).toEqual({ requested: 'auto', effective: 'auto', source: 'conversation', clamped: false })
  })

  it('no intent + a tier default → the tier\'s level, source tier', () => {
    const { plan, outcome } = resolveEffortPlan({ tierDefault: 'low', capability: opus48, maxOutputTokens: 128_000, streaming: true })
    expect(plan.level).toBe('low')
    expect(outcome).toMatchObject({ requested: 'low', effective: 'low', source: 'tier', clamped: false })
  })

  it('no intent, no tier default → auto, source model (the model\'s own default)', () => {
    const { plan, outcome } = resolveEffortPlan({ capability: opus48, maxOutputTokens: 128_000, streaming: true })
    expect(plan.level).toBe('auto')
    expect(outcome).toEqual({ requested: 'auto', effective: 'auto', source: 'model', clamped: false })
    // null tier default is Auto, the same.
    expect(resolveEffortPlan({ tierDefault: null, capability: opus48, streaming: true }).outcome.source).toBe('model')
  })

  it('an intent always wins over the tier default (negative: the tier never overrides a choice)', () => {
    const { outcome } = resolveEffortPlan({ intent: { level: 'high', source: 'agent' }, tierDefault: 'low', capability: opus48, streaming: true })
    expect(outcome).toMatchObject({ requested: 'high', effective: 'high', source: 'agent' })
    const auto = resolveEffortPlan({ intent: { level: 'auto', source: 'request' }, tierDefault: 'low', capability: opus48, streaming: true })
    expect(auto.outcome).toMatchObject({ requested: 'auto', effective: 'auto', source: 'request' })
  })

  it('an unsupported level is clamped for this model and the outcome says why', () => {
    const { plan, outcome } = resolveEffortPlan({ intent: { level: 'xhigh', source: 'conversation' }, capability: opus46, maxOutputTokens: 128_000, streaming: true })
    expect(plan.level).toBe('high')
    expect(outcome).toEqual({ requested: 'xhigh', effective: 'high', source: 'conversation', clamped: true, reason: 'unsupported' })
  })

  it('no model (null capability) → auto, reason model-unknown', () => {
    const { plan, outcome } = resolveEffortPlan({ intent: { level: 'high', source: 'conversation' }, capability: null, streaming: true })
    expect(plan.level).toBe('auto')
    expect(plan.thinking).toBe('omit')
    expect(plan.capability.kind).toBe('unknown')
    expect(outcome).toMatchObject({ requested: 'high', effective: 'auto', clamped: true, reason: 'model-unknown' })
  })
})

describe('resolveEffortPlan — thinking, display and sampling', () => {
  it('high on an adaptive model → thinking on, summarized display, capability attached', () => {
    const { plan } = resolveEffortPlan({ intent: { level: 'high', source: 'conversation' }, capability: opus48, maxOutputTokens: 128_000, streaming: true })
    expect(plan.thinking).toBe('on')
    expect(plan.display).toBe('summarized')
    expect(plan.capability).toBe(opus48)
    expect(plan.budgetTokens).toBeUndefined()
  })

  it('a model that shows its thinking without the display parameter gets none (Opus 4.6)', () => {
    const { plan } = resolveEffortPlan({ intent: { level: 'high', source: 'conversation' }, capability: opus46, maxOutputTokens: 128_000, streaming: true })
    expect(plan.thinking).toBe('on')
    expect(plan.display).toBeUndefined()
  })

  it('none → thinking explicitly off', () => {
    const { plan } = resolveEffortPlan({ intent: { level: 'none', source: 'conversation' }, capability: opus48, maxOutputTokens: 128_000, streaming: true })
    expect(plan.level).toBe('none')
    expect(plan.thinking).toBe('off')
    expect(plan.display).toBeUndefined()
  })

  it('an effort-only model (no thinking parameter) omits thinking but gets an output floor', () => {
    const { plan } = resolveEffortPlan({ intent: { level: 'high', source: 'conversation' }, capability: cap('openai', 'gpt-5.5'), maxOutputTokens: 128_000, streaming: true })
    expect(plan.level).toBe('high')
    expect(plan.thinking).toBe('omit')
    expect(plan.maxTokensFloor).toBe(32_000)
  })

  it('the effort floor never exceeds the model\'s output cap, and is absent when the cap is unknown', () => {
    const capped = resolveEffortPlan({ intent: { level: 'max', source: 'conversation' }, capability: opus46, maxOutputTokens: 20_000, streaming: true })
    expect(capped.plan.maxTokensFloor).toBe(20_000)
    const unknown = resolveEffortPlan({ intent: { level: 'max', source: 'conversation' }, capability: opus46, streaming: true })
    expect(unknown.plan.maxTokensFloor).toBeUndefined()
  })

  it('samplingLocked is propagated from the capability', () => {
    expect(resolveEffortPlan({ intent: { level: 'high', source: 'request' }, capability: opus48, streaming: true }).plan.samplingLocked).toBe(true)
    expect(resolveEffortPlan({ intent: { level: 'high', source: 'request' }, capability: opus46, streaming: true }).plan.samplingLocked).toBe(false)
    expect(resolveEffortPlan({ capability: opus48, streaming: true }).plan.samplingLocked).toBe(true)
  })
})

describe('resolveEffortPlan — thinking budgets (R1B-09)', () => {
  it('max on Haiku 4.5 (budget, 64k cap, streaming) stays inside the cap with answer headroom', () => {
    const { plan } = resolveEffortPlan({ intent: { level: 'max', source: 'deep' }, capability: haiku45, maxOutputTokens: 64_000, streaming: true })
    expect(plan.thinking).toBe('on')
    expect(plan.budgetTokens).toBeLessThanOrEqual(64_000 - ANSWER_HEADROOM_TOKENS)
    expect(plan.budgetTokens).toBe(59_904)
    expect(plan.maxTokensFloor).toBeLessThanOrEqual(64_000)
    expect(plan.maxTokensFloor).toBeGreaterThan(plan.budgetTokens!)
  })

  it('a non-streaming call is also bounded by the plain-HTTP limit', () => {
    const { plan } = resolveEffortPlan({ intent: { level: 'max', source: 'deep' }, capability: haiku45, maxOutputTokens: 64_000, streaming: false })
    expect(plan.maxTokensFloor).toBeLessThanOrEqual(NON_STREAMING_MAX_TOKENS)
    expect(plan.budgetTokens).toBe(NON_STREAMING_MAX_TOKENS - ANSWER_HEADROOM_TOKENS)
  })

  it('levels translate to shares of the cap (low 20%, medium 50%, high 80%)', () => {
    const budget = (level: 'low' | 'medium' | 'high') =>
      resolveEffortPlan({ intent: { level, source: 'request' }, capability: haiku45, maxOutputTokens: 64_000, streaming: true }).plan.budgetTokens
    expect(budget('low')).toBe(12_800)
    expect(budget('medium')).toBe(32_000)
    expect(budget('high')).toBe(51_200)
  })

  it('the budget respects the model\'s own range (Gemini 2.5 Pro max 32768, min 128)', () => {
    const pro = cap('gemini', 'gemini-2.5-pro')
    expect(resolveEffortPlan({ intent: { level: 'max', source: 'request' }, capability: pro, maxOutputTokens: 65_536, streaming: true }).plan.budgetTokens).toBe(32_768)
    expect(resolveEffortPlan({ intent: { level: 'minimal', source: 'request' }, capability: pro, maxOutputTokens: 512, streaming: true }).plan.budgetTokens).toBe(128)
  })

  it('an explicit per-level budget wins over the share of the cap', () => {
    const withTable: ReasoningCapability = { ...haiku45, budget: { min: 1024, perLevel: { high: 7000 } } }
    expect(resolveEffortPlan({ intent: { level: 'high', source: 'request' }, capability: withTable, maxOutputTokens: 64_000, streaming: true }).plan.budgetTokens).toBe(7000)
  })

  it('an unknown output cap falls back to a conservative cap, never an unbounded budget', () => {
    const { plan } = resolveEffortPlan({ intent: { level: 'max', source: 'request' }, capability: haiku45, streaming: true })
    expect(plan.budgetTokens).toBe(FALLBACK_OUTPUT_TOKENS - ANSWER_HEADROOM_TOKENS)
    expect(plan.maxTokensFloor).toBe(FALLBACK_OUTPUT_TOKENS)
  })

  it('an effort model with a budget thinking parameter (Opus 4.5) gets both the level and a budget', () => {
    const { plan } = resolveEffortPlan({ intent: { level: 'high', source: 'request' }, capability: cap('anthropic', 'claude-opus-4-5'), maxOutputTokens: 64_000, streaming: true })
    expect(plan.level).toBe('high')
    expect(plan.thinking).toBe('on')
    expect(plan.budgetTokens).toBe(51_200)
  })

  it('none on a budget model switches thinking off and asks for no budget', () => {
    const { plan } = resolveEffortPlan({ intent: { level: 'none', source: 'request' }, capability: haiku45, maxOutputTokens: 64_000, streaming: true })
    expect(plan.thinking).toBe('off')
    expect(plan.budgetTokens).toBeUndefined()
  })
})
