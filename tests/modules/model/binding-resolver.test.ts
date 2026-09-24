// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D3 — the conversation/agent binding (model/binding.ts createBindingResolver):
// request override > pinned pair > Auto-routing (only on an Auto conversation,
// only while the switch is on) > inherit chain (agent pair > stored pair >
// install default, fixed on first use). A stored pair that cannot be served
// runs on the default with a note (never silently); a one-turn request that
// cannot be served fails with a code.

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  BindingUnavailableError,
  catalogBindingDeps,
  conversationBindingInput,
  createBindingResolver,
  defaultBindingMode,
  type BindingConversation,
  type BindingResolverDeps,
  type ModelPair,
} from '@modules/model/binding'
import { createTestDb } from '../../helpers/test-db'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import type { ModelInfo } from '@modules/model/types'

interface World {
  active: Set<string>
  disabledModels: Set<string>
  enabledModels: Set<string>
  owners: Record<string, ModelPair>
  tiers: Record<string, ModelPair>
  autoOn: boolean
  def: ModelPair | null
  routed: (ModelPair & { tier: 'quick' | 'standard' | 'complex' | 'code' }) | Error
}

function world(over: Partial<World> = {}): World {
  return {
    active: new Set(['claude-code', 'grok-cli', 'anthropic']),
    disabledModels: new Set(),
    enabledModels: new Set(['claude-code/claude-code-opus', 'grok-cli/grok-cli-default', 'anthropic/claude-opus-4-8']),
    owners: {},
    tiers: { standard: { providerId: 'claude-code', modelId: 'claude-code-sonnet' } },
    autoOn: true,
    def: { providerId: 'claude-code', modelId: 'claude-code-sonnet' },
    routed: { providerId: 'claude-code', modelId: 'claude-code-haiku', tier: 'quick' },
    ...over,
  }
}

function deps(w: World, route = vi.fn(async () => {
  if (w.routed instanceof Error) throw w.routed
  return w.routed
})): BindingResolverDeps & { route: typeof route } {
  return {
    isProviderActive: (id) => w.active.has(id),
    modelState: (p, m) => (w.disabledModels.has(`${p}/${m}`) ? 'disabled' : w.enabledModels.has(`${p}/${m}`) ? 'enabled' : 'unknown'),
    resolveModelRef: (m) => w.owners[m] ?? null,
    resolveForTier: (t) => w.tiers[t] ?? null,
    route,
    autoRoutingEnabled: () => w.autoOn,
    resolveDefault: () => w.def,
  }
}

function conv(over: Partial<BindingConversation> = {}): BindingConversation {
  return { mode: 'pinned', providerId: null, modelId: null, agentId: null, parentConversationId: null, ...over }
}

