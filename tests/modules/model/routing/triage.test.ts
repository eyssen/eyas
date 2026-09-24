// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Triage (C7): the keyword rules decide for free; only a message they cannot
// place goes to the Triage tier's model, and that call runs through the
// auxiliary model service — isolated, one user message, the instruction in
// request.system, only on a provider that can isolate, through whatever
// gateway ctx.model is at call time (privacy and tracing included). Anything
// short of a valid verdict keeps the keyword result.

import { describe, it, expect, vi } from 'vitest'
import { keywordTriage, llmTriage, triage, TRIAGE_CONFIDENCE_THRESHOLD } from '@modules/model/routing/triage'
import { createDecisionEngine } from '@modules/model/routing/decision-engine'
import { createAuxiliaryModelService, type AuxiliaryModelService } from '@modules/model/auxiliary'
import { createLazyGateway } from '@modules/model/lazy-gateway'
import type { BindingProviderConfig } from '@modules/model/binding'
import type { BudgetStatus, RoutingTier, TierConfig } from '@modules/model/routing/types'
import type { AIProvider, ModelGateway, ModelInfo, ModelRequest, ModelResponse } from '@modules/model/types'
import {
  auxEmpty, auxError, auxNone, auxOk, createFakeAuxiliaryModel, createGatewayBackedAuxiliaryModel,
} from '../../../helpers/fake-auxiliary-model'

// No keyword rule matches this: keyword confidence 0.3, so the model is asked.
const UNPLACEABLE = 'hello there, my friend'
// "translate" matches one rule: confidence 0.65, no model call.
const PLACEABLE = 'please translate this paragraph'

function tier(name: RoutingTier, providerId: string, modelId: string, extra: Partial<TierConfig> = {}): TierConfig {
  return {
    tier: name, providerId, modelId, fallbackProviderId: null, fallbackModelId: null,
    description: '', enabled: true, updatedAt: '', ...extra,
  }
}

const VERDICT = '{"category": "code_review", "complexity": "complex"}'

describe('triage — keyword first', () => {
  it('a message the keyword rules place makes zero model calls (positive)', async () => {
    expect(keywordTriage(PLACEABLE).confidence).toBeGreaterThanOrEqual(TRIAGE_CONFIDENCE_THRESHOLD)
    const aux = createFakeAuxiliaryModel(auxOk(VERDICT))
    const result = await triage(PLACEABLE, aux)
    expect(aux.calls).toHaveLength(0)
    expect(result).toMatchObject({ category: 'translation', tier: 'quick' })
  })

  it('an unplaceable message with an eligible Triage tier makes one isolated triage call and applies it (positive)', async () => {
    const { aux, requests } = createGatewayBackedAuxiliaryModel({
      answer: VERDICT,
      tiers: [tier('triage', 'fake-api', 'fake-model')],
    })
    const result = await triage(UNPLACEABLE, aux, { conversationId: 'conv-1' })

    expect(requests).toHaveLength(1)
    const req = requests[0]
    expect(req).toMatchObject({ provider: 'fake-api', model: 'fake-model', isolated: true, maxTokens: 60, temperature: 0 })
    expect(req.system).toContain('message classifier')
    expect(req.messages).toHaveLength(1)
    expect(req.messages[0].role).toBe('user')
    expect(String(req.messages[0].content)).toContain(UNPLACEABLE)
    expect(req.tools).toBeUndefined()
    expect(req.metadata).toMatchObject({ purpose: 'triage', origin: 'interactive', auxRoute: 'tier', conversationId: 'conv-1' })
    expect(req.metadata?.tier).toBeUndefined()

    expect(result).toMatchObject({ category: 'code_review', complexity: 'complex', tier: 'complex', confidence: 0.85 })
  })

  it('the Triage tier\'s fallback row answers when its primary cannot isolate — no manual second branch (positive)', async () => {
    const { aux, requests } = createGatewayBackedAuxiliaryModel({
      answer: VERDICT,
      providers: ['grok-cli', 'fake-api'],
      tiers: [tier('triage', 'grok-cli', 'grok-cli-default', { fallbackProviderId: 'fake-api', fallbackModelId: 'fake-model' })],
    })
    const result = await triage(UNPLACEABLE, aux)
    expect(requests.map((r) => r.provider)).toEqual(['fake-api'])
    expect(result.category).toBe('code_review')
  })

  it('a verdict in another case or with padding is still read (positive)', async () => {
    const aux = createFakeAuxiliaryModel(auxOk('Sure: { "category": " Debugging ", "complexity": "SIMPLE" }'))
    const result = await llmTriage(UNPLACEABLE, aux)
    expect(result).toMatchObject({ category: 'debugging', complexity: 'simple', tier: 'quick' })
  })

  it('only the first 500 characters of the message are classified', async () => {
    const aux = createFakeAuxiliaryModel(auxOk(VERDICT))
    const long = `${'x'.repeat(500)}TAIL-NOT-SENT`
    await llmTriage(long, aux)
    expect(aux.calls[0].user).not.toContain('TAIL-NOT-SENT')
  })
})

