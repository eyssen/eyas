// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F6 — the Anthropic API provider against the REAL @anthropic-ai/sdk (a
// stubbed fetch, no module mock), so the SDK's own pagination, request
// serialization and error handling run:
//   - Models API discovery (GET /v1/models) maps per-model capabilities into
//     THE discovered-reasoning shape, which model_config persists and the
//     capability registry merges over the overlay;
//   - the first load seeds from discovery, falling back to the built-in
//     catalog when the list cannot be read;
//   - the reasoning body shape (output_config / thinking / sampling) is what
//     the SDK actually puts on the wire.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ModuleContext } from '@core/types'
import { createAnthropicProvider, ANTHROPIC_MODELS, anthropicModelFromApi, reasoningFromModelCapabilities } from '@modules/model/submodules/anthropic/provider'
import { seedAnthropicModels, anthropicManifest } from '@modules/model/submodules/anthropic/manifest'
import { createAnthropicCompatProvider } from '@modules/model/submodules/anthropic-compat/provider'
import { ANTHROPIC_COMPAT_CATALOG } from '@modules/model/submodules/anthropic-compat/catalog'
import { createProviderConfigService, type ProviderConfigService } from '@modules/model/provider-config-service'
import { createReasoningRegistry, loadBundledOverlay, type ReasoningRegistry } from '@modules/model/reasoning/registry'
import { resolveEffortPlan } from '@modules/model/reasoning/resolve'
import type { EffortSetting } from '@modules/model/reasoning/ladder'
import type { ModelRequest, StreamEvent } from '@modules/model/types'
import { createTestDb } from '../../../helpers/test-db'
import { jsonResponse, sseResponse, textAnswerEvents } from '../../../helpers/anthropic-wire'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const yes = { supported: true }
const no = { supported: false }

/** A Models API entry with the full capability tree, the way the API returns it. */
function apiModel(id: string, opts: {
  name?: string
  input?: number | null
  output?: number | null
  effort?: Partial<Record<'low' | 'medium' | 'high' | 'xhigh' | 'max', boolean | null>> | false
  adaptive?: boolean
  budget?: boolean
  thinking?: boolean
  images?: boolean
} = {}) {
  const levels = opts.effort === false ? {} : (opts.effort ?? { low: true, medium: true, high: true, xhigh: true, max: true })
  const support = (v: boolean | null | undefined) => (v === null ? null : v ? yes : no)
  return {
    type: 'model',
    id,
    display_name: opts.name ?? id,
    created_at: '2026-09-01T00:00:00Z',
    max_input_tokens: opts.input === undefined ? 1_000_000 : opts.input,
    max_tokens: opts.output === undefined ? 128_000 : opts.output,
    capabilities: {
      batch: yes,
      citations: yes,
      code_execution: yes,
      context_management: { supported: true, clear_thinking_20251015: yes, clear_tool_uses_20250919: yes, compact_20260112: yes },
      image_input: support(opts.images ?? true),
      pdf_input: yes,
      structured_outputs: yes,
      effort: {
        supported: opts.effort !== false,
        low: support(levels.low ?? false),
        medium: support(levels.medium ?? false),
        high: support(levels.high ?? false),
        max: support(levels.max ?? false),
        xhigh: levels.xhigh === null ? null : support(levels.xhigh ?? false),
      },
      thinking: {
        supported: opts.thinking ?? true,
        types: { adaptive: support(opts.adaptive ?? true), enabled: support(opts.budget ?? false) },
      },
    },
  }
}

const LISTED = [
  apiModel('claude-opus-5-5', { name: 'Claude Opus 5.5' }),
  // The API says no xhigh here, although the overlay row lists it: discovery wins on levels.
  apiModel('claude-opus-4-8', { name: 'Claude Opus 4.8', effort: { low: true, medium: true, high: true, xhigh: false, max: true } }),
  apiModel('claude-opus-4-6', { name: 'Claude Opus 4.6', effort: { low: true, medium: true, high: true, xhigh: null, max: true }, budget: true }),
  apiModel('claude-haiku-4-5', { name: 'Claude Haiku 4.5', input: 200_000, output: 64_000, effort: false, adaptive: false, budget: true }),
]