describe('createBindingResolver — precedence', () => {
  it('a request override wins over every mode and is never triaged', async () => {
    const w = world()
    const d = deps(w)
    const r = createBindingResolver(d)
    const b = await r.resolve({
      request: { providerId: 'anthropic', modelId: 'claude-opus-4-8' },
      conversation: conv({ mode: 'auto', providerId: 'grok-cli', modelId: 'grok-cli-default' }),
      text: 'hi',
    })
    expect(b).toEqual({ providerId: 'anthropic', modelId: 'claude-opus-4-8', source: 'request' })
    expect(d.route).not.toHaveBeenCalled()
  })

  it('a request override on an inactive provider fails with a code (negative)', async () => {
    const r = createBindingResolver(deps(world()))
    await expect(r.resolve({ request: { providerId: 'gone', modelId: 'x' }, conversation: conv() }))
      .rejects.toMatchObject({ code: 'model_binding_unavailable', providerId: 'gone' })
  })

  it('a pinned conversation keeps its pair after the default and the standard tier change', async () => {
    const w = world()
    const r = createBindingResolver(deps(w))
    const c = conv({ providerId: 'grok-cli', modelId: 'grok-cli-default' })
    expect(await r.resolve({ conversation: c })).toMatchObject({ providerId: 'grok-cli', modelId: 'grok-cli-default', source: 'conversation' })
    w.def = { providerId: 'anthropic', modelId: 'claude-opus-4-8' }
    w.tiers.standard = { providerId: 'anthropic', modelId: 'claude-opus-4-8' }
    const again = await r.resolve({ conversation: c })
    expect(again).toMatchObject({ providerId: 'grok-cli', modelId: 'grok-cli-default', source: 'conversation' })
    expect(again.materialize).toBeUndefined()
  })

  it('an agentless conversation without a pair gets the default to fix now; once fixed, a default change does not move it', async () => {
    const w = world()
    const r = createBindingResolver(deps(w))
    const first = await r.resolve({ conversation: conv() })
    expect(first).toEqual({ providerId: 'claude-code', modelId: 'claude-code-sonnet', source: 'default', materialize: true })
    // The caller stored it (materializeBinding); the default then changes.
    w.def = { providerId: 'grok-cli', modelId: 'grok-cli-default' }
    const second = await r.resolve({ conversation: conv({ providerId: first.providerId, modelId: first.modelId }) })
    expect(second).toMatchObject({ providerId: 'claude-code', modelId: 'claude-code-sonnet', source: 'conversation' })
  })

  it('a stored pair whose provider is off runs this turn on the default, with a note, and is not re-fixed', async () => {
    const w = world()
    w.active.delete('grok-cli')
    const r = createBindingResolver(deps(w))
    const b = await r.resolve({ conversation: conv({ providerId: 'grok-cli', modelId: 'grok-cli-default' }) })
    expect(b).toEqual({ providerId: 'claude-code', modelId: 'claude-code-sonnet', source: 'default', note: 'stored-binding-unavailable' })
    // The stored pair stays: nothing is materialized over it.
    expect(b.materialize).toBeUndefined()
  })

  it('a stored model switched off (e.g. by a discovery reconcile) falls back the same way; resolveStatic agrees', () => {
    const w = world({ disabledModels: new Set(['grok-cli/grok-cli-default']) })
    const r = createBindingResolver(deps(w))
    const b = r.resolveStatic({ conversation: conv({ providerId: 'grok-cli', modelId: 'grok-cli-default' }) })
    expect(b).toMatchObject({ providerId: 'claude-code', source: 'default', note: 'stored-binding-unavailable' })
    // Once the model is back, the stored pair answers again.
    w.disabledModels.clear()
    expect(r.resolveStatic({ conversation: conv({ providerId: 'grok-cli', modelId: 'grok-cli-default' }) }))
      .toEqual({ providerId: 'grok-cli', modelId: 'grok-cli-default', source: 'conversation' })
  })

  it('a stored pair that cannot be served and no default either → model_binding_unavailable (negative)', async () => {
    const w = world({ def: null, disabledModels: new Set(['grok-cli/grok-cli-default']) })
    const r = createBindingResolver(deps(w))
    const err = await r.resolve({ conversation: conv({ providerId: 'grok-cli', modelId: 'grok-cli-default' }) }).catch((e) => e)
    expect(err).toBeInstanceOf(BindingUnavailableError)
    expect(err).toMatchObject({ code: 'model_binding_unavailable', providerId: 'grok-cli', modelId: 'grok-cli-default' })
  })

  // H5 — a pair the user chose in the model picker is never swapped for another.
  it('a pinned pair the user chose fails closed when its model is switched off — even with a default (negative)', async () => {
    const w = world({ disabledModels: new Set(['grok-cli/grok-cli-default']) })
    const r = createBindingResolver(deps(w))
    const chosen = conv({ providerId: 'grok-cli', modelId: 'grok-cli-default', userChosen: true })
    const err = await r.resolve({ conversation: chosen }).catch((e) => e)
    expect(err).toBeInstanceOf(BindingUnavailableError)
    expect(err).toMatchObject({ code: 'model_binding_unavailable', providerId: 'grok-cli', modelId: 'grok-cli-default' })
    // resolveStatic (the picker's view) agrees: no silent default.
    expect(() => r.resolveStatic({ conversation: chosen })).toThrow(BindingUnavailableError)
  })

  it('a pinned pair the user chose fails closed when its provider is off (negative)', () => {
    const w = world()
    w.active.delete('grok-cli')
    const r = createBindingResolver(deps(w))
    expect(() => r.resolveStatic({ conversation: conv({ providerId: 'grok-cli', modelId: 'grok-cli-default', userChosen: true }) }))
      .toThrow(expect.objectContaining({ code: 'model_binding_unavailable' }))
  })

  it('a pinned pair the user chose answers normally while it is available, and again once it is back', () => {
    const w = world({ disabledModels: new Set(['grok-cli/grok-cli-default']) })
    const r = createBindingResolver(deps(w))
    const chosen = conv({ providerId: 'grok-cli', modelId: 'grok-cli-default', userChosen: true })
    expect(() => r.resolveStatic({ conversation: chosen })).toThrow()
    w.disabledModels.clear()
    expect(r.resolveStatic({ conversation: chosen })).toEqual({ providerId: 'grok-cli', modelId: 'grok-cli-default', source: 'conversation' })
  })

  it('userChosen only binds a pinned conversation: Auto and inherit still fall back with a note', () => {
    const w = world({ autoOn: false, disabledModels: new Set(['grok-cli/grok-cli-default']) })
    const r = createBindingResolver(deps(w))
    expect(r.resolveStatic({ conversation: conv({ mode: 'auto', providerId: 'grok-cli', modelId: 'grok-cli-default', userChosen: true }) }))
      .toMatchObject({ providerId: 'claude-code', note: 'stored-binding-unavailable' })
    expect(r.resolveStatic({ conversation: conv({ mode: 'inherit', agentId: 'a1', providerId: 'grok-cli', modelId: 'grok-cli-default', userChosen: true }) }))
      .toMatchObject({ providerId: 'claude-code', note: 'stored-binding-unavailable' })
  })

  it('Auto off on an unavailable stored pair keeps the more specific note (negative)', () => {
    const w = world({ autoOn: false, disabledModels: new Set(['grok-cli/grok-cli-default']) })
    const r = createBindingResolver(deps(w))
    expect(r.resolveStatic({ conversation: conv({ mode: 'auto', providerId: 'grok-cli', modelId: 'grok-cli-default' }) }).note)
      .toBe('stored-binding-unavailable')
  })

  it('no active provider at all → no_model_configured (negative)', async () => {
    const r = createBindingResolver(deps(world({ def: null })))
    await expect(r.resolve({ conversation: conv() })).rejects.toMatchObject({ code: 'no_model_configured' })
  })

  it('Auto with the switch on triages and carries the tier', async () => {
    const w = world()
    const d = deps(w)
    const r = createBindingResolver(d)
    const b = await r.resolve({ conversation: conv({ mode: 'auto', providerId: 'grok-cli', modelId: 'grok-cli-default' }), text: 'translate this' })
    expect(b).toEqual({ providerId: 'claude-code', modelId: 'claude-code-haiku', source: 'auto', tier: 'quick' })
    expect(d.route).toHaveBeenCalledWith('translate this')
  })

  it('Auto hands the conversation id to triage for trace attribution; a pinned turn never does (C7)', async () => {
    const w = world()
    const d = deps(w)
    const r = createBindingResolver(d)
    await r.resolve({ conversation: conv({ mode: 'auto' }), text: 'hello', conversationId: 'conv-1' })
    expect(d.route).toHaveBeenCalledWith('hello', { conversationId: 'conv-1' })
    d.route.mockClear()
    await r.resolve({ conversation: conv({ mode: 'pinned', providerId: 'grok-cli', modelId: 'grok-cli-default' }), text: 'hello', conversationId: 'conv-1' })
    expect(d.route).not.toHaveBeenCalled()
  })

  it('Auto with the switch off keeps the stored pair, with a note, and never triages', async () => {
    const w = world({ autoOn: false })
    const d = deps(w)
    const r = createBindingResolver(d)
    const b = await r.resolve({ conversation: conv({ mode: 'auto', providerId: 'grok-cli', modelId: 'grok-cli-default' }) })
    expect(b).toEqual({ providerId: 'grok-cli', modelId: 'grok-cli-default', source: 'conversation', note: 'auto-routing-disabled' })
    expect(d.route).not.toHaveBeenCalled()
  })

  it('Auto whose routing fails keeps the stored pair with a note; no tier is stamped (negative)', async () => {
    const w = world({ routed: new Error('No routing tiers configured') })
    const r = createBindingResolver(deps(w))
    const b = await r.resolve({ conversation: conv({ mode: 'auto', providerId: 'grok-cli', modelId: 'grok-cli-default' }) })
    expect(b).toMatchObject({ providerId: 'grok-cli', source: 'conversation', note: 'auto-routing-unavailable' })
    expect(b.tier).toBeUndefined()
  })

  it('inherit: the agent pair wins over the stored pair', async () => {
    const w = world({ owners: { opus: { providerId: 'anthropic', modelId: 'claude-opus-4-8' } } })
    const r = createBindingResolver(deps(w))
    const b = await r.resolve({
      conversation: conv({ mode: 'inherit', agentId: 'a1', providerId: 'grok-cli', modelId: 'grok-cli-default' }),
      agent: { model: 'opus' },
    })
    expect(b).toEqual({ providerId: 'anthropic', modelId: 'claude-opus-4-8', source: 'agent' })
  })

  it('inherit: an agent without a model uses the stored pair (source parent for a sub-conversation)', async () => {
    const r = createBindingResolver(deps(world()))
    const b = await r.resolve({
      conversation: conv({ mode: 'inherit', parentConversationId: 'p1', providerId: 'grok-cli', modelId: 'grok-cli-default' }),
      agent: { model: null },
    })
    expect(b).toEqual({ providerId: 'grok-cli', modelId: 'grok-cli-default', source: 'parent' })
  })

  it('inherit: no agent pair and no stored pair → the default, to be fixed', async () => {
    const r = createBindingResolver(deps(world()))
    const b = await r.resolve({ conversation: conv({ mode: 'inherit', agentId: 'a1' }) })
    expect(b).toMatchObject({ providerId: 'claude-code', modelId: 'claude-code-sonnet', source: 'default', materialize: true })
  })

  it('inherit: an agent pair on an unregistered provider falls back to the stored pair with a note (negative)', async () => {
    const w = world({ owners: { 'gpt-x': { providerId: 'openai', modelId: 'gpt-x' } } })
    const r = createBindingResolver(deps(w))
    const b = await r.resolve({
      conversation: conv({ mode: 'inherit', agentId: 'a1', providerId: 'grok-cli', modelId: 'grok-cli-default' }),
      agent: { model: 'gpt-x' },
    })
    expect(b).toEqual({ providerId: 'grok-cli', modelId: 'grok-cli-default', source: 'conversation', note: 'agent-binding-unavailable' })
  })

  it('inherit: an agent model no provider owns falls back to the default with a note (negative)', async () => {
    const r = createBindingResolver(deps(world()))
    const b = await r.resolve({ conversation: conv({ mode: 'inherit', agentId: 'a1' }), agent: { model: 'unknown-model' } })
    expect(b).toMatchObject({ source: 'default', materialize: true, note: 'agent-binding-unavailable' })
  })
})

