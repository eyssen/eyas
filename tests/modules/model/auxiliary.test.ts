// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The auxiliary model service: one isolation-aware resolver for every
// background model call. It works from what THIS instance registered and
// enabled, whatever that is — most installs are CLI-only, so those scenarios
// come first. A background call never lands on a provider the gateway picked
// on its own, and never on a CLI that cannot isolate: with nothing eligible the
// service answers `none` and makes no model call at all.

import { describe, it, expect, vi } from 'vitest'
import {
  AUX_POLICY,
  AUX_PURPOSE_GROUP,
  createAuxiliaryModelService,
  resolveAuxiliaryCandidates,
  type AuxPurpose,
  type AuxResolveDeps,
} from '@modules/model/auxiliary'
import { createModelGateway } from '@modules/model/gateway'
import type { BindingProviderConfig } from '@modules/model/binding'
import type { BudgetStatus, RoutingTier, TierConfig } from '@modules/model/routing/types'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse } from '@modules/model/types'
import type { EffortSetting } from '@modules/model/reasoning/ladder'
import type { ReasoningCapability } from '@modules/model/reasoning/capability'
import { auxError, auxNone, auxOk, createFakeAuxiliaryModel } from '../../helpers/fake-auxiliary-model'

// ── Fixtures ────────────────────────────────────────────────────────────────

function response(provider: string, text = '{"ok":true}', extra: Partial<ModelResponse> = {}): ModelResponse {
  return {
    id: 'r', provider, model: `${provider}-answered`,
    content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
    ...extra,
  }
}

/** `id` alone, or `id!` for a provider that advertises isolated completion. */
function fakeGateway(ids: string[]) {
  const providers = ids.map((raw) => {
    const id = raw.replace(/!$/, '')
    return raw.endsWith('!') ? { id, supportsIsolatedCompletion: true } : { id }
  })
  const complete = vi.fn(async (req: ModelRequest) => response(req.provider ?? 'unpinned'))
  return {
    providers,
    listProviders: () => providers as unknown as AIProvider[],
    complete,
  }
}

interface ConfigOptions {
  disabled?: string[]
  /** provider_config.default_model per provider row. */
  defaults?: Record<string, string>
  /** The install default (provider_config.is_default). */
  def?: { providerId: string; modelId: string }
}

/** provider_config that knows every id in `ids` plus `models`' keys. */
function fakeConfig(ids: string[], models: Record<string, string[]> = {}, opts: ConfigOptions = {}): BindingProviderConfig {
  const known = [...new Set([...ids.map((i) => i.replace(/!$/, '')), ...Object.keys(models)])]
  const row = (id: string) => ({
    id, enabled: !(opts.disabled ?? []).includes(id), settings: {}, isDefault: opts.def?.providerId === id,
    defaultModel: opts.defaults?.[id] ?? null, updatedAt: '',
  })
  return {
    getProvider: (id) => (known.includes(id) ? row(id) : null),
    getDefault: () => opts.def ?? null,
    listProviders: () => known.map(row),
    listEnabledModels: (id) => (models[id] ?? []).map((m): ModelInfo => ({
      id: m, name: m, provider: id, contextWindow: 1000, maxOutputTokens: 100,
      supportsTools: true, supportsImages: false, supportsStreaming: true,
    })),
  }
}

function tier(name: TierConfig['tier'], providerId: string, modelId: string, fallback?: [string, string]): TierConfig {
  return {
    tier: name, providerId, modelId,
    fallbackProviderId: fallback?.[0] ?? null, fallbackModelId: fallback?.[1] ?? null,
    description: '', enabled: true, updatedAt: '',
  }
}

function budget(action: 'ok' | 'warn' | 'downgrade' | 'stop'): BudgetStatus {
  return {
    daily: { spent: 1, limit: 1, action },
    weekly: { spent: 1, limit: 10, action: 'ok' },
    monthly: { spent: 1, limit: 100, action: 'ok' },
  }
}

function deps(ids: string[], models: Record<string, string[]> = {}, extra: Partial<AuxResolveDeps> & ConfigOptions & { tiers?: TierConfig[] } = {}): AuxResolveDeps {
  const gateway = fakeGateway(ids)
  return {
    listProviders: () => gateway.providers,
    getTiers: () => extra.tiers ?? [],
    providerConfig: fakeConfig(ids, models, extra),
    ...(extra.getBudgetStatus ? { getBudgetStatus: extra.getBudgetStatus } : {}),
    ...(extra.isRuntimeVerifiedModel ? { isRuntimeVerifiedModel: extra.isRuntimeVerifiedModel } : {}),
  }
}

function service(opts: {
  gateway: ReturnType<typeof fakeGateway>
  config: BindingProviderConfig
  tiers?: TierConfig[]
  budgetStatus?: BudgetStatus | null
  logger?: { debug: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }
  getTierEffort?: (tier: RoutingTier) => EffortSetting | null | undefined
}) {
  return createAuxiliaryModelService({
    getGateway: () => opts.gateway,
    getTiers: () => opts.tiers ?? [],
    getProviderConfig: () => opts.config,
    getBudgetStatus: () => opts.budgetStatus ?? null,
    ...(opts.logger ? { logger: opts.logger as any } : {}),
    ...(opts.getTierEffort ? { getTierEffort: opts.getTierEffort } : {}),
  })
}

const rateLimit = () => Object.assign(new Error('rate limit exceeded'), { status: 429 })
const authError = () => Object.assign(new Error('invalid api key'), { status: 401 })

const EVERY_PURPOSE = Object.keys(AUX_PURPOSE_GROUP) as AuxPurpose[]

// ── The primary scenarios: CLI-only instances ───────────────────────────────

