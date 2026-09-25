// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E5 — the pure side of every effort select: entry labels (Auto says what it
// means there), toggle labels, the clamp preview (the backend clamp itself),
// the visible adjustment after a model change, and the per-turn chip.

import { describe, it, expect, beforeEach } from 'vitest'
import { useLanguageStore } from '@/stores/language-store'
import {
  adjustEffortForOptions,
  effortAdjustedText,
  effortAutoLabel,
  effortHints,
  effortLevelLabel,
  effortOptionsFor,
  effortOptionsMatch,
  effortPreview,
  effortSelectEntries,
  effortFromSelect,
  turnEffortCaption,
  turnEffortOf,
  unknownEffortOptions,
  type EffortOptions,
} from '@/lib/effort-options'
import { modelEffortOptionsPath } from '@/hooks/use-effort-options'
import { clampEffort } from '@modules/model/reasoning/clamp'
import { createReasoningRegistry } from '@modules/model/reasoning/registry'
import { EFFORT_SETTINGS } from '@modules/model/reasoning/ladder'

const registry = createReasoningRegistry({ getDiscovered: () => null })
const pinned = (providerId: string, modelId: string, name = modelId): EffortOptions =>
  effortOptionsFor(registry.get(providerId, modelId), { providerId, modelId, name })

const OPUS_55 = () => pinned('anthropic', 'claude-opus-5-5', 'Opus 5.5')
const OPUS_46 = () => pinned('anthropic', 'claude-opus-4-6', 'Opus 4.6')
const KIMI_K26 = () => pinned('kimi', 'kimi-k2.6', 'Kimi K2.6')
const KIMI_K3 = () => pinned('kimi', 'kimi-k3', 'Kimi K3')
const GROK_45 = () => pinned('xai', 'grok-4.5', 'Grok 4.5')

beforeEach(() => useLanguageStore.getState().setLang('en'))

describe('Auto label: what Auto means here', () => {
  it('names the inherited level and who set it, per source', () => {
    const o = pinned('anthropic', 'claude-opus-4-8')
    expect(effortAutoLabel(o, { level: 'max', source: 'deep' })).toBe('Auto · Max (Deep)')
    expect(effortAutoLabel(o, { level: 'high', source: 'agent' })).toBe('Auto · High (colleague)')
    expect(effortAutoLabel(o, { level: 'xhigh', source: 'inherited' })).toBe('Auto · Extra high (delegating conversation)')
    expect(effortAutoLabel(o, { level: 'low', source: 'tier' })).toBe('Auto · Low (routing tier)')
    expect(effortAutoLabel(o, { level: 'medium', source: 'model' })).toBe('Auto · Medium (model default)')
  })

  it('an inherited level is shown as the model will run it (clamped)', () => {
    // opus-4-6 has no xhigh: an inherited xhigh runs as high.
    expect(effortAutoLabel(OPUS_46(), { level: 'xhigh', source: 'inherited' })).toBe('Auto · High (delegating conversation)')
  })

  it("nothing inherited → the model's own default, when known", () => {
    expect(effortAutoLabel(OPUS_55(), null)).toBe('Auto · model default (Medium)')
    const noDefault = { ...OPUS_55(), defaultLevel: null }
    expect(effortAutoLabel(noDefault, null)).toBe('Auto · model default')
  })

  it('plain Auto for auto mode, no control, unknown, or while loading (negative)', () => {
    expect(effortAutoLabel({ ...OPUS_55(), mode: 'auto', target: undefined }, null)).toBe('Auto')
    expect(effortAutoLabel(GROK_45(), { level: 'max', source: 'deep' })).toBe('Auto')
    expect(effortAutoLabel(unknownEffortOptions('x'), null)).toBe('Auto')
    expect(effortAutoLabel(null, null)).toBe('Auto')
  })

  it('translates (hu)', () => {
    useLanguageStore.getState().setLang('hu')
    expect(effortAutoLabel(OPUS_55(), { level: 'max', source: 'deep' })).toBe('Automatikus · Maximális (Mély)')
  })
})