describe('createBindingResolver — resolveStatic / resolveDefault / isSelectable', () => {
  it('resolveStatic never triages: Auto shows the Standard tier', () => {
    const w = world()
    const d = deps(w)
    const r = createBindingResolver(d)
    const b = r.resolveStatic({ conversation: conv({ mode: 'auto', providerId: 'grok-cli', modelId: 'grok-cli-default' }) })
    expect(b).toEqual({ providerId: 'claude-code', modelId: 'claude-code-sonnet', source: 'auto', tier: 'standard' })
    expect(d.route).not.toHaveBeenCalled()
  })

  it('resolveStatic with Auto off shows the stored pair with its note', () => {
    const r = createBindingResolver(deps(world({ autoOn: false })))
    expect(r.resolveStatic({ conversation: conv({ mode: 'auto', providerId: 'grok-cli', modelId: 'grok-cli-default' }) }))
      .toMatchObject({ providerId: 'grok-cli', note: 'auto-routing-disabled' })
  })

  it('autoRoutingEnabled reports the global switch', () => {
    expect(createBindingResolver(deps(world({ autoOn: true }))).autoRoutingEnabled()).toBe(true)
    expect(createBindingResolver(deps(world({ autoOn: false }))).autoRoutingEnabled()).toBe(false)
    const d = deps(world())
    d.autoRoutingEnabled = () => { throw new Error('db gone') }
    expect(createBindingResolver(d).autoRoutingEnabled()).toBe(false)
  })

  it('resolveDefault returns the install default as a binding, null when none', () => {
    expect(createBindingResolver(deps(world())).resolveDefault())
      .toEqual({ providerId: 'claude-code', modelId: 'claude-code-sonnet', source: 'default' })
    expect(createBindingResolver(deps(world({ def: null }))).resolveDefault()).toBeNull()
  })

  it('isSelectable: only an enabled model of an active provider', () => {
    const w = world()
    const r = createBindingResolver(deps(w))
    expect(r.isSelectable({ providerId: 'grok-cli', modelId: 'grok-cli-default' })).toBe(true)
    // Not in the catalog, a disabled provider: neither can be picked.
    expect(r.isSelectable({ providerId: 'grok-cli', modelId: 'made-up' })).toBe(false)
    w.active.delete('grok-cli')
    expect(r.isSelectable({ providerId: 'grok-cli', modelId: 'grok-cli-default' })).toBe(false)
  })

  it('a throwing dependency never throws out of resolveStatic for a usable pinned pair', () => {
    const d = deps(world())
    d.modelState = () => { throw new Error('db gone') }
    const r = createBindingResolver(d)
    expect(r.resolveStatic({ conversation: conv({ providerId: 'grok-cli', modelId: 'grok-cli-default' }) }))
      .toMatchObject({ source: 'conversation' })
  })
})

