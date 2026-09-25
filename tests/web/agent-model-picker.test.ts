// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H5 — a colleague's model on the agent editor is a provider+model pair
// (H4): the picker value encodes both, a pair that is not an enabled model of
// an active provider is flagged, and a save sends the pair only when it
// changed. The Settings model-assignment card sends pairs too. Fictive ids.

import { beforeEach, describe, it, expect } from 'vitest'
import {
  agentModelLabel,
  agentModelOptions,
  agentModelUnavailable,
  agentModelValue,
  agentModelWrite,
} from '@/pages/agents/agent-model-picker'
import { assignmentsBody, encodeModelPair } from '@/lib/model-pair'
import { primeProviderCatalog } from './provider-catalog-fixture'

// Provider names come from the served catalog (G13), primed into the shared cache.
beforeEach(primeProviderCatalog)

const MODELS = [
  { id: 'shared-model', name: 'Shared', provider: 'grok-cli' },
  { id: 'shared-model', name: 'Shared', provider: 'claude-code' },
]

describe('agent model picker', () => {
  it('(+) one option per provider+model — an id two providers list stays two choices', () => {
    const options = agentModelOptions(MODELS, '', "Conversation's own model")
    expect(options.map((o) => o.value)).toEqual(['', encodeModelPair('grok-cli', 'shared-model'), encodeModelPair('claude-code', 'shared-model')])
    expect(options[1].group).toBe('Grok CLI')
  })

  it('(+) a stored pair and a legacy bare model read back as picker values', () => {
    expect(agentModelValue({ provider: 'grok-cli', model: 'shared-model' })).toBe(encodeModelPair('grok-cli', 'shared-model'))
    expect(agentModelLabel(agentModelValue({ provider: null, model: 'sonnet' }))).toBe('sonnet')
    expect(agentModelValue({ provider: 'grok-cli', model: null })).toBe('')
    expect(agentModelValue(null)).toBe('')
  })

  it('(+) a stored choice the catalog does not list stays shown', () => {
    const gone = encodeModelPair('kimi-cli', 'gone-model')
    expect(agentModelOptions(MODELS, gone, 'own').at(-1)).toEqual({ value: gone, label: 'Kimi Code CLI / gone-model' })
  })

  it('(−) warns for a pair that is not an enabled model; never for a listed pair, a legacy id or before the catalog loads', () => {
    expect(agentModelUnavailable(encodeModelPair('kimi-cli', 'gone-model'), MODELS)).toBe('Kimi Code CLI / gone-model')
    expect(agentModelUnavailable(encodeModelPair('grok-cli', 'shared-model'), MODELS)).toBeNull()
    expect(agentModelUnavailable(agentModelValue({ model: 'sonnet' }), MODELS)).toBeNull()
    expect(agentModelUnavailable(encodeModelPair('kimi-cli', 'gone-model'), null)).toBeNull()
    expect(agentModelUnavailable('', MODELS)).toBeNull()
  })

  it('(+) a save sends the pair when it changed, both null to clear it', () => {
    const initial = encodeModelPair('grok-cli', 'shared-model')
    expect(agentModelWrite(encodeModelPair('claude-code', 'shared-model'), initial)).toEqual({ provider: 'claude-code', model: 'shared-model' })
    expect(agentModelWrite('', initial)).toEqual({ provider: null, model: null })
  })

  it('(−) an unchanged choice sends nothing — a name edit never fails on a model switched off since', () => {
    const initial = encodeModelPair('kimi-cli', 'gone-model')
    expect(agentModelWrite(initial, initial)).toBeUndefined()
    expect(agentModelWrite('', '')).toBeUndefined()
    expect(agentModelWrite('junk', '')).toBeUndefined()
  })
})

describe('model assignments card', () => {
  it('(+) sends {providerId, modelId} per colleague', () => {
    expect(assignmentsBody({ a1: encodeModelPair('grok-cli', 'shared-model'), a2: encodeModelPair('claude-code', 'shared-model') }))
      .toEqual({ a1: { providerId: 'grok-cli', modelId: 'shared-model' }, a2: { providerId: 'claude-code', modelId: 'shared-model' } })
  })

  it('(−) colleagues without a choice, or with a bare id, are left out', () => {
    expect(assignmentsBody({ a1: '', a2: 'shared-model', a3: encodeModelPair('', 'x') })).toEqual({})
  })
})