describe('entries', () => {
  it('Auto first, then exactly the model\'s rungs (opus-5-5: no None/Off)', () => {
    const entries = effortSelectEntries(null, OPUS_55())
    expect(entries.map((e) => e.value)).toEqual(['auto', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(entries.map((e) => e.label)).not.toContain('None')
  })

  it('an on/off model reads Off / On', () => {
    const entries = effortSelectEntries(null, KIMI_K26())
    expect(entries.slice(1)).toEqual([{ value: 'none', label: 'Off' }, { value: 'high', label: 'On' }])
    expect(effortLevelLabel('high', 'toggle')).toBe('On')
    expect(effortLevelLabel('high', 'effort')).toBe('High')
  })

  it('a stored rung the model does not offer stays visible as "level → effective"', () => {
    const entries = effortSelectEntries('xhigh', OPUS_46())
    const extra = entries[entries.length - 1]
    expect(extra.value).toBe('xhigh')
    expect(extra.label).toBe('Extra high → High (Opus 4.6 does not offer Extra high)')
  })

  it('a stored rung on a model without control previews Auto', () => {
    const extra = effortSelectEntries('low', GROK_45()).pop()!
    expect(extra.label).toBe('Low → Auto (Grok 4.5 does not offer Low)')
  })

  it('auto mode keeps a stored rung plain (the model is picked per message)', () => {
    const auto = { ...OPUS_46(), mode: 'auto' as const, target: undefined }
    expect(effortSelectEntries('xhigh', auto).pop()).toEqual({ value: 'xhigh', label: 'Extra high' })
  })

  it('unknown model: only Auto (plus the stored rung)', () => {
    expect(effortSelectEntries(null, unknownEffortOptions('m')).map((e) => e.value)).toEqual(['auto'])
  })

  it('effortFromSelect: a rung, else Auto (null) — never a guessed level', () => {
    expect(effortFromSelect('xhigh')).toBe('xhigh')
    expect(effortFromSelect('auto')).toBeNull()
    expect(effortFromSelect('')).toBeNull()
    expect(effortFromSelect('extreme')).toBeNull()
  })
})

describe('clamp preview equals the backend clamp', () => {
  const cases: Array<[string, () => EffortOptions]> = [
    ['opus-5-5', OPUS_55], ['opus-4-6', OPUS_46], ['kimi-k2.6 (toggle)', KIMI_K26], ['grok-4.5 (none)', GROK_45],
    ['gpt-5.5', () => pinned('openai', 'gpt-5.5')], ['gemini-3.1-pro', () => pinned('gemini', 'gemini-3.1-pro')],
  ]
  for (const [name, make] of cases) {
    it(name, () => {
      const options = make()
      const capability = registry.get(options.target!.providerId!, options.target!.modelId)
      for (const level of EFFORT_SETTINGS) {
        expect(effortPreview(level, options)).toBe(clampEffort(level, capability).effective)
      }
    })
  }

  it('a vendor clamp exception is honoured (kimi-k3 medium → high with clampMap)', () => {
    const o = { ...KIMI_K3(), clampMap: { medium: 'high' as const } }
    expect(effortPreview('medium', o)).toBe('high')
    expect(effortPreview('medium', KIMI_K3())).toBe(clampEffort('medium', registry.get('kimi', 'kimi-k3')).effective)
  })

  it('auto mode predicts nothing (negative)', () => {
    expect(effortPreview('xhigh', { ...OPUS_46(), mode: 'auto' })).toBe('xhigh')
  })
})

describe('adjustment after a model change', () => {
  it('clamps a rung the new model does not offer, visibly', () => {
    const r = adjustEffortForOptions('xhigh', OPUS_46())
    expect(r).toEqual({ effort: 'high', adjusted: { from: 'xhigh', to: 'high' } })
    expect(effortAdjustedText(r.adjusted!)).toBe('Effort adjusted from Extra high to High: the selected model does not offer Extra high.')
  })

  it('a model without control can only run Auto', () => {
    expect(adjustEffortForOptions('low', GROK_45())).toEqual({ effort: null, adjusted: { from: 'low', to: 'auto' } })
  })

  it('leaves supported rungs, Auto, auto mode and unknown models alone (negative)', () => {
    expect(adjustEffortForOptions('high', OPUS_46())).toEqual({ effort: 'high' })
    expect(adjustEffortForOptions(null, OPUS_46())).toEqual({ effort: null })
    expect(adjustEffortForOptions('xhigh', { ...OPUS_46(), mode: 'auto' })).toEqual({ effort: 'xhigh' })
    expect(adjustEffortForOptions('xhigh', unknownEffortOptions('m'))).toEqual({ effort: 'xhigh' })
    expect(adjustEffortForOptions('xhigh', null)).toEqual({ effort: 'xhigh' })
  })

  it('effortOptionsMatch: only the options loaded for this model count', () => {
    const o = OPUS_46()
    expect(effortOptionsMatch(o, { providerId: 'anthropic', modelId: 'claude-opus-4-6' })).toBe(true)
    expect(effortOptionsMatch(o, { providerId: 'anthropic', modelId: 'claude-opus-4-8' })).toBe(false)
    expect(effortOptionsMatch(o, null)).toBe(false)
    expect(effortOptionsMatch({ ...o, mode: 'auto', target: undefined }, null)).toBe(true)
    expect(effortOptionsMatch(o, { providerId: '', modelId: 'opus' })).toBe(true)
    expect(effortOptionsMatch(null, null)).toBe(false)
  })
})

describe('hints', () => {
  it('names why only Auto is offered, and auto-routing', () => {
    expect(effortHints(GROK_45())).toEqual(['Grok 4.5 has no reasoning-effort control; only Auto applies.'])
    expect(effortHints(unknownEffortOptions('mystery-1'))[0]).toContain('mystery-1')
    expect(effortHints({ ...OPUS_46(), mode: 'auto', target: undefined })[0]).toContain('adjusted to the model each message runs on')
  })

  it('hidden reasoning is mentioned for a pinned model that hides it', () => {
    expect(effortHints(pinned('openai', 'gpt-5.5'))).toEqual(['This model does not show its reasoning text.'])
    expect(effortHints(OPUS_55())).toEqual([])
    expect(effortHints(null)).toEqual([])
  })
})

describe('per-turn chip', () => {
  it('shows the effective level and who set it', () => {
    const c = turnEffortCaption(turnEffortOf({ effort: { requested: 'high', effective: 'high', source: 'agent', clamped: false } }))
    expect(c).toEqual({ text: 'Effort: High', title: 'Effort: High\nSet by: colleague' })
  })

  it('shows requested → effective when the model did not offer the level', () => {
    const c = turnEffortCaption(turnEffortOf({ effort: { requested: 'xhigh', effective: 'high', source: 'conversation', clamped: true } }))
    expect(c?.text).toBe('Effort: Extra high → High')
  })

  it("a model default that was sent reads as the level", () => {
    expect(turnEffortCaption({ requested: 'auto', effective: 'medium', source: 'model' })?.text).toBe('Effort: Medium')
  })

  it('nothing when nothing was asked or sent; malformed metadata is ignored (negative)', () => {
    expect(turnEffortCaption(turnEffortOf({ effort: { requested: 'auto', effective: 'auto' } }))).toBeNull()
    expect(turnEffortOf({ effort: { requested: 'ultra', effective: 'high' } })).toBeNull()
    expect(turnEffortOf({ effort: 'high' })).toBeNull()
    expect(turnEffortOf(null)).toBeNull()
    expect(turnEffortOf({ effort: { requested: 'high', effective: 'high', source: 'bogus' } })).toEqual({ requested: 'high', effective: 'high' })
  })
})

describe('modelEffortOptionsPath', () => {
  it('a pair, a bare id, or the tier union', () => {
    expect(modelEffortOptionsPath('anthropic', 'claude-opus-4-8')).toBe('/model/effort-options?providerId=anthropic&modelId=claude-opus-4-8')
    expect(modelEffortOptionsPath('', 'sonnet')).toBe('/model/effort-options?modelId=sonnet')
    expect(modelEffortOptionsPath(null, null)).toBe('/model/effort-options')
    expect(modelEffortOptionsPath('openrouter', 'a/b:c')).toBe('/model/effort-options?providerId=openrouter&modelId=a%2Fb%3Ac')
  })
})