interface WireCall { url: string; method: string; headers: Headers; body: string }

/** A fetch answering each call with the next reply, recording URL, method, headers and raw body. */
function wire(replies: Array<() => Response>) {
  const calls: WireCall[] = []
  let n = 0
  const fetch = async (input: unknown, init?: { method?: string; headers?: HeadersInit; body?: unknown }) => {
    calls.push({
      url: String(input instanceof Request ? input.url : input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : '',
    })
    const next = replies[n++]
    if (!next) throw new Error(`wire: no reply for call ${n}`)
    return next()
  }
  return { fetch, calls }
}

const page = (data: unknown[], more?: { lastId: string }) =>
  () => jsonResponse({ data, has_more: !!more, first_id: (data[0] as any)?.id ?? null, last_id: more?.lastId ?? null })

const serverError = () => new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }), {
  status: 500,
  headers: { 'content-type': 'application/json' },
})

afterEach(() => vi.unstubAllGlobals())

// ─── Discovery mapping ───────────────────────────────────────────────────────

describe('Models API discovery (positive)', () => {
  it('lists the models with their window, output cap and discovered reasoning', async () => {
    const w = wire([page(LISTED)])
    vi.stubGlobal('fetch', w.fetch)
    const models = await createAnthropicProvider('sk-test').fetchModels!()

    expect(w.calls).toHaveLength(1)
    expect(w.calls[0].method).toBe('GET')
    expect(new URL(w.calls[0].url).pathname).toBe('/v1/models')
    expect(new URL(w.calls[0].url).searchParams.get('limit')).toBe('100')
    expect(w.calls[0].headers.get('x-api-key')).toBe('sk-test')

    expect(models.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-opus-4-8', 'claude-opus-4-6', 'claude-haiku-4-5'])
    const haiku = models.find((m) => m.id === 'claude-haiku-4-5')!
    expect(haiku).toMatchObject({ name: 'Claude Haiku 4.5', provider: 'anthropic', contextWindow: 200_000, maxOutputTokens: 64_000 })

    const reasoning = (id: string) => (models.find((m) => m.id === id)!.metadata as any).reasoning
    expect(reasoning('claude-opus-5-5')).toMatchObject({ source: 'models-api', param: 'effort', levels: ['low', 'medium', 'high', 'xhigh', 'max'], adaptiveThinking: true })
    expect(reasoning('claude-opus-4-8').levels).toEqual(['low', 'medium', 'high', 'max'])
    expect(reasoning('claude-opus-4-6').levels).toEqual(['low', 'medium', 'high', 'max'])
    expect(reasoning('claude-haiku-4-5')).toMatchObject({ param: 'budget', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], adaptiveThinking: false })
    expect(typeof reasoning('claude-haiku-4-5').discoveredAt).toBe('string')
  })

  it('follows the pagination cursor to the last page', async () => {
    const w = wire([page(LISTED.slice(0, 2), { lastId: 'claude-opus-4-8' }), page(LISTED.slice(2))])
    vi.stubGlobal('fetch', w.fetch)
    const models = await createAnthropicProvider('sk-test').fetchModels!()
    expect(models).toHaveLength(4)
    expect(new URL(w.calls[1].url).searchParams.get('after_id')).toBe('claude-opus-4-8')
  })

  it('a model that reports no reasoning at all is recorded as such', () => {
    const plain = anthropicModelFromApi(apiModel('claude-plain', { effort: false, thinking: false, adaptive: false }), '2026-09-22T00:00:00Z')!
    expect((plain.metadata as any).reasoning).toEqual({ source: 'models-api', param: 'none', levels: [], discoveredAt: '2026-09-22T00:00:00Z' })
  })
})

