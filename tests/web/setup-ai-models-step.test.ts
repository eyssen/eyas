// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H4 — the first-run wizard's AI-models step names every assignment with its
// provider, like the Settings card: one option per provider+model (an id two
// providers list stays two choices with distinct keys), the proposal is
// pre-selected as a pair, and the step sends {agentId: {providerId, modelId}}.
// Fictive ids.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initialAiModelChoices } from '@/pages/setup/ai-models-step'
import { assignmentsBody, encodeModelPair, modelPairOptions, proposedPairValue } from '@/lib/model-pair'

const PROVIDERS = [
  { id: 'grok-cli', models: [{ id: 'shared-model', name: 'Shared' }] },
  { id: 'claude-code', models: [{ id: 'shared-model', name: 'Shared' }, { id: 'solo', name: '' }] },
]

describe('setup wizard — AI models step', () => {
  it('(+) one option per provider+model: a shared id stays two options with distinct values', () => {
    const options = modelPairOptions(PROVIDERS)
    expect(options.map((o) => o.value)).toEqual([
      encodeModelPair('grok-cli', 'shared-model'),
      encodeModelPair('claude-code', 'shared-model'),
      encodeModelPair('claude-code', 'solo'),
    ])
    expect(new Set(options.map((o) => o.value)).size).toBe(options.length)
    // A model without a name shows its id.
    expect(options[2]).toEqual({ value: encodeModelPair('claude-code', 'solo'), name: 'solo', provider: 'claude-code' })
  })

  it('(+) pre-selects each proposal as its provider+model pair', () => {
    expect(initialAiModelChoices([
      { id: 'a1', proposedProviderId: 'grok-cli', proposedModelId: 'shared-model' },
      { id: 'a2', proposedProviderId: 'claude-code', proposedModelId: 'shared-model' },
    ])).toEqual({
      a1: encodeModelPair('grok-cli', 'shared-model'),
      a2: encodeModelPair('claude-code', 'shared-model'),
    })
  })

  it('(−) a proposal without a provider or a model pre-selects nothing (never a bare id)', () => {
    expect(initialAiModelChoices([
      { id: 'a1', proposedProviderId: null, proposedModelId: 'shared-model' },
      { id: 'a2', proposedProviderId: 'grok-cli', proposedModelId: null },
      { id: 'a3', proposedModelId: 'shared-model' },
    ])).toEqual({})
    expect(proposedPairValue({ proposedProviderId: '', proposedModelId: 'x' })).toBe('')
  })

  it('(+) the step sends {providerId, modelId} per agent; (−) "none" and bare ids are left out', () => {
    const choices = { ...initialAiModelChoices([{ id: 'a1', proposedProviderId: 'claude-code', proposedModelId: 'shared-model' }]), a2: '', a3: 'shared-model' }
    expect(assignmentsBody(choices)).toEqual({ a1: { providerId: 'claude-code', modelId: 'shared-model' } })
  })

  it('the "none" choice is translated in all six setup locales', () => {
    const values = ['en', 'hu', 'de', 'es', 'fr', 'tlh'].map((lang) =>
      JSON.parse(readFileSync(resolve(process.cwd(), `src/web/src/pages/setup/locales/${lang}.json`), 'utf-8'))['aiModels.none'])
    for (const v of values) expect(typeof v === 'string' && v.trim().length > 0).toBe(true)
    // (−) not left in English outside en
    expect(values.slice(1).every((v) => v !== values[0])).toBe(true)
  })

  it('source contract: the step posts assignmentsBody(choices) and keys options by their pair', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/src/pages/setup/ai-models-step.tsx'), 'utf-8')
    expect(source).toMatch(/onComplete\(assignmentsBody\(choices\)\)/)
    expect(source).toMatch(/key=\{m\.value\} value=\{m\.value\}/)
    expect(source).not.toMatch(/key=\{m\.id\}/)
  })
})