describe('a CLI-only instance', () => {
  it('uses Claude Code in isolation, pinned by provider only', () => {
    // Claude Code is the install default here (the first provider with an
    // enabled model), and still no EYAS model row is used as its alias.
    const result = resolveAuxiliaryCandidates('capture', deps(['claude-code!'], { 'claude-code': ['claude-code-fable', 'claude-code-sonnet'] }, {
      defaults: { 'claude-code': 'claude-code-opus' },
    }))
    expect(result).toEqual({ ok: true, candidates: [{ provider: 'claude-code', route: 'default' }] })
  })

  it('reaches an isolating CLI through its own rung when nothing else names it', () => {
    const result = resolveAuxiliaryCandidates('capture', deps(['claude-code!'], {}))
    expect(result).toEqual({ ok: true, candidates: [{ provider: 'claude-code', route: 'isolated-cli' }] })
  })

  it('S2: grok as tier and default, claude-code registered — resolves to claude-code, isolated', () => {
    const result = resolveAuxiliaryCandidates('capture', deps(['grok-cli', 'claude-code!'], { 'grok-cli': ['grok-cli-default'] }, {
      tiers: [tier('heartbeat', 'grok-cli', 'grok-cli-default'), tier('standard', 'grok-cli', 'grok-cli-default')],
      def: { providerId: 'grok-cli', modelId: 'grok-cli-default' },
    }))
    expect(result).toEqual({ ok: true, candidates: [{ provider: 'claude-code', route: 'isolated-cli' }] })
  })

  it('a Grok-only install has no eligible model, and makes zero model calls', async () => {
    const gateway = fakeGateway(['grok-cli'])
    const aux = service({
      gateway,
      config: fakeConfig(['grok-cli'], { 'grok-cli': ['grok-cli-default'] }, { def: { providerId: 'grok-cli', modelId: 'grok-cli-default' } }),
      tiers: [tier('heartbeat', 'grok-cli', 'grok-cli-default')],
    })
    expect(await aux.complete({ purpose: 'capture', system: 'S', user: 'U' })).toEqual({ ok: false, reason: 'no_eligible_provider' })
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it('a Kimi-only install (and Grok + Kimi) has no eligible model either', async () => {
    for (const ids of [['kimi-cli'], ['grok-cli', 'kimi-cli']]) {
      const gateway = fakeGateway(ids)
      const aux = service({ gateway, config: fakeConfig(ids, { 'kimi-cli': ['kimi-cli-default'] }) })
      for (const purpose of EVERY_PURPOSE.filter((p) => !AUX_POLICY[AUX_PURPOSE_GROUP[p]].tierOnly)) {
        expect(await aux.complete({ purpose, system: 'S', user: 'U' })).toMatchObject({ ok: false, reason: 'no_eligible_provider' })
      }
      expect(gateway.complete).not.toHaveBeenCalled()
    }
  })

  it('selects on the capability, never on a provider id — the choice moves with the flag', () => {
    expect(resolveAuxiliaryCandidates('capture', deps(['claude-code', 'grok-cli!'], {})))
      .toEqual({ ok: true, candidates: [{ provider: 'grok-cli', route: 'isolated-cli' }] })
  })

  it('reads the capability at call time, so a CLI verified later becomes eligible', () => {
    let verified = false
    const grok = { id: 'grok-cli', get supportsIsolatedCompletion() { return verified } }
    const d: AuxResolveDeps = { ...deps(['grok-cli']), listProviders: () => [grok] }
    expect(resolveAuxiliaryCandidates('capture', d)).toEqual({ ok: false, reason: 'no_eligible_provider' })
    verified = true
    expect(resolveAuxiliaryCandidates('capture', d)).toEqual({ ok: true, candidates: [{ provider: 'grok-cli', route: 'isolated-cli' }] })
  })
})

// ── The ladder ──────────────────────────────────────────────────────────────

describe('resolveAuxiliaryCandidates', () => {
  it('chooses an API provider with a nameable model when the default cannot isolate', () => {
    expect(resolveAuxiliaryCandidates('capture', deps(['grok-cli', 'anthropic'], { 'grok-cli': ['grok-cli-default'], anthropic: ['claude-haiku'] }, {
      def: { providerId: 'grok-cli', modelId: 'grok-cli-default' },
    }))).toEqual({ ok: true, candidates: [{ provider: 'anthropic', model: 'claude-haiku', route: 'api' }] })
  })

  it('uses the install default when it can isolate, even if it is a CLI', () => {
    // One definition of the default (binding.ts resolveDefault): background
    // work follows it whenever it is eligible, before any other API provider.
    const result = resolveAuxiliaryCandidates('capture', deps(['claude-code!', 'anthropic'], { anthropic: ['claude-haiku'] }, {
      def: { providerId: 'claude-code', modelId: 'claude-code-sonnet' },
    }))
    expect(result).toEqual({
      ok: true,
      candidates: [
        { provider: 'claude-code', route: 'default' },
        { provider: 'anthropic', model: 'claude-haiku', route: 'api' },
      ],
    })
  })

  it('without tiers or a configured default, the first provider by id is the default', () => {
    expect(resolveAuxiliaryCandidates('capture', deps(['openai', 'anthropic'], { openai: ['gpt-mini'], anthropic: ['claude-haiku'] })))
      .toEqual({
        ok: true,
        candidates: [
          { provider: 'anthropic', model: 'claude-haiku', route: 'default' },
          { provider: 'openai', model: 'gpt-mini', route: 'api' },
        ],
      })
  })

  it('an eligible tier row wins over everything else', () => {
    const result = resolveAuxiliaryCandidates('capture', deps(['openai', 'anthropic', 'claude-code!'], { openai: ['gpt-mini'], anthropic: ['claude-haiku'] }, {
      tiers: [tier('heartbeat', 'anthropic', 'claude-haiku')],
    }))
    expect(result.ok && result.candidates[0]).toEqual({ provider: 'anthropic', model: 'claude-haiku', route: 'tier' })
  })

  it('uses the tier fallback row when the primary is ineligible', () => {
    const result = resolveAuxiliaryCandidates('capture', deps(['grok-cli', 'openai'], { openai: ['gpt-mini'] }, {
      tiers: [tier('heartbeat', 'grok-cli', 'grok-cli-default', ['openai', 'gpt-mini'])],
    }))
    expect(result.ok && result.candidates[0]).toEqual({ provider: 'openai', model: 'gpt-mini', route: 'tier' })
  })

  it('uses the install default (standard tier) for a memory purpose without a heartbeat tier', () => {
    const result = resolveAuxiliaryCandidates('consolidation', deps(['anthropic', 'openai'], { anthropic: ['claude-sonnet'], openai: ['gpt-mini'] }, {
      tiers: [tier('standard', 'openai', 'gpt-mini')],
    }))
    expect(result.ok && result.candidates[0]).toEqual({ provider: 'openai', model: 'gpt-mini', route: 'default' })
  })

  it('orders the rungs: tier, default, API providers by id, isolating CLIs by id', () => {
    const result = resolveAuxiliaryCandidates('capture', deps(['zeta', 'claude-code!', 'openai', 'anthropic'], {
      zeta: ['z1'], openai: ['gpt-mini'], anthropic: ['claude-haiku'],
    }, {
      tiers: [tier('heartbeat', 'openai', 'gpt-mini')],
      def: { providerId: 'zeta', modelId: 'z1' },
    }))
    expect(result).toEqual({
      ok: true,
      candidates: [
        { provider: 'openai', model: 'gpt-mini', route: 'tier' },
        { provider: 'zeta', model: 'z1', route: 'default' },
        { provider: 'anthropic', model: 'claude-haiku', route: 'api' },
        { provider: 'claude-code', route: 'isolated-cli' },
      ],
    })
  })

  it('dedupes a target reached by two rungs', () => {
    const result = resolveAuxiliaryCandidates('capture', deps(['anthropic'], { anthropic: ['claude-haiku'] }, {
      tiers: [tier('heartbeat', 'anthropic', 'claude-haiku'), tier('standard', 'anthropic', 'claude-haiku')],
    }))
    expect(result).toEqual({ ok: true, candidates: [{ provider: 'anthropic', model: 'claude-haiku', route: 'tier' }] })
  })

  it('gives the same answer whatever the registration order', () => {
    const models = { openai: ['gpt-mini'], anthropic: ['claude-haiku'], ollama: ['llama'] }
    const a = resolveAuxiliaryCandidates('capture', deps(['openai', 'ollama', 'anthropic'], models))
    const b = resolveAuxiliaryCandidates('capture', deps(['anthropic', 'openai', 'ollama'], models))
    expect(a).toEqual(b)
    expect(a.ok && a.candidates[0].provider).toBe('anthropic')
  })

  it('names the provider row\'s default model before its first enabled model', () => {
    const result = resolveAuxiliaryCandidates('capture', deps(['grok-cli', 'openai'], { openai: ['a-model'] }, {
      defaults: { openai: 'gpt-5-mini' },
      def: { providerId: 'grok-cli', modelId: 'grok-cli-default' },
    }))
    expect(result.ok && result.candidates[0]).toEqual({ provider: 'openai', model: 'gpt-5-mini', route: 'api' })
  })

  it('never names a model for a CLI from EYAS\'s model rows', () => {
    const result = resolveAuxiliaryCandidates('capture', deps(['claude-code!'], { 'claude-code': ['claude-code-fable'] }, {
      tiers: [tier('heartbeat', 'claude-code', 'claude-code-fable')],
    }))
    expect(result).toEqual({ ok: true, candidates: [{ provider: 'claude-code', route: 'tier' }] })
  })

  it('pins a CLI to a model only when its runtime verified that model', () => {
    const isRuntimeVerifiedModel = vi.fn((_p: string, m: string) => m === 'claude-code-haiku')
    const result = resolveAuxiliaryCandidates('capture', deps(['claude-code!'], {}, {
      tiers: [tier('heartbeat', 'claude-code', 'claude-code-haiku')],
      isRuntimeVerifiedModel,
    }))
    expect(result.ok && result.candidates[0]).toEqual({ provider: 'claude-code', model: 'claude-code-haiku', route: 'tier' })
    expect(isRuntimeVerifiedModel).toHaveBeenCalledWith('claude-code', 'claude-code-haiku')
  })

  it('never half-pins an API provider: no nameable model, no candidate', () => {
    expect(resolveAuxiliaryCandidates('capture', deps(['some-api!'], {}))).toEqual({ ok: false, reason: 'no_eligible_provider' })
    expect(resolveAuxiliaryCandidates('capture', deps(['lmstudio', 'anthropic'], { anthropic: ['claude-haiku'] })))
      .toEqual({ ok: true, candidates: [{ provider: 'anthropic', model: 'claude-haiku', route: 'default' }] })
  })

  it('skips a provider switched off in provider_config while still registered', () => {
    const result = resolveAuxiliaryCandidates('capture', deps(['openai', 'gemini'], { openai: ['gpt-mini'], gemini: ['flash'] }, {
      disabled: ['openai'],
      tiers: [tier('heartbeat', 'openai', 'gpt-mini')],
    }))
    expect(result).toEqual({ ok: true, candidates: [{ provider: 'gemini', model: 'flash', route: 'default' }] })
  })

  it('skips a tier naming a provider this instance did not register', () => {
    const result = resolveAuxiliaryCandidates('capture', deps(['openai'], { openai: ['gpt-mini'] }, {
      tiers: [tier('heartbeat', 'a-provider-this-box-does-not-have', 'm')],
    }))
    expect(result).toEqual({ ok: true, candidates: [{ provider: 'openai', model: 'gpt-mini', route: 'default' }] })
  })

  it('stops on a budget stop, and only on a stop', () => {
    const d = deps(['anthropic'], { anthropic: ['claude-haiku'] })
    expect(resolveAuxiliaryCandidates('capture', { ...d, getBudgetStatus: () => budget('stop') })).toEqual({ ok: false, reason: 'budget_stop' })
    expect(resolveAuxiliaryCandidates('capture', { ...d, getBudgetStatus: () => budget('downgrade') }).ok).toBe(true)
    expect(resolveAuxiliaryCandidates('capture', { ...d, getBudgetStatus: () => null }).ok).toBe(true)
  })

  it('tier-only purposes never fall to the default, an API provider or a CLI', () => {
    const d = deps(['anthropic', 'claude-code!'], { anthropic: ['claude-haiku'] }, {
      tiers: [tier('standard', 'anthropic', 'claude-haiku')],
      def: { providerId: 'anthropic', modelId: 'claude-haiku' },
    })
    expect(resolveAuxiliaryCandidates('title', d)).toEqual({ ok: false, reason: 'tier_not_configured' })
    expect(resolveAuxiliaryCandidates('triage', d)).toEqual({ ok: false, reason: 'tier_not_configured' })
  })

  it('a tier-only purpose whose tier names only ineligible providers has no eligible provider', () => {
    const d = deps(['grok-cli', 'anthropic'], { anthropic: ['claude-haiku'] }, { tiers: [tier('heartbeat', 'grok-cli', 'grok-cli-default')] })
    expect(resolveAuxiliaryCandidates('title', d)).toEqual({ ok: false, reason: 'no_eligible_provider' })
  })

  it('a tier-only purpose uses its own tier', () => {
    const d = deps(['anthropic', 'openai'], { anthropic: ['claude-haiku'], openai: ['gpt-mini'] }, {
      tiers: [tier('triage', 'openai', 'gpt-mini', ['anthropic', 'claude-haiku'])],
    })
    expect(resolveAuxiliaryCandidates('triage', d)).toEqual({
      ok: true,
      candidates: [
        { provider: 'openai', model: 'gpt-mini', route: 'tier' },
        { provider: 'anthropic', model: 'claude-haiku', route: 'tier' },
      ],
    })
  })

  it('the safety group tries heartbeat, then quick', () => {
    const result = resolveAuxiliaryCandidates('security_judge', deps(['anthropic', 'openai'], { anthropic: ['claude-haiku'], openai: ['gpt-mini'] }, {
      tiers: [tier('quick', 'openai', 'gpt-mini'), tier('heartbeat', 'anthropic', 'claude-haiku')],
    }))
    expect(result.ok && result.candidates.slice(0, 2)).toEqual([
      { provider: 'anthropic', model: 'claude-haiku', route: 'tier' },
      { provider: 'openai', model: 'gpt-mini', route: 'tier' },
    ])
  })

  it('never throws when a lookup throws', () => {
    const throwing: AuxResolveDeps = {
      listProviders: () => { throw new Error('gateway broken') },
      getTiers: () => { throw new Error('routing table gone') },
      providerConfig: {
        getProvider: () => { throw new Error('db locked') },
        getDefault: () => { throw new Error('db locked') },
        listProviders: () => { throw new Error('db locked') },
        listEnabledModels: () => { throw new Error('db locked') },
      },
      getBudgetStatus: () => { throw new Error('ai_traces missing') },
    }
    expect(resolveAuxiliaryCandidates('capture', throwing)).toEqual({ ok: false, reason: 'no_eligible_provider' })
  })
})

// ── The service ─────────────────────────────────────────────────────────────

describe('createAuxiliaryModelService — the request', () => {
  it('is isolated, one user message, instruction in system, no tools, no tier, labelled', async () => {
    const gateway = fakeGateway(['anthropic'])
    const aux = service({ gateway, config: fakeConfig(['anthropic'], { anthropic: ['claude-haiku'] }) })
    await aux.complete({
      purpose: 'capture', system: 'SYSTEM', user: 'USER', maxTokens: 2000, temperature: 0.2,
      conversationId: 'conv-1', runId: 'run-1', agentId: 'agent-1',
    })

    const req = gateway.complete.mock.calls[0][0]
    expect(req).toMatchObject({
      provider: 'anthropic', model: 'claude-haiku', system: 'SYSTEM',
      messages: [{ role: 'user', content: 'USER' }], maxTokens: 2000, temperature: 0.2, isolated: true,
    })
    expect(req.messages).toHaveLength(1)
    expect('tools' in req).toBe(false)
    expect(req.metadata?.tier).toBeUndefined()
    expect(req.metadata).toEqual({
      origin: 'pipeline', autonomous: true, purpose: 'capture', auxRoute: 'default',
      conversationId: 'conv-1', runId: 'run-1', agentId: 'agent-1',
    })
    expect(Object.keys(req)).not.toContain('sessionId')
  })

  it('sends a CLI request with a provider and no model', async () => {
    const gateway = fakeGateway(['claude-code!'])
    const aux = service({ gateway, config: fakeConfig(['claude-code'], { 'claude-code': ['claude-code-fable'] }) })
    await aux.complete({ purpose: 'reflection', system: 'S', user: 'U' })
    const req = gateway.complete.mock.calls[0][0]
    expect(req.provider).toBe('claude-code')
    expect(req.model).toBeUndefined()
    expect(req.isolated).toBe(true)
    expect(req.metadata?.auxRoute).toBe('default')
  })

  it('keeps an explicit origin', async () => {
    const gateway = fakeGateway(['anthropic'])
    const aux = service({ gateway, config: fakeConfig(['anthropic'], { anthropic: ['claude-haiku'] }) })
    await aux.complete({ purpose: 'critic', system: 'S', user: 'U', origin: 'scheduled' })
    expect(gateway.complete.mock.calls[0][0].metadata?.origin).toBe('scheduled')
  })

  it('passes the real gateway\'s role guard and binding (end to end)', async () => {
    const seen: ModelRequest[] = []
    const provider: AIProvider = {
      id: 'claude-code', name: 'Claude Code', supportsIsolatedCompletion: true,
      async listModels() { return [] },
      async complete(req) { seen.push(req); return response('claude-code', 'done') },
      async *stream() {},
    }
    const gateway = createModelGateway(undefined, { getDefault: () => null })
    gateway.registerProvider(provider)
    const aux = createAuxiliaryModelService({
      getGateway: () => gateway,
      getTiers: () => [],
      getProviderConfig: () => fakeConfig(['claude-code']),
    })
    const result = await aux.complete({ purpose: 'capture', system: 'S', user: 'U' })
    expect(result).toMatchObject({ ok: true, text: 'done', provider: 'claude-code', route: 'isolated-cli' })
    expect(seen[0]).toMatchObject({ provider: 'claude-code', isolated: true, system: 'S' })
  })
})

// ── Effort intent (C11) ─────────────────────────────────────────────────────

/** A tier-effort lookup like routing/tier-store getTierEffort: the given levels, Auto (null) elsewhere. */
function tierEffort(levels: Partial<Record<RoutingTier, EffortSetting | null>>) {
  return vi.fn((t: RoutingTier): EffortSetting | null => levels[t] ?? null)
}

describe('createAuxiliaryModelService — effort intent (C11)', () => {
  const anthropic = () => fakeConfig(['anthropic'], { anthropic: ['claude-haiku'] })

  it('sends the heartbeat tier\'s effort as a tier intent for a heartbeat purpose', async () => {
    const gateway = fakeGateway(['anthropic'])
    const getTierEffort = tierEffort({ heartbeat: 'low', quick: 'high' })
    const aux = service({ gateway, config: anthropic(), tiers: [tier('heartbeat', 'anthropic', 'claude-haiku')], getTierEffort })
    await aux.complete({ purpose: 'heartbeat', system: 'S', user: 'U' })

    const req = gateway.complete.mock.calls[0][0]
    expect(req.effort).toEqual({ level: 'low', source: 'tier' })
    expect(req.metadata?.auxRoute).toBe('tier')
    expect(req.metadata?.tier).toBeUndefined()
    expect(getTierEffort).toHaveBeenCalledWith('heartbeat')
  })

  it('the planning group uses the quick tier\'s level whichever rung the candidate came from', async () => {
    const levels = { heartbeat: 'low', quick: 'medium', standard: 'high' } as const

    // Default rung: no quick tier row, the install default answers.
    const viaDefault = fakeGateway(['anthropic'])
    await service({ gateway: viaDefault, config: anthropic(), getTierEffort: tierEffort(levels) })
      .complete({ purpose: 're_planner', system: 'S', user: 'U' })
    expect(viaDefault.complete.mock.calls[0][0].metadata?.auxRoute).toBe('default')
    expect(viaDefault.complete.mock.calls[0][0].effort).toEqual({ level: 'medium', source: 'tier' })

    // API rung: the default is a CLI that cannot isolate.
    const viaApi = fakeGateway(['grok-cli', 'openai'])
    const apiConfig = fakeConfig(['grok-cli', 'openai'], { openai: ['gpt-mini'] }, { def: { providerId: 'grok-cli', modelId: 'grok-4' } })
    await service({ gateway: viaApi, config: apiConfig, getTierEffort: tierEffort(levels) })
      .complete({ purpose: 'team_proposal', system: 'S', user: 'U' })
    expect(viaApi.complete.mock.calls[0][0]).toMatchObject({ provider: 'openai', metadata: { auxRoute: 'api' } })
    expect(viaApi.complete.mock.calls[0][0].effort).toEqual({ level: 'medium', source: 'tier' })

    // Isolating CLI rung, pinned by provider only: the intent still travels.
    const viaCli = fakeGateway(['claude-code!'])
    await service({ gateway: viaCli, config: fakeConfig(['claude-code']), getTierEffort: tierEffort(levels) })
      .complete({ purpose: 're_planner', system: 'S', user: 'U' })
    expect(viaCli.complete.mock.calls[0][0]).toMatchObject({ provider: 'claude-code', metadata: { auxRoute: 'isolated-cli' } })
    expect(viaCli.complete.mock.calls[0][0].model).toBeUndefined()
    expect(viaCli.complete.mock.calls[0][0].effort).toEqual({ level: 'medium', source: 'tier' })
  })

  it('sends one intent, from the primary tier, to every candidate of a call', async () => {
    const gateway = fakeGateway(['anthropic', 'openai'])
    gateway.complete.mockRejectedValueOnce(rateLimit())
    const getTierEffort = tierEffort({ heartbeat: 'minimal', quick: 'high' })
    const aux = service({
      gateway,
      config: fakeConfig(['anthropic', 'openai'], { anthropic: ['claude-haiku'], openai: ['gpt-mini'] }),
      tiers: [tier('heartbeat', 'anthropic', 'claude-haiku'), tier('quick', 'openai', 'gpt-mini')],
      getTierEffort,
    })
    await aux.complete({ purpose: 'security_judge', system: 'S', user: 'U' })

    expect(gateway.complete).toHaveBeenCalledTimes(2)
    // The second candidate came from the quick row; the intent is still the heartbeat tier's.
    expect(gateway.complete.mock.calls[1][0].provider).toBe('openai')
    for (const [req] of gateway.complete.mock.calls) expect(req.effort).toEqual({ level: 'minimal', source: 'tier' })
    expect(getTierEffort).toHaveBeenCalledTimes(1)
    expect(getTierEffort).toHaveBeenCalledWith('heartbeat')
  })

  it('passes every rung through as a tier intent, unclamped', async () => {
    for (const level of ['none', 'max'] as const) {
      const gateway = fakeGateway(['anthropic'])
      await service({ gateway, config: anthropic(), getTierEffort: tierEffort({ triage: level }), tiers: [tier('triage', 'anthropic', 'claude-haiku')] })
        .complete({ purpose: 'triage', system: 'S', user: 'U' })
      expect(gateway.complete.mock.calls[0][0].effort).toEqual({ level, source: 'tier' })
    }
  })

  it('sends no effort when the tier is Auto, whether stored as null or \'auto\'', async () => {
    const nullTier = fakeGateway(['anthropic'])
    await service({ gateway: nullTier, config: anthropic(), getTierEffort: tierEffort({ heartbeat: 'low', standard: null }) })
      .complete({ purpose: 'research', system: 'S', user: 'U' })
    expect('effort' in nullTier.complete.mock.calls[0][0]).toBe(false)

    const autoTier = fakeGateway(['anthropic'])
    await service({ gateway: autoTier, config: anthropic(), getTierEffort: tierEffort({ triage: 'auto' }), tiers: [tier('triage', 'anthropic', 'claude-haiku')] })
      .complete({ purpose: 'triage', system: 'S', user: 'U' })
    expect('effort' in autoTier.complete.mock.calls[0][0]).toBe(false)
  })

  it('sends no effort without the seam', async () => {
    const gateway = fakeGateway(['anthropic'])
    await service({ gateway, config: anthropic() }).complete({ purpose: 'heartbeat', system: 'S', user: 'U' })
    const req = gateway.complete.mock.calls[0][0]
    expect('effort' in req).toBe(false)
    expect(req.metadata?.tier).toBeUndefined()
  })

  it('sends no effort for a value that is not a rung, or when the lookup throws — and still makes the call', async () => {
    const garbage = fakeGateway(['anthropic'])
    await service({ gateway: garbage, config: anthropic(), getTierEffort: () => 'turbo' as unknown as EffortSetting })
      .complete({ purpose: 'capture', system: 'S', user: 'U' })
    expect('effort' in garbage.complete.mock.calls[0][0]).toBe(false)

    const throwing = fakeGateway(['anthropic'])
    const result = await service({ gateway: throwing, config: anthropic(), getTierEffort: () => { throw new Error('db gone') } })
      .complete({ purpose: 'capture', system: 'S', user: 'U' })
    expect(result).toMatchObject({ ok: true })
    expect('effort' in throwing.complete.mock.calls[0][0]).toBe(false)
    expect(throwing.complete.mock.calls[0][0].metadata?.tier).toBeUndefined()
  })

  it('does not look the effort up when there is nothing to call', async () => {
    const gateway = fakeGateway(['grok-cli'])
    const getTierEffort = tierEffort({ heartbeat: 'low' })
    const result = await service({ gateway, config: fakeConfig(['grok-cli']), getTierEffort }).complete({ purpose: 'capture', system: 'S', user: 'U' })
    expect(result).toEqual({ ok: false, reason: 'no_eligible_provider' })
    expect(getTierEffort).not.toHaveBeenCalled()
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it('the real gateway resolves the tier intent against the model that answers and records requested versus effective', async () => {
    const effortModel: ReasoningCapability = {
      kind: 'effort', levels: ['low', 'medium', 'high'], defaultLevel: 'high', canDisable: false,
      thinking: 'default-off', thinkingParam: 'none', samplingLocked: false, reasoningVisible: 'hidden',
      displayParam: false, source: 'overlay',
    }
    const noControl: ReasoningCapability = { ...effortModel, kind: 'none', levels: [], defaultLevel: null }
    const seen: ModelRequest[] = []
    const provider: AIProvider = {
      id: 'anthropic', name: 'Anthropic',
      async listModels() { return [] },
      async complete(req) { seen.push(req); return response('anthropic', 'done', { model: req.model }) },
      async *stream() {},
    }
    const gateway = createModelGateway(undefined, {
      getDefault: () => null,
      getReasoningCapability: (_p, modelId) => (modelId === 'claude-haiku' ? effortModel : noControl),
    })
    gateway.registerProvider(provider)
    // Stands in for the trace wrapper, which records response.effortOutcome.
    const answered: ModelResponse[] = []
    const traced = {
      listProviders: () => gateway.listProviders(),
      complete: async (req: ModelRequest) => { const res = await gateway.complete(req); answered.push(res); return res },
    }

    const make = (model: string) => createAuxiliaryModelService({
      getGateway: () => traced,
      getTiers: () => [],
      getProviderConfig: () => fakeConfig(['anthropic'], { anthropic: [model] }),
      getTierEffort: (t) => (t === 'heartbeat' ? 'low' : null),
    })

    await make('claude-haiku').complete({ purpose: 'capture', system: 'S', user: 'U' })
    expect(seen[0].effortPlan?.level).toBe('low')
    expect(answered[0].effortOutcome).toMatchObject({ requested: 'low', effective: 'low', source: 'tier', clamped: false })

    // A model without reasoning control: nothing is sent, and the clamp is recorded.
    await make('plain-model').complete({ purpose: 'capture', system: 'S', user: 'U' })
    expect(seen[1].effortPlan?.level).toBe('auto')
    expect(answered[1].effortOutcome).toMatchObject({ requested: 'low', effective: 'auto', source: 'tier', clamped: true, reason: 'no-control' })
  })
})

describe('createAuxiliaryModelService — results', () => {
  it('returns the text with what answered and how it was chosen', async () => {
    const gateway = fakeGateway(['anthropic'])
    gateway.complete.mockResolvedValueOnce(response('anthropic', '{"notes":[]}', { model: 'claude-haiku-4-5', stopReason: 'end' }))
    const aux = service({ gateway, config: fakeConfig(['anthropic'], { anthropic: ['claude-haiku'] }), tiers: [tier('heartbeat', 'anthropic', 'claude-haiku')] })
    expect(await aux.complete({ purpose: 'capture', system: 'S', user: 'U' })).toEqual({
      ok: true, text: '{"notes":[]}', provider: 'anthropic', model: 'claude-haiku-4-5', route: 'tier',
      usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end',
    })
  })

  it('attributes the answer to the concrete model the backend reported, else the model the response names (F2)', async () => {
    const gateway = fakeGateway(['claude-code!'])
    const config = fakeConfig(['claude-code!'], { 'claude-code': ['claude-code-sonnet'] })
    gateway.complete.mockResolvedValueOnce(response('claude-code', 'ok', { model: 'claude-code-sonnet', resolvedModelId: 'claude-opus-4-8' }))
    const aux = service({ gateway, config })
    expect(await aux.complete({ purpose: 'capture', system: 'S', user: 'U' })).toMatchObject({ ok: true, provider: 'claude-code', model: 'claude-opus-4-8' })
    // Nothing reported: the id the response names stands.
    gateway.complete.mockResolvedValueOnce(response('claude-code', 'ok', { model: 'claude-code-sonnet' }))
    expect(await aux.complete({ purpose: 'capture', system: 'S', user: 'U' })).toMatchObject({ ok: true, model: 'claude-code-sonnet' })
  })

  it('joins text blocks and ignores the rest', async () => {
    const gateway = fakeGateway(['anthropic'])
    gateway.complete.mockResolvedValueOnce(response('anthropic', '', {
      content: [{ type: 'text', text: '{"a":' }, { type: 'tool_use', id: 't', name: 'x', input: {} }, { type: 'text', text: '1}' }],
    }))
    const aux = service({ gateway, config: fakeConfig(['anthropic'], { anthropic: ['claude-haiku'] }) })
    expect(await aux.complete({ purpose: 'capture', system: 'S', user: 'U' })).toMatchObject({ ok: true, text: '{"a":\n\n1}' })
  })

  it('reports empty output as empty, with what was attempted', async () => {
    const gateway = fakeGateway(['anthropic'])
    gateway.complete.mockResolvedValueOnce(response('anthropic', '   '))
    const aux = service({ gateway, config: fakeConfig(['anthropic'], { anthropic: ['claude-haiku'] }) })
    expect(await aux.complete({ purpose: 'capture', system: 'S', user: 'U' })).toEqual({
      ok: false, reason: 'empty', attempted: [{ provider: 'anthropic', model: 'claude-haiku', route: 'default' }],
    })
  })

  it('moves to the second candidate after a retryable error when the policy allows two', async () => {
    const gateway = fakeGateway(['anthropic', 'openai'])
    gateway.complete.mockRejectedValueOnce(rateLimit())
    const aux = service({
      gateway,
      config: fakeConfig(['anthropic', 'openai'], { anthropic: ['claude-haiku'], openai: ['gpt-mini'] }),
      tiers: [tier('heartbeat', 'anthropic', 'claude-haiku'), tier('quick', 'openai', 'gpt-mini')],
    })
    const result = await aux.complete({ purpose: 'security_judge', system: 'S', user: 'U' })
    expect(gateway.complete).toHaveBeenCalledTimes(2)
    expect(gateway.complete.mock.calls[1][0].provider).toBe('openai')
    expect(result).toMatchObject({ ok: true, provider: 'openai' })
  })

  it('does not try another candidate after a non-retryable error (no verdict shopping)', async () => {
    const gateway = fakeGateway(['anthropic', 'openai'])
    gateway.complete.mockRejectedValueOnce(authError())
    const aux = service({
      gateway,
      config: fakeConfig(['anthropic', 'openai'], { anthropic: ['claude-haiku'], openai: ['gpt-mini'] }),
      tiers: [tier('heartbeat', 'anthropic', 'claude-haiku'), tier('quick', 'openai', 'gpt-mini')],
    })
    const result = await aux.complete({ purpose: 'security_judge', system: 'S', user: 'U' })
    expect(gateway.complete).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      ok: false, reason: 'error',
      attempted: [{ provider: 'anthropic', model: 'claude-haiku', route: 'tier' }],
      error: { kind: 'auth', message: 'invalid api key' },
    })
  })

  it('does not try a second candidate where the policy allows one', async () => {
    const gateway = fakeGateway(['anthropic', 'openai'])
    gateway.complete.mockRejectedValueOnce(rateLimit())
    const aux = service({ gateway, config: fakeConfig(['anthropic', 'openai'], { anthropic: ['claude-haiku'], openai: ['gpt-mini'] }) })
    const result = await aux.complete({ purpose: 'capture', system: 'S', user: 'U' })
    expect(gateway.complete).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, reason: 'error', error: { kind: 'rate-limit' } })
  })

  it('does not move on once the caller cancelled', async () => {
    const gateway = fakeGateway(['anthropic', 'openai'])
    const controller = new AbortController()
    gateway.complete.mockImplementationOnce(async () => { controller.abort(); throw rateLimit() })
    const aux = service({
      gateway,
      config: fakeConfig(['anthropic', 'openai'], { anthropic: ['claude-haiku'], openai: ['gpt-mini'] }),
      tiers: [tier('heartbeat', 'anthropic', 'claude-haiku'), tier('quick', 'openai', 'gpt-mini')],
    })
    await aux.complete({ purpose: 'security_judge', system: 'S', user: 'U', signal: controller.signal })
    expect(gateway.complete).toHaveBeenCalledTimes(1)
    expect(gateway.complete.mock.calls[0][0].signal).toBe(controller.signal)
  })

  it('returns none with zero calls on a budget stop', async () => {
    const gateway = fakeGateway(['anthropic'])
    const aux = service({ gateway, config: fakeConfig(['anthropic'], { anthropic: ['claude-haiku'] }), budgetStatus: budget('stop') })
    expect(await aux.complete({ purpose: 'research', system: 'S', user: 'U' })).toEqual({ ok: false, reason: 'budget_stop' })
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it('never throws — not when the gateway throws a TypeError, not when it is missing', async () => {
    const gateway = fakeGateway(['anthropic'])
    gateway.complete.mockImplementation(async () => { throw new TypeError('boom') })
    const aux = service({ gateway, config: fakeConfig(['anthropic'], { anthropic: ['claude-haiku'] }) })
    await expect(aux.complete({ purpose: 'capture', system: 'S', user: 'U' })).resolves.toMatchObject({ ok: false, reason: 'error' })

    const missing = createAuxiliaryModelService({ getGateway: () => undefined, getTiers: () => [], getProviderConfig: () => undefined })
    await expect(missing.complete({ purpose: 'capture', system: 'S', user: 'U' })).resolves.toEqual({ ok: false, reason: 'no_eligible_provider' })

    const exploding = createAuxiliaryModelService({
      getGateway: () => { throw new Error('ctx gone') },
      getTiers: () => { throw new Error('db gone') },
      getProviderConfig: () => { throw new Error('db gone') },
    })
    await expect(exploding.complete({ purpose: 'capture', system: 'S', user: 'U' })).resolves.toMatchObject({ ok: false })
    await expect(exploding.completeText({ purpose: 'title', system: 'S', user: 'U', fallback: 'F' })).resolves.toBe('F')
  })

  it('resolves the gateway per call, so a later wrapper swap is honoured', async () => {
    let gateway = fakeGateway(['anthropic'])
    const config = fakeConfig(['anthropic'], { anthropic: ['claude-haiku'] })
    const aux = createAuxiliaryModelService({ getGateway: () => gateway, getTiers: () => [], getProviderConfig: () => config })
    const wrapped = fakeGateway(['anthropic'])
    gateway = wrapped
    await aux.complete({ purpose: 'capture', system: 'S', user: 'U' })
    expect(wrapped.complete).toHaveBeenCalledTimes(1)
  })

  it('logs the route at debug and warns once per purpose when nothing is eligible', async () => {
    const logger = { debug: vi.fn(), warn: vi.fn() }
    const grokOnly = service({ gateway: fakeGateway(['grok-cli']), config: fakeConfig(['grok-cli']), logger })
    await grokOnly.complete({ purpose: 'capture', system: 'S', user: 'U' })
    await grokOnly.complete({ purpose: 'capture', system: 'S', user: 'U' })
    await grokOnly.complete({ purpose: 'reflection', system: 'S', user: 'U' })
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.warn.mock.calls[0][0]).toEqual({ purpose: 'capture', reason: 'no_eligible_provider' })

    const ok = service({ gateway: fakeGateway(['anthropic']), config: fakeConfig(['anthropic'], { anthropic: ['claude-haiku'] }), logger })
    await ok.complete({ purpose: 'capture', system: 'S', user: 'U' })
    expect(logger.debug).toHaveBeenCalledWith(
      { purpose: 'capture', route: 'default', provider: 'anthropic', model: 'claude-haiku' },
      expect.any(String),
    )
  })
})

describe('createAuxiliaryModelService — completeText', () => {
  const make = (gateway: ReturnType<typeof fakeGateway>) =>
    service({ gateway, config: fakeConfig(gateway.providers.map((p) => p.id), { anthropic: ['claude-haiku'] }) })

  it('returns the text', async () => {
    const gateway = fakeGateway(['anthropic'])
    gateway.complete.mockResolvedValueOnce(response('anthropic', 'A title'))
    expect(await make(gateway).completeText({ purpose: 'heartbeat', system: 'S', user: 'U', fallback: 'F' })).toBe('A title')
  })

  it('returns the text when the output hit max_tokens', async () => {
    const gateway = fakeGateway(['anthropic'])
    gateway.complete.mockResolvedValueOnce(response('anthropic', 'truncated but useful', { stopReason: 'max_tokens' }))
    expect(await make(gateway).completeText({ purpose: 'heartbeat', system: 'S', user: 'U', fallback: 'F' })).toBe('truncated but useful')
  })

  it('returns the fallback on none, empty, error and refusal', async () => {
    expect(await make(fakeGateway(['grok-cli'])).completeText({ purpose: 'heartbeat', system: 'S', user: 'U', fallback: 'F' })).toBe('F')

    const empty = fakeGateway(['anthropic'])
    empty.complete.mockResolvedValueOnce(response('anthropic', ''))
    expect(await make(empty).completeText({ purpose: 'heartbeat', system: 'S', user: 'U', fallback: 'F' })).toBe('F')

    const failing = fakeGateway(['anthropic'])
    failing.complete.mockRejectedValueOnce(authError())
    expect(await make(failing).completeText({ purpose: 'heartbeat', system: 'S', user: 'U', fallback: 'F' })).toBe('F')

    const refusing = fakeGateway(['anthropic'])
    refusing.complete.mockResolvedValueOnce(response('anthropic', 'I cannot help with that.', { stopReason: 'refusal' }))
    expect(await make(refusing).completeText({ purpose: 'heartbeat', system: 'S', user: 'U', fallback: 'F' })).toBe('F')
  })

  it('never sends the fallback to the model', async () => {
    const gateway = fakeGateway(['anthropic'])
    await make(gateway).completeText({ purpose: 'heartbeat', system: 'S', user: 'U', fallback: 'SECRET-FALLBACK' })
    expect(JSON.stringify(gateway.complete.mock.calls[0][0])).not.toContain('SECRET-FALLBACK')
  })
})

describe('createAuxiliaryModelService — describe', () => {
  it('reports the target of every group', () => {
    const aux = service({
      gateway: fakeGateway(['anthropic', 'claude-code!']),
      config: fakeConfig(['anthropic', 'claude-code'], { anthropic: ['claude-haiku'] }),
      tiers: [tier('heartbeat', 'claude-code', 'claude-code-haiku')],
    })
    const groups = aux.describe()
    expect(groups.map((g) => g.group).sort()).toEqual(Object.keys(AUX_POLICY).sort())
    expect(groups.find((g) => g.group === 'memory')).toEqual({
      group: 'memory', purposes: ['capture', 'consolidation', 'reflection', 'data_port_enrichment'],
      target: { provider: 'claude-code', model: null, route: 'tier' }, reason: null,
    })
    expect(groups.find((g) => g.group === 'planning')?.target).toEqual({ provider: 'anthropic', model: 'claude-haiku', route: 'default' })
    expect(groups.find((g) => g.group === 'triage')).toMatchObject({ target: null, reason: 'tier_not_configured' })
  })

  it('reports no eligible provider for every group on a Grok-only install', () => {
    const aux = service({ gateway: fakeGateway(['grok-cli']), config: fakeConfig(['grok-cli']), tiers: [tier('heartbeat', 'grok-cli', 'g')] })
    for (const g of aux.describe()) {
      expect(g.target).toBeNull()
      expect(g.reason).toBe(g.group === 'triage' ? 'tier_not_configured' : 'no_eligible_provider')
    }
  })
})

describe('the purpose table', () => {
  it('maps every purpose to a group with a policy', () => {
    for (const purpose of EVERY_PURPOSE) expect(AUX_POLICY[AUX_PURPOSE_GROUP[purpose]]).toBeDefined()
  })

  it('keeps titles and triage on their own tier only', () => {
    expect(AUX_POLICY.title).toMatchObject({ tiers: ['heartbeat'], tierOnly: true })
    expect(AUX_POLICY.triage).toMatchObject({ tiers: ['triage'], tierOnly: true })
    expect(AUX_POLICY.safety).toMatchObject({ tiers: ['heartbeat', 'quick'], maxCandidates: 2 })
  })
})

describe('the fake auxiliary model (consumer tests)', () => {
  it('records calls and follows its script, the last step repeating', async () => {
    const fake = createFakeAuxiliaryModel([auxOk('first'), auxNone(), auxError('down')])
    expect(await fake.complete({ purpose: 'capture', system: 'S', user: 'U1' })).toMatchObject({ ok: true, text: 'first' })
    expect(await fake.complete({ purpose: 'capture', system: 'S', user: 'U2' })).toEqual({ ok: false, reason: 'no_eligible_provider' })
    expect(await fake.completeText({ purpose: 'title', system: 'S', user: 'U3', fallback: 'F' })).toBe('F')
    expect(await fake.complete({ purpose: 'capture', system: 'S', user: 'U4' })).toMatchObject({ ok: false, reason: 'error' })
    expect(fake.calls.map((c) => c.user)).toEqual(['U1', 'U2', 'U3', 'U4'])
  })
})