describe('Models API discovery (negative)', () => {
  it('a list failure rejects (one attempt, no retry storm); the caller keeps what it has', async () => {
    const w = wire([serverError, serverError, serverError])
    vi.stubGlobal('fetch', w.fetch)
    await expect(createAnthropicProvider('sk-test').fetchModels!()).rejects.toThrow()
    expect(w.calls).toHaveLength(1)
  })

  it('an entry without a usable id is skipped; missing limits fall back to the catalog, then to safe defaults', () => {
    expect(anthropicModelFromApi({ display_name: 'no id' }, '2026-09-22T00:00:00Z')).toBeNull()
    expect(anthropicModelFromApi({ id: '' }, '2026-09-22T00:00:00Z')).toBeNull()
    const known = anthropicModelFromApi({ id: 'claude-haiku-4-5', max_input_tokens: null, max_tokens: null, capabilities: null }, '2026-09-22T00:00:00Z')!
    expect(known).toMatchObject({ contextWindow: 200_000, maxOutputTokens: 64_000, name: 'Claude Haiku 4.5' })
    const unknown = anthropicModelFromApi({ id: 'claude-next' }, '2026-09-22T00:00:00Z')!
    expect(unknown.contextWindow).toBeGreaterThan(0)
    expect(unknown.maxOutputTokens).toBeGreaterThan(0)
  })

  it('capabilities that are absent or not definite leave reasoning to the overlay (no metadata.reasoning)', () => {
    expect(reasoningFromModelCapabilities(null, '2026-09-22T00:00:00Z')).toBeNull()
    expect(reasoningFromModelCapabilities({ thinking: { supported: true } } as any, '2026-09-22T00:00:00Z')).toBeNull()
    expect(reasoningFromModelCapabilities({ effort: { supported: true } } as any, '2026-09-22T00:00:00Z')).toBeNull()
    const noCaps = anthropicModelFromApi({ id: 'claude-next', capabilities: null }, '2026-09-22T00:00:00Z')!
    expect(noCaps.metadata).not.toHaveProperty('reasoning')
  })
})

// ─── First load: discovery seed, built-in fallback ──────────────────────────