describe('conversationBindingInput', () => {
  const row = { modelBinding: 'inherit' as const, providerId: 'grok-cli', modelId: 'grok-cli-default', agentId: 'a1', parentConversationId: null }

  it('maps a conversation row and carries the colleague preference', () => {
    expect(conversationBindingInput(row, { agent: { model: 'opus' }, text: 'hi' })).toEqual({
      request: null,
      conversation: { mode: 'inherit', providerId: 'grok-cli', modelId: 'grok-cli-default', agentId: 'a1', parentConversationId: null },
      agent: { model: 'opus' },
      text: 'hi',
    })
  })

  it('carries the user-chosen flag of a row (H5); a row without it carries none', () => {
    expect(conversationBindingInput({ ...row, modelUserChosen: true }).conversation.userChosen).toBe(true)
    expect('userChosen' in conversationBindingInput(row).conversation).toBe(false)
    expect('userChosen' in conversationBindingInput({ ...row, modelUserChosen: false }).conversation).toBe(false)
  })

  it('drops an agent preference on a conversation without a colleague (negative)', () => {
    expect(conversationBindingInput({ ...row, agentId: null }, { agent: { model: 'opus' } }).agent).toBeNull()
  })

  it('carries a stored row\'s id as the conversation id; a row without one carries none (C7)', () => {
    expect(conversationBindingInput({ ...row, id: 'conv-9' }).conversationId).toBe('conv-9')
    expect('conversationId' in conversationBindingInput(row)).toBe(false)
  })
})

