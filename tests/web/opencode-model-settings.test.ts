// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, expect, it } from 'vitest'
import {
  findModel,
  modelKey,
  parseModelKey,
  settingsPayload,
  variantAfterModelChange,
  variantChoices,
  variantLabel,
  type OcProvider,
} from '@/pages/opencode/model-settings'

const PROVIDERS: OcProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', variants: ['low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({ id, level: id })) },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', variants: [{ id: 'high', level: 'high' }, { id: 'max', level: 'max' }] },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    models: [{ id: 'vendor/model:free', name: 'Vendor Model', variants: [] }],
  },
]

const OPUS = { providerID: 'anthropic', modelID: 'claude-opus-5-5' }
const SLASHED = { providerID: 'openrouter', modelID: 'vendor/model:free' }

describe('OpenCode model settings helpers', () => {
  it('(+) a model key round-trips, also for ids with slashes and colons', () => {
    expect(parseModelKey(modelKey(OPUS))).toEqual(OPUS)
    expect(parseModelKey(modelKey(SLASHED))).toEqual(SLASHED)
    expect(modelKey(null)).toBe('')
  })

  it('(−) an empty or malformed key is OpenCode\'s default (null)', () => {
    expect(parseModelKey('')).toBeNull()
    expect(parseModelKey('anthropic/claude')).toBeNull()
    expect(parseModelKey('["only-one"]')).toBeNull()
    expect(parseModelKey('["", "m"]')).toBeNull()
  })

  it('(+) the variant choices are the model\'s own variants', () => {
    expect(variantChoices(PROVIDERS, OPUS, null).map((v) => v.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(findModel(PROVIDERS, SLASHED)?.name).toBe('Vendor Model')
  })

  it('(−) a model without variants, or no model, offers none (the select is hidden)', () => {
    expect(variantChoices(PROVIDERS, SLASHED, null)).toEqual([])
    expect(variantChoices(PROVIDERS, null, 'high')).toEqual([])
  })

  it('(+) the current variant stays selectable when the list does not have it', () => {
    // Server not running: no list, the saved variant is still shown.
    expect(variantChoices(undefined, OPUS, 'xhigh')).toEqual([{ id: 'xhigh', level: null }])
    // Withdrawn by OpenCode: listed variants plus the saved one.
    expect(variantChoices(PROVIDERS, { providerID: 'anthropic', modelID: 'claude-haiku-4-5' }, 'xhigh').map((v) => v.id)).toEqual(['high', 'max', 'xhigh'])
  })

  it('(+) a model change keeps a variant the new model offers and drops one it does not', () => {
    expect(variantAfterModelChange(PROVIDERS, { providerID: 'anthropic', modelID: 'claude-haiku-4-5' }, 'high')).toBe('high')
    expect(variantAfterModelChange(PROVIDERS, { providerID: 'anthropic', modelID: 'claude-haiku-4-5' }, 'xhigh')).toBe('')
    expect(variantAfterModelChange(PROVIDERS, SLASHED, 'high')).toBe('')
    expect(variantAfterModelChange(PROVIDERS, null, 'high')).toBe('')
  })

  it('(+) a variant on the effort ladder uses the shared effort label; other names stay OpenCode\'s own', () => {
    const translate = (key: string, fallback: string) => (key === 'common.effort.level.xhigh' ? 'Extra high' : fallback)
    expect(variantLabel({ id: 'xhigh', level: 'xhigh' }, translate)).toBe('Extra high')
    // No shared label yet: the raw name.
    expect(variantLabel({ id: 'low', level: 'low' }, translate)).toBe('low')
    expect(variantLabel({ id: 'vendor-turbo', level: null }, () => 'never used')).toBe('vendor-turbo')
  })

  it('(+/−) the save payload sends a variant only together with a model', () => {
    expect(settingsPayload(modelKey(OPUS), 'xhigh')).toEqual({ model: OPUS, variant: 'xhigh' })
    expect(settingsPayload(modelKey(OPUS), '')).toEqual({ model: OPUS, variant: null })
    expect(settingsPayload('', 'xhigh')).toEqual({ model: null, variant: null })
  })
})