describe('first-load seeding', () => {
  const testDb = createTestDb('anthropic-seed')
  let svc: ProviderConfigService
  let registry: ReasoningRegistry
  let ctx: ModuleContext
  let warn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const db = testDb.open()
    svc = createProviderConfigService(db)
    svc.ensureProvider('anthropic')
    svc.updateProvider('anthropic', { enabled: true })
    registry = createReasoningRegistry({
      overlay: loadBundledOverlay(),
      getDiscovered: (p, m) => svc.getModelMetadata(p, m)?.reasoning ?? null,
      getRealModelId: (p, m) => svc.getModelMetadata(p, m)?.realModelId,
    })
    vi.spyOn(registry, 'invalidate')
    warn = vi.fn()
    const providers = new Map<string, unknown>()
    ctx = {
      providerConfig: svc,
      reasoningRegistry: registry,
      providerReload: new Map(),
      secrets: { get: async () => 'sk-test' },
      model: {
        registerProvider: (p: any) => providers.set(p.id, p),
        unregisterProvider: (id: string) => providers.delete(id),
        getProvider: (id: string) => providers.get(id),
      },
      logger: { warn, info: vi.fn(), debug: vi.fn() },
    } as unknown as ModuleContext
  })
  afterEach(() => testDb.cleanup())

  it('seeds the discovered models, and the registry reads their discovered levels (positive)', async () => {
    vi.stubGlobal('fetch', wire([page(LISTED)]).fetch)
    expect(await seedAnthropicModels(ctx, createAnthropicProvider('sk-test'))).toBe('discovered')

    expect(svc.listModels('anthropic').map((r) => r.modelId).sort()).toEqual(['claude-haiku-4-5', 'claude-opus-4-6', 'claude-opus-4-8', 'claude-opus-5-5'])
    expect(svc.getModelMetadata('anthropic', 'claude-opus-5-5')?.reasoning?.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(registry.invalidate).toHaveBeenCalledWith('anthropic')

    // Discovery decides the levels; the overlay keeps the facts the API never reports.
    const opus48 = registry.get('anthropic', 'claude-opus-4-8')
    expect(opus48.source).toBe('merged')
    expect(opus48.levels).not.toContain('xhigh')
    expect(opus48.canDisable).toBe(true)
    const opus55 = registry.get('anthropic', 'claude-opus-5-5')
    expect(opus55.defaultLevel).toBe('medium')
    expect(opus55.levels).not.toContain('none')
    expect(registry.get('anthropic', 'claude-haiku-4-5')).toMatchObject({ kind: 'budget', budget: { min: 1024 } })
  })

  it('onStart on a fresh install with a key discovers the catalog (positive)', async () => {
    const w = wire([page(LISTED)])
    vi.stubGlobal('fetch', w.fetch)
    await anthropicManifest.onStart!(ctx)
    expect(w.calls).toHaveLength(1)
    expect(svc.listModels('anthropic')).toHaveLength(LISTED.length)
  })

  it('a list failure falls back to the built-in catalog, with a warning (negative)', async () => {
    vi.stubGlobal('fetch', wire([serverError]).fetch)
    expect(await seedAnthropicModels(ctx, createAnthropicProvider('sk-test'))).toBe('builtin')
    expect(svc.listModels('anthropic').map((r) => r.modelId).sort()).toEqual(ANTHROPIC_MODELS.map((m) => m.id).sort())
    expect(svc.getModelMetadata('anthropic', 'claude-opus-5-5')).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('an empty list proves nothing: the built-in catalog is seeded (negative)', async () => {
    vi.stubGlobal('fetch', wire([page([])]).fetch)
    expect(await seedAnthropicModels(ctx, createAnthropicProvider('sk-test'))).toBe('builtin')
    expect(svc.listModels('anthropic')).toHaveLength(ANTHROPIC_MODELS.length)
  })

  it('a provider that already has rows is never re-seeded: no Models API call on load (negative)', async () => {
    svc.upsertModels('anthropic', [ANTHROPIC_MODELS[0]])
    const w = wire([])
    vi.stubGlobal('fetch', w.fetch)
    await anthropicManifest.onStart!(ctx)
    expect(w.calls).toHaveLength(0)
    expect(svc.listModels('anthropic')).toHaveLength(1)
  })
})

// ─── Reasoning on the wire, serialized by the real SDK ──────────────────────

describe('reasoning body shape on the wire', () => {
  const registry = createReasoningRegistry({ overlay: loadBundledOverlay(), getDiscovered: () => null })
  const cap = (id: string) => ANTHROPIC_MODELS.find((m) => m.id === id)?.maxOutputTokens ?? 16_384
  const planFor = (provider: string, model: string, level: EffortSetting, streaming: boolean) => resolveEffortPlan({
    intent: { level, source: 'conversation' },
    capability: registry.get(provider, model),
    maxOutputTokens: cap(model),
    streaming,
  }).plan

  async function drain(stream: AsyncIterable<StreamEvent>) { for await (const _ of stream) { /* consume */ } }
  const ask = (model: string, extra: Partial<ModelRequest> = {}): ModelRequest => ({ model, messages: [{ role: 'user', content: 'hi' }], ...extra })
  const okMessage = (model: string) => () => jsonResponse({
    id: 'msg_1', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
  })

  it("Opus 5.5 'xhigh' (stream): output_config.effort xhigh, adaptive + summarized thinking, room for it, no temperature (positive)", async () => {
    const w = wire([() => sseResponse(textAnswerEvents('ok', 'claude-opus-5-5'))])
    vi.stubGlobal('fetch', w.fetch)
    await drain(createAnthropicProvider('k').stream(ask('claude-opus-5-5', { temperature: 0.5, effortPlan: planFor('anthropic', 'claude-opus-5-5', 'xhigh', true) })))
    const body = JSON.parse(w.calls[0].body)
    expect(body.output_config).toEqual({ effort: 'xhigh' })
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(body.max_tokens).toBe(64_000)
    expect(body).not.toHaveProperty('temperature')
  })

  it("Haiku 4.5 'high' (complete): a budget strictly below max_tokens, within the plain-HTTP bound (positive)", async () => {
    const w = wire([okMessage('claude-haiku-4-5')])
    vi.stubGlobal('fetch', w.fetch)
    await createAnthropicProvider('k').complete(ask('claude-haiku-4-5', { effortPlan: planFor('anthropic', 'claude-haiku-4-5', 'high', false) }))
    const body = JSON.parse(w.calls[0].body)
    expect(body).not.toHaveProperty('output_config')
    expect(body.thinking.type).toBe('enabled')
    expect(body.thinking.budget_tokens).toBeGreaterThanOrEqual(1024)
    expect(body.thinking.budget_tokens).toBeLessThan(body.max_tokens)
    expect(body.max_tokens).toBeLessThanOrEqual(21_333)
  })

  it("Opus 4.8 'auto': neither thinking nor output_config reaches the wire (negative)", async () => {
    const w = wire([okMessage('claude-opus-4-8')])
    vi.stubGlobal('fetch', w.fetch)
    await createAnthropicProvider('k').complete(ask('claude-opus-4-8', { effortPlan: planFor('anthropic', 'claude-opus-4-8', 'auto', false) }))
    expect(w.calls[0].body).not.toContain('"thinking"')
    expect(w.calls[0].body).not.toContain('"output_config"')
  })

  it('an Anthropic-compatible catalog model gets no reasoning control until an overlay row verifies it (negative)', async () => {
    const compat = ANTHROPIC_COMPAT_CATALOG[0]!
    const w = wire([() => sseResponse(textAnswerEvents('ok', compat.defaultModel))])
    vi.stubGlobal('fetch', w.fetch)
    const plan = planFor(compat.id, compat.defaultModel!, 'high', true)
    expect(plan.level).toBe('auto')
    await drain(createAnthropicCompatProvider(compat, 'k').stream(ask(compat.defaultModel!, { temperature: 0.4, effortPlan: plan })))
    const body = JSON.parse(w.calls[0].body)
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('output_config')
    expect(body.temperature).toBe(0.4)
  })

  it('an Anthropic-compatible model with a verified row uses the same mapper (positive)', async () => {
    const compat = ANTHROPIC_COMPAT_CATALOG[0]!
    const base = loadBundledOverlay()
    const verified = createReasoningRegistry({
      getDiscovered: () => null,
      overlay: {
        ...base,
        rows: [{
          id: 'test-compat-effort',
          match: { providers: [compat.id], model: `^${compat.defaultModel}$` },
          capability: { kind: 'effort', levels: ['low', 'medium', 'high'], defaultLevel: 'medium', canDisable: false, thinking: 'default-off', thinkingParam: 'adaptive', samplingLocked: false, reasoningVisible: 'summary', displayParam: false },
          source: 'test fixture',
          verified: '2026-09-22',
          evidence: 'verified-docs',
        }],
      },
    })
    const plan = resolveEffortPlan({ intent: { level: 'high', source: 'conversation' }, capability: verified.get(compat.id, compat.defaultModel!), maxOutputTokens: 16_384, streaming: true }).plan
    const w = wire([() => sseResponse(textAnswerEvents('ok', compat.defaultModel))])
    vi.stubGlobal('fetch', w.fetch)
    await drain(createAnthropicCompatProvider(compat, 'k').stream(ask(compat.defaultModel!, { effortPlan: plan })))
    const body = JSON.parse(w.calls[0].body)
    expect(body.output_config).toEqual({ effort: 'high' })
    expect(body.thinking).toEqual({ type: 'adaptive' })
  })
})