describe('defaultBindingMode', () => {
  it('agent-bound rows and children inherit; agentless rows are pinned', () => {
    expect(defaultBindingMode({ agentId: 'a1' })).toBe('inherit')
    expect(defaultBindingMode({ parentConversationId: 'p' })).toBe('inherit')
    expect(defaultBindingMode({ agentId: null, parentConversationId: null })).toBe('pinned')
  })
})

function model(provider: string, id: string): ModelInfo {
  return { id, name: id, provider, contextWindow: 1000, maxOutputTokens: 100, supportsTools: true, supportsImages: false, supportsStreaming: true }
}

describe('catalogBindingDeps — the live catalog wiring', () => {
  const testDb = createTestDb('binding-resolver-catalog')
  afterEach(() => testDb.cleanup())

  function catalog() {
    const db = testDb.open()
    const cfg = createProviderConfigService(db)
    for (const id of ['claude-code', 'grok-cli']) {
      cfg.ensureProvider(id)
      cfg.updateProvider(id, { enabled: true })
    }
    cfg.upsertModels('claude-code', [model('claude-code', 'claude-code-sonnet'), model('claude-code', 'claude-code-opus')])
    cfg.upsertModels('grok-cli', [model('grok-cli', 'grok-cli-default')])
    return cfg
  }

  it('reads registration, provider switch and model rows; the default ladder includes CLI providers regardless of registration order', () => {
    const cfg = catalog()
    const registered = new Set(['grok-cli', 'claude-code'])
    const d = catalogBindingDeps({ isRegistered: (id) => registered.has(id), getCatalog: () => cfg })
    expect(d.isProviderActive('grok-cli')).toBe(true)
    expect(d.modelState('claude-code', 'claude-code-opus')).toBe('enabled')
    expect(d.modelState('claude-code', 'nope')).toBe('unknown')
    // No tier, no configured default: the alphabetically first provider with a model.
    expect(d.resolveDefault()).toEqual({ providerId: 'claude-code', modelId: 'claude-code-opus' })
    // A tier alias resolves to the concrete id and its owner.
    expect(d.resolveModelRef('opus')).toEqual({ providerId: 'claude-code', modelId: 'claude-code-opus' })
  })

  it('a provider switched off in provider_config is inactive even while registered; a disabled model reads disabled (negative)', () => {
    const cfg = catalog()
    cfg.updateProvider('grok-cli', { enabled: false })
    const row = cfg.listModels('claude-code').find((m) => m.modelId === 'claude-code-opus')!
    cfg.updateModel(row.id, { enabled: false })
    const d = catalogBindingDeps({ isRegistered: () => true, getCatalog: () => cfg })
    expect(d.isProviderActive('grok-cli')).toBe(false)
    expect(d.modelState('claude-code', 'claude-code-opus')).toBe('disabled')
  })

  it('route forwards the conversation id to the decision engine only when there is one (C7)', async () => {
    const router = {
      route: vi.fn(async () => ({ provider: 'claude-code', model: 'claude-code-opus', tier: 'complex' as const })),
      resolveForTier: () => null,
    }
    const d = catalogBindingDeps({ isRegistered: () => true, getCatalog: () => undefined, getRouter: () => router })
    await expect(d.route('x', { conversationId: 'conv-2' })).resolves.toEqual({ providerId: 'claude-code', modelId: 'claude-code-opus', tier: 'complex' })
    expect(router.route).toHaveBeenLastCalledWith('x', { conversationId: 'conv-2' })
    await d.route('y')
    expect(router.route).toHaveBeenLastCalledWith('y')
  })

  it('no router → route throws (Auto falls back); switch defaults to on without a reader', async () => {
    const d = catalogBindingDeps({ isRegistered: () => true, getCatalog: () => undefined })
    await expect(d.route('x')).rejects.toThrow()
    expect(d.autoRoutingEnabled()).toBe(true)
    expect(d.resolveDefault()).toBeNull()
    expect(d.isProviderActive('anything')).toBe(true)
  })
})
