// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// clampEffort: a requested rung → what one model accepts. Pinned against the
// real overlay rows, so a clamp rule and the catalog can never drift apart.

import { describe, it, expect } from 'vitest'
import { clampEffort } from '@modules/model/reasoning/clamp.js'
import { createReasoningRegistry, loadBundledOverlay } from '@modules/model/reasoning/registry.js'
import { EFFORT_LADDER, EFFORT_SETTINGS } from '@modules/model/reasoning/ladder.js'
import type { ReasoningCapability } from '@modules/model/reasoning/capability.js'

const registry = createReasoningRegistry({ overlay: loadBundledOverlay(), getDiscovered: () => null })
const cap = (provider: string, model: string) => registry.get(provider, model)

describe('clampEffort — against the overlay', () => {
  it('xhigh on Opus 4.6 (no xhigh) → high, clamped (the tie between high and max rounds down)', () => {
    expect(clampEffort('xhigh', cap('anthropic', 'claude-opus-4-6')))
      .toEqual({ effective: 'high', clamped: true, reason: 'unsupported' })
  })

  it('max on GPT-5.5 (tops out at xhigh) → xhigh', () => {
    expect(clampEffort('max', cap('openai', 'gpt-5.5')))
      .toEqual({ effective: 'xhigh', clamped: true, reason: 'unsupported' })
  })

  it('minimal on Gemini 3.8 Flash (no minimal) → low', () => {
    expect(clampEffort('minimal', cap('gemini', 'gemini-3.8-flash')))
      .toEqual({ effective: 'low', clamped: true, reason: 'unsupported' })
  })

  it('none on Opus 5.5 (cannot switch reasoning off) → its lowest level, low', () => {
    expect(clampEffort('none', cap('anthropic', 'claude-opus-5-5')))
      .toEqual({ effective: 'low', clamped: true, reason: 'cannot-disable' })
  })

  it('medium on Kimi K3 (low|high|max) → low: the tie rounds down', () => {
    expect(clampEffort('medium', cap('kimi', 'kimi-k3')))
      .toEqual({ effective: 'low', clamped: true, reason: 'unsupported' })
  })

  it('medium on Kimi K3 → high when the capability\'s clampMap says so (the vendor rule wins)', () => {
    const withRule: ReasoningCapability = { ...cap('kimi', 'kimi-k3'), clampMap: { medium: 'high' } }
    expect(clampEffort('medium', withRule)).toEqual({ effective: 'high', clamped: true, reason: 'unsupported' })
  })

  it('xAI over Chat Completions has no verified effort parameter: every level → auto (no-control)', () => {
    for (const level of ['low', 'high', 'xhigh'] as const) {
      expect(clampEffort(level, cap('xai', 'grok-4.5'))).toEqual({ effective: 'auto', clamped: true, reason: 'no-control' })
    }
  })

  it('a supported level stays and is not clamped', () => {
    expect(clampEffort('xhigh', cap('anthropic', 'claude-opus-4-8'))).toEqual({ effective: 'xhigh', clamped: false })
    expect(clampEffort('none', cap('anthropic', 'claude-opus-4-8'))).toEqual({ effective: 'none', clamped: false })
  })

  it('any level on an unknown model → auto (no-control); auto itself is never clamped', () => {
    for (const level of EFFORT_LADDER) {
      expect(clampEffort(level, cap('anthropic', 'claude-not-a-model'))).toEqual({ effective: 'auto', clamped: true, reason: 'no-control' })
    }
    expect(clampEffort('auto', cap('anthropic', 'claude-not-a-model'))).toEqual({ effective: 'auto', clamped: false })
  })

  it('a model with no reasoning control (kind none) → auto (no-control)', () => {
    expect(clampEffort('high', cap('kimi', 'kimi-k2.7-code'))).toEqual({ effective: 'auto', clamped: true, reason: 'no-control' })
  })

  it('no model at all (null capability) → auto (model-unknown)', () => {
    expect(clampEffort('high', null)).toEqual({ effective: 'auto', clamped: true, reason: 'model-unknown' })
    expect(clampEffort('auto', null)).toEqual({ effective: 'auto', clamped: false })
  })
})

describe('clampEffort — rules', () => {
  const toggle: ReasoningCapability = { ...cap('kimi', 'kimi-k2.6') }

  it('a toggle maps every rung above none to its on-rung, and none to off', () => {
    for (const level of ['minimal', 'low', 'medium', 'xhigh', 'max'] as const) {
      expect(clampEffort(level, toggle)).toEqual({ effective: 'high', clamped: true, reason: 'unsupported' })
    }
    expect(clampEffort('high', toggle)).toEqual({ effective: 'high', clamped: false })
    expect(clampEffort('none', toggle)).toEqual({ effective: 'none', clamped: false })
  })

  it('never switches reasoning off for a rung that asked for it (minimal on GPT-5.1 → low, not none)', () => {
    expect(clampEffort('minimal', cap('openai', 'gpt-5.1'))).toEqual({ effective: 'low', clamped: true, reason: 'unsupported' })
  })

  it('is deterministic: the same input always gives the same result', () => {
    const models: Array<[string, string]> = [
      ['anthropic', 'claude-opus-4-6'], ['openai', 'gpt-5.5'], ['gemini', 'gemini-3.8-flash'], ['kimi', 'kimi-k3'], ['xai', 'grok-4.5'],
    ]
    for (const [provider, model] of models) {
      for (const level of EFFORT_SETTINGS) {
        const first = clampEffort(level, cap(provider, model))
        for (let i = 0; i < 3; i++) expect(clampEffort(level, cap(provider, model))).toEqual(first)
        // The result is always a supported level of the model, or auto.
        if (first.effective !== 'auto') expect(cap(provider, model).levels).toContain(first.effective)
      }
    }
  })
})