describe('triage — every failure keeps the keyword result', () => {
  const keyword = keywordTriage(UNPLACEABLE)

  it('a Grok-only install (the Triage tier on a CLI that cannot isolate) makes zero provider calls (negative)', async () => {
    const { aux, requests } = createGatewayBackedAuxiliaryModel({
      answer: VERDICT,
      providers: ['grok-cli'],
      tiers: [tier('triage', 'grok-cli', 'grok-cli-default')],
    })
    const result = await triage(UNPLACEABLE, aux)
    expect(requests).toHaveLength(0)
    expect(result).toEqual(keyword)
  })

  it('no Triage tier: the classifier never falls to the default or another provider (negative)', async () => {
    const { aux, requests } = createGatewayBackedAuxiliaryModel({ answer: VERDICT, tiers: [tier('standard', 'fake-api', 'fake-model')] })
    expect(await triage(UNPLACEABLE, aux)).toEqual(keyword)
    expect(requests).toHaveLength(0)
  })

  it.each([
    ['none', auxNone('no_eligible_provider')],
    ['budget stop', auxNone('budget_stop')],
    ['error', auxError('boom')],
    ['empty answer', auxEmpty()],
    ['not JSON', auxOk('I think this is chat.')],
    ['unknown category', auxOk('{"category": "world_domination", "complexity": "simple"}')],
    ['unknown complexity', auxOk('{"category": "chat", "complexity": "galactic"}')],
    ['malformed JSON', auxOk('{"category": chat, "complexity": }')],
    ['refusal', auxOk(VERDICT, { stopReason: 'refusal' })],
  ])('%s → the keyword result (negative)', async (_label, step) => {
    const aux = createFakeAuxiliaryModel(step)
    expect(await triage(UNPLACEABLE, aux)).toEqual(keyword)
    expect(aux.calls).toHaveLength(1)
  })

  it('no auxiliary service → the keyword result (negative)', async () => {
    expect(await triage(UNPLACEABLE, undefined)).toEqual(keyword)
  })

  it('a stand-in that throws still costs only the classification (negative)', async () => {
    const broken = { complete: vi.fn(async () => { throw new Error('broken') }) } as unknown as AuxiliaryModelService
    expect(await triage(UNPLACEABLE, broken)).toEqual(keyword)
  })
})

// ── The decision engine reads ctx.model per call ────────────────────────────

const OK_BUDGET: BudgetStatus = {
  daily: { spent: 0, limit: 0, action: 'ok' },
  weekly: { spent: 0, limit: 0, action: 'ok' },
  monthly: { spent: 0, limit: 0, action: 'ok' },
}

const MODELS: Record<string, string[]> = {
  'fake-api': ['small', 'mid', 'big'],
  'grok-cli': ['grok-cli-default', 'grok-cli-heavy'],
}

function fakeProvider(id: string, complete: (req: ModelRequest) => Promise<ModelResponse>): AIProvider {
  return { id, name: id, async listModels() { return [] }, complete, async *stream() { throw new Error('no stream') } }
}

function providerConfig(ids: string[]): BindingProviderConfig {
  const row = (id: string) => ({ id, enabled: true, settings: {}, isDefault: false, defaultModel: null, updatedAt: '' })
  return {
    getProvider: (id) => (ids.includes(id) ? row(id) : null),
    getDefault: () => null,
    listProviders: () => ids.map(row),
    listEnabledModels: (id): ModelInfo[] => (MODELS[id] ?? []).map((m) => ({
      id: m, name: m, provider: id, contextWindow: 1000, maxOutputTokens: 100,
      supportsTools: true, supportsImages: false, supportsStreaming: true,
    })),
  }
}

/**
 * The model module's wiring in miniature: ctx.auxiliaryModel reads ctx.model
 * per call, the engine gets a lazy gateway and a getter for the service, and
 * a wrapper module (privacy, tracing) replaces ctx.model afterwards.
 */
