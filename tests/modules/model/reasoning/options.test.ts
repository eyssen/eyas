// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E5 — the effort options every select is built from: exactly the rungs the
// target model accepts (from the capability registry), Auto only for a model
// without control or unknown to EYAS, and the Auto-routing tier union.

import { describe, it, expect } from 'vitest'
import { createReasoningRegistry } from '@modules/model/reasoning/registry'
import {
  AUTO_ROUTED_TIERS,
  describeEffortOptions,
  effortOptionsFor,
  unionEffortOptions,
  unknownEffortOptions,
  type OptionsTier,
} from '@modules/model/reasoning/options'

const registry = createReasoningRegistry({ getDiscovered: () => null })
const cap = (providerId: string, modelId: string) => registry.get(providerId, modelId)
const target = (providerId: string, modelId: string) => ({ providerId, modelId, name: modelId })

function tier(name: string, providerId: string, modelId: string, enabled = true): OptionsTier {
  return { tier: name, providerId, modelId, enabled }
}

describe('effortOptionsFor', () => {
  it('lists exactly the model\'s rungs with its default (opus-5-5: no Off, default medium)', () => {
    const o = effortOptionsFor(cap('anthropic', 'claude-opus-5-5'), target('anthropic', 'claude-opus-5-5'), 1)
    expect(o.mode).toBe('pinned')
    expect(o.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(o.levels).not.toContain('none')
    expect(o.canDisable).toBe(false)
    expect(o.defaultLevel).toBe('medium')
    expect(o.kind).toBe('effort')
    expect(o.catalogVersion).toBe(1)
    expect(o.source).toBe('overlay')
    expect(o.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('offers xhigh / none / minimal where the model supports them', () => {
    expect(effortOptionsFor(cap('openai', 'gpt-5.5'), target('openai', 'gpt-5.5')).levels)
      .toEqual(['none', 'low', 'medium', 'high', 'xhigh'])
    expect(effortOptionsFor(cap('openai', 'gpt-5'), target('openai', 'gpt-5')).levels).toContain('minimal')
    expect(effortOptionsFor(cap('anthropic', 'claude-opus-4-8'), target('anthropic', 'claude-opus-4-8')).levels)
      .toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('does not offer a rung the model lacks (opus-4-6: no xhigh)', () => {
    expect(effortOptionsFor(cap('anthropic', 'claude-opus-4-6'), target('anthropic', 'claude-opus-4-6')).levels).not.toContain('xhigh')
  })

  it('an on/off model lists exactly none and high (toggle)', () => {
    const o = effortOptionsFor(cap('kimi', 'kimi-k2.6'), target('kimi', 'kimi-k2.6'))
    expect(o.kind).toBe('toggle')
    expect(o.levels).toEqual(['none', 'high'])
  })

  it('a model without reasoning control or unknown to EYAS lists no rung (negative)', () => {
    const none = effortOptionsFor(cap('xai', 'grok-4.5'), target('xai', 'grok-4.5'))
    expect(none.kind).toBe('none')
    expect(none.levels).toEqual([])
    expect(none.defaultLevel).toBeNull()
    const unknown = effortOptionsFor(cap('anthropic', 'totally-new-model'), target('anthropic', 'totally-new-model'))
    expect(unknown.kind).toBe('unknown')
    expect(unknown.levels).toEqual([])
  })

  it('carries a vendor clamp exception so the UI preview equals the gateway clamp', () => {
    const o = effortOptionsFor({
      kind: 'effort', levels: ['low', 'high', 'max'], defaultLevel: 'max', canDisable: false,
      reasoningVisible: 'summary', clampMap: { medium: 'high' },
    }, target('kimi', 'kimi-k3'))
    expect(o.clampMap).toEqual({ medium: 'high' })
  })

  it('a default outside the listed rungs is dropped (never shown as a rung it cannot run)', () => {
    const o = effortOptionsFor({ kind: 'effort', levels: ['low', 'high'], defaultLevel: 'medium', canDisable: false, reasoningVisible: 'hidden' }, target('p', 'm'))
    expect(o.defaultLevel).toBeNull()
  })
})

describe('unknownEffortOptions', () => {
  it('offers Auto only for a model EYAS cannot place', () => {
    const o = unknownEffortOptions('mystery', 1)
    expect(o).toMatchObject({ mode: 'unknown', kind: 'unknown', levels: [], target: { providerId: null, modelId: 'mystery' } })
  })
})

describe('unionEffortOptions', () => {
  it('is every rung at least one candidate model accepts, cheapest first', () => {
    const o = unionEffortOptions([cap('anthropic', 'claude-opus-4-6'), cap('openai', 'gpt-5')])
    expect(o.mode).toBe('auto')
    expect(o.levels).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'max'])
    expect(o.defaultLevel).toBeNull()
    expect(o.canDisable).toBe(true)
    expect(o.reasoningVisible).toBe('summary')
  })

  it('no candidate with a control → Auto only (negative)', () => {
    const o = unionEffortOptions([cap('xai', 'grok-4.5'), cap('p', 'unknown-model')])
    expect(o.levels).toEqual([])
    expect(o.kind).toBe('unknown')
  })
})

describe('describeEffortOptions', () => {
  const tiers: OptionsTier[] = [
    tier('triage', 'openai', 'gpt-5'),
    tier('quick', 'anthropic', 'claude-opus-4-6'),
    tier('standard', 'anthropic', 'claude-opus-4-6'),
    tier('complex', 'openai', 'gpt-5.5'),
    tier('code', 'openai', 'gpt-5.5', false),
    tier('heartbeat', 'anthropic', 'claude-opus-4-8'),
    tier('embedding', 'openai', 'gpt-5'),
  ]
  const deps = {
    getCapability: cap,
    getTiers: () => tiers,
    modelName: (_p: string, m: string) => (m === 'claude-opus-4-6' ? 'Opus 4.6' : null),
    catalogVersion: 3,
  }

  it('pinned: the model\'s options with its catalog name', () => {
    const o = describeEffortOptions(deps, { mode: 'pinned', providerId: 'anthropic', modelId: 'claude-opus-4-6' })
    expect(o.target).toEqual({ providerId: 'anthropic', modelId: 'claude-opus-4-6', name: 'Opus 4.6' })
    expect(o.levels).not.toContain('xhigh')
    expect(o.catalogVersion).toBe(3)
  })

  it('auto: the union over the enabled quick/standard/complex/code tiers only', () => {
    expect(AUTO_ROUTED_TIERS).toEqual(['quick', 'standard', 'complex', 'code'])
    const o = describeEffortOptions(deps, { mode: 'auto' })
    // opus-4-6 (none..high, max) ∪ gpt-5.5 (none..xhigh); triage's minimal and
    // the disabled code tier / heartbeat / embedding do not count.
    expect(o.levels).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(o.levels).not.toContain('minimal')
  })

  it('unknown: Auto only', () => {
    expect(describeEffortOptions(deps, { mode: 'unknown', modelId: 'sonnet-x' }).levels).toEqual([])
  })

  it('never throws: an unreadable capability or tier table degrades to Auto only (negative)', () => {
    const broken = {
      getCapability: () => { throw new Error('boom') },
      getTiers: () => { throw new Error('boom') },
    }
    const pinned = describeEffortOptions(broken, { mode: 'pinned', providerId: 'p', modelId: 'm' })
    expect(pinned).toMatchObject({ mode: 'pinned', levels: [], kind: 'unknown', target: { providerId: 'p', modelId: 'm' } })
    expect(describeEffortOptions(broken, { mode: 'auto' }).levels).toEqual([])
  })
})
