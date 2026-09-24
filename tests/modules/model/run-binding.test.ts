// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H4 — the one resolution every non-chat entry path uses (model/binding.ts
// resolveRunBinding): the conversation's binding through the resolver, with a
// default the conversation had no pair for fixed on it; provider and model
// always from one binding. And the coded BindingUnavailableError those paths
// (and the gateway) fail with.

import { describe, it, expect, vi } from 'vitest'
import {
  agentModelPreference,
  BindingUnavailableError,
  createBindingResolver,
  resolveRunBinding,
  resolveRunBindingStatic,
  runConversationRow,
  turnBindingOf,
  type BindingConversationRow,
  type ModelPair,
} from '@modules/model/binding'
import { classifyModelError, CodedModelError } from '@shared/classify-model-error'

const CATALOG: Record<string, string[]> = {
  'claude-code': ['claude-code-sonnet'],
  'grok-cli': ['grok-cli-default'],
}

function resolver(defaultPair: ModelPair | null, route = vi.fn(async () => ({ providerId: 'grok-cli', modelId: 'grok-cli-default', tier: 'quick' as const }))) {
  return createBindingResolver({
    isProviderActive: (id) => id in CATALOG,
    modelState: (p, m) => (CATALOG[p]?.includes(m) ? 'enabled' : 'unknown'),
    resolveModelRef: (m) => {
      const owners = Object.entries(CATALOG).filter(([, ids]) => ids.includes(m))
      return owners.length === 1 ? { providerId: owners[0][0], modelId: m } : null
    },
    resolveForTier: () => ({ providerId: 'claude-code', modelId: 'claude-code-sonnet' }),
    route,
    autoRoutingEnabled: () => true,
    resolveDefault: () => defaultPair,
  })
}

function row(over: Partial<BindingConversationRow> = {}): BindingConversationRow {
  return { id: 'c1', modelBinding: 'inherit', providerId: null, modelId: null, agentId: 'spec', parentConversationId: 'p1', ...over }
}

const DEFAULT: ModelPair = { providerId: 'grok-cli', modelId: 'grok-cli-default' }
const TURN: ModelPair = { providerId: 'claude-code', modelId: 'claude-code-sonnet' }

describe('resolveRunBinding (H4)', () => {
  it("(+) inherit: the agent's pair, else the stored pair (source parent), else the default", async () => {
    const r = resolver(DEFAULT)
    expect(await resolveRunBinding({ resolver: r, conversation: row(TURN), agent: { provider: 'grok-cli', model: 'grok-cli-default' } }))
      .toMatchObject({ providerId: 'grok-cli', modelId: 'grok-cli-default', resolved: { source: 'agent' } })
    expect(await resolveRunBinding({ resolver: r, conversation: row(TURN), agent: {} }))
      .toMatchObject({ ...TURN, resolved: { source: 'parent' } })
    expect(await resolveRunBinding({ resolver: r, conversation: row(), agent: null }))
      .toMatchObject({ ...DEFAULT, resolved: { source: 'default' } })
  })

  it('(+) a default the conversation had no pair for is fixed on it, and the row\'s pair wins a race', async () => {
    const materialize = vi.fn((_id: string, _pair: ModelPair) => TURN)
    const out = await resolveRunBinding({ resolver: resolver(DEFAULT), conversation: row(), materialize })
    expect(materialize).toHaveBeenCalledWith('c1', DEFAULT)
    // Another first run fixed TURN first: this run follows the stored pair.
    expect(out).toMatchObject(TURN)
    expect(out.resolved?.materialize).toBeUndefined()
  })

  it('(−) nothing is fixed for a stored pair, or for a conversation without a row', async () => {
    const materialize = vi.fn(() => null)
    await resolveRunBinding({ resolver: resolver(DEFAULT), conversation: row(TURN), materialize })
    await resolveRunBinding({ resolver: resolver(DEFAULT), conversation: runConversationRow(null, 'spec'), materialize })
    expect(materialize).not.toHaveBeenCalled()
  })

  it('(−) an unavailable agent pair falls back with a note, never to a provider named by id', async () => {
    const out = await resolveRunBinding({ resolver: resolver(DEFAULT), conversation: row(TURN), agent: { provider: 'anthropic', model: 'claude-x' } })
    expect(out).toMatchObject({ ...TURN, resolved: { source: 'parent', note: 'agent-binding-unavailable' } })
    expect(turnBindingOf(out.resolved!)).toEqual({ ...TURN, source: 'parent', note: 'agent-binding-unavailable' })
  })

  it('(−) nothing configured: BindingUnavailableError no_model_configured', async () => {
    await expect(resolveRunBinding({ resolver: resolver(null), conversation: row() })).rejects.toMatchObject({ code: 'no_model_configured' })
  })

  it('only an Auto conversation triages; the static variant never does', async () => {
    const route = vi.fn(async () => ({ providerId: 'grok-cli', modelId: 'grok-cli-default', tier: 'quick' as const }))
    const r = resolver(DEFAULT, route)
    await resolveRunBinding({ resolver: r, conversation: row({ modelBinding: 'auto', agentId: null, parentConversationId: null }), text: 'hi' })
    expect(route).toHaveBeenCalledTimes(1)
    const pinned = resolveRunBindingStatic({ resolver: r, conversation: row({ modelBinding: 'inherit', ...TURN }) })
    expect(pinned).toMatchObject(TURN)
    expect(route).toHaveBeenCalledTimes(1)
  })

  it('without a resolver: the agent model for inherit, else the stored pair, else nothing — never mixed', async () => {
    expect(await resolveRunBinding({ conversation: row(TURN), agent: { model: 'alias' } })).toEqual({ modelId: 'alias' })
    expect(await resolveRunBinding({ conversation: row({ modelBinding: 'pinned', ...TURN }), agent: { model: 'other' } })).toEqual(TURN)
    // A half-stored pair and an agent on a pinned row: nothing, so the gateway's default answers as one pair.
    expect(await resolveRunBinding({ conversation: row({ modelBinding: 'pinned', providerId: 'grok-cli' }), agent: { model: 'claude-code-sonnet' } })).toEqual({})
  })
})