function world(providers: AIProvider[], tiers: TierConfig[], opts: { withAux?: boolean } = {}) {
  const raw = new Map(providers.map((p) => [p.id, p]))
  const rawGateway = {
    getProvider: (id: string) => raw.get(id),
    listProviders: () => [...raw.values()],
    complete: (req: ModelRequest) => raw.get(req.provider!)!.complete(req),
  } as unknown as ModelGateway
  const ctx: { model: ModelGateway; auxiliaryModel?: AuxiliaryModelService } = { model: rawGateway }
  if (opts.withAux !== false) {
    ctx.auxiliaryModel = createAuxiliaryModelService({
      getGateway: () => ctx.model,
      getTiers: () => tiers,
      getProviderConfig: () => providerConfig(providers.map((p) => p.id)),
    })
  }
  const engine = createDecisionEngine({
    gateway: createLazyGateway(() => ctx.model),
    getAux: () => ctx.auxiliaryModel,
    getTiers: () => tiers,
    getBudget: () => ({ dailyLimit: null, weeklyLimit: null, monthlyLimit: null, warnAt: 0.8, downgradeAt: 1, hardStopAt: 1.2 }),
    getSpending: () => OK_BUDGET,
  })
  // Installed AFTER the engine exists, like observability's tracing wrapper.
  const wrapped: ModelRequest[] = []
  ctx.model = {
    ...rawGateway,
    getProvider: (id: string) => rawGateway.getProvider(id),
    listProviders: () => rawGateway.listProviders(),
    complete: (req: ModelRequest) => { wrapped.push(req); return rawGateway.complete(req) },
  }
  return { engine, wrapped }
}

const answer = (text: string) => vi.fn(async (req: ModelRequest): Promise<ModelResponse> => ({
  id: 'r', provider: req.provider!, model: req.model ?? 'cli-default',
  content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
}))

describe('decision engine — triage goes through the current gateway', () => {
  const apiTiers = [
    tier('triage', 'fake-api', 'small'),
    tier('quick', 'fake-api', 'small'),
    tier('standard', 'fake-api', 'mid'),
    tier('complex', 'fake-api', 'big'),
  ]

  it('a wrapper installed on ctx.model after the engine was built sees the triage request (positive)', async () => {
    const complete = answer(VERDICT)
    const { engine, wrapped } = world([fakeProvider('fake-api', complete)], apiTiers)
    const decision = await engine.route(UNPLACEABLE, { conversationId: 'conv-7' })

    expect(wrapped).toHaveLength(1)
    expect(wrapped[0]).toMatchObject({ provider: 'fake-api', model: 'small', isolated: true })
    expect(wrapped[0].metadata).toMatchObject({ purpose: 'triage', conversationId: 'conv-7' })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(decision).toMatchObject({ tier: 'complex', provider: 'fake-api', model: 'big', strategy: 'triage' })
  })

  it('a placeable message routes on the keyword result with no model call (negative)', async () => {
    const complete = answer(VERDICT)
    const { engine, wrapped } = world([fakeProvider('fake-api', complete)], apiTiers)
    const decision = await engine.route(PLACEABLE)
    expect(wrapped).toHaveLength(0)
    expect(complete).not.toHaveBeenCalled()
    expect(decision).toMatchObject({ tier: 'quick', model: 'small' })
  })

  it('a Grok-only install with distinct tiers keeps the keyword result and makes zero provider calls (negative)', async () => {
    const complete = answer(VERDICT)
    const { engine, wrapped } = world([fakeProvider('grok-cli', complete)], [
      tier('triage', 'grok-cli', 'grok-cli-default'),
      tier('quick', 'grok-cli', 'grok-cli-default'),
      tier('standard', 'grok-cli', 'grok-cli-default'),
      tier('complex', 'grok-cli', 'grok-cli-heavy'),
    ])
    const decision = await engine.route(UNPLACEABLE)
    expect(wrapped).toHaveLength(0)
    expect(complete).not.toHaveBeenCalled()
    expect(decision).toMatchObject({ tier: keywordTriage(UNPLACEABLE).tier, confidence: 0.3, strategy: 'triage' })
  })

  it('without the auxiliary service the engine never calls a model itself (negative)', async () => {
    const complete = answer(VERDICT)
    const { engine, wrapped } = world([fakeProvider('fake-api', complete)], apiTiers, { withAux: false })
    const decision = await engine.route(UNPLACEABLE)
    expect(wrapped).toHaveLength(0)
    expect(complete).not.toHaveBeenCalled()
    expect(decision.confidence).toBe(0.3)
  })
})