describe('runConversationRow / agentModelPreference', () => {
  it("the run's agent counts as the colleague of a row that names none; the migration rule fills a missing mode", () => {
    expect(runConversationRow({ id: 'c', providerId: null, modelId: null, agentId: null, parentConversationId: null }, 'a1'))
      .toMatchObject({ id: 'c', agentId: 'a1', modelBinding: 'inherit' })
    expect(runConversationRow({ id: 'c', modelBinding: 'pinned', agentId: 'a2' }, 'a1')).toMatchObject({ agentId: 'a2', modelBinding: 'pinned' })
    expect(runConversationRow({ id: 'c', modelBinding: 'bogus' }, null)).toMatchObject({ modelBinding: 'pinned' })
    expect(runConversationRow(null, 'a1', 'pipeline-a1')).toEqual({ modelBinding: 'inherit', providerId: null, modelId: null, agentId: 'a1', parentConversationId: null })
  })

  it('carries a stored conversation\'s user-chosen flag (H5); anything but true is dropped (negative)', () => {
    expect(runConversationRow({ id: 'c', modelBinding: 'pinned', providerId: 'grok-cli', modelId: 'grok-cli-default', modelUserChosen: true }, null))
      .toMatchObject({ modelUserChosen: true })
    expect('modelUserChosen' in runConversationRow({ id: 'c', modelBinding: 'pinned', modelUserChosen: 1 }, null)).toBe(false)
    expect('modelUserChosen' in runConversationRow({ id: 'c', modelBinding: 'pinned' }, null)).toBe(false)
  })

  it('a background run on a pinned pair the user chose fails closed when it is unavailable (negative)', async () => {
    const r = createBindingResolver({
      isProviderActive: (id) => id === 'claude-code',
      modelState: () => 'enabled',
      resolveModelRef: () => null,
      resolveForTier: () => null,
      route: async () => { throw new Error('no triage') },
      autoRoutingEnabled: () => false,
      resolveDefault: () => ({ providerId: 'claude-code', modelId: 'claude-code-sonnet' }),
    })
    const conversation = runConversationRow({ id: 'c', modelBinding: 'pinned', providerId: 'grok-cli', modelId: 'grok-cli-default', modelUserChosen: true }, null)
    await expect(resolveRunBinding({ resolver: r, conversation })).rejects.toMatchObject({ code: 'model_binding_unavailable' })
    // The same row without the flag (a pair the system stamped) runs on the default with a note.
    const stamped = runConversationRow({ id: 'c', modelBinding: 'pinned', providerId: 'grok-cli', modelId: 'grok-cli-default' }, null)
    expect((await resolveRunBinding({ resolver: r, conversation: stamped })).resolved).toMatchObject({ providerId: 'claude-code', note: 'stored-binding-unavailable' })
  })

  it('a colleague without a model has no preference; a legacy model keeps no provider', () => {
    expect(agentModelPreference({ provider: 'grok-cli' })).toBeNull()
    expect(agentModelPreference(undefined)).toBeNull()
    expect(agentModelPreference({ model: 'sonnet' })).toEqual({ providerId: null, model: 'sonnet' })
    expect(agentModelPreference({ provider: 'grok-cli', model: 'grok-cli-default' })).toEqual({ providerId: 'grok-cli', model: 'grok-cli-default' })
  })
})

describe('BindingUnavailableError is a coded model error (H4)', () => {
  it('classifies as a terminal invalid-request with its code and pair', () => {
    const err = new BindingUnavailableError('model_binding_unavailable', TURN)
    expect(err).toBeInstanceOf(CodedModelError)
    expect(err.name).toBe('BindingUnavailableError')
    expect(err.message).toContain('claude-code / claude-code-sonnet')
    expect(classifyModelError(err)).toEqual({
      kind: 'invalid-request', retryable: false, code: 'model_binding_unavailable',
      params: { provider: 'claude-code', model: 'claude-code-sonnet' },
    })
  })

  it('carries no params without a pair', () => {
    expect(classifyModelError(new BindingUnavailableError('no_model_configured'))).toEqual({
      kind: 'invalid-request', retryable: false, code: 'no_model_configured',
    })
  })
})
