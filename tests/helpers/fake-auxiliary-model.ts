// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Scripted stand-in for ctx.auxiliaryModel in consumer tests. It records every
// request and answers from a script: each call takes the next step, and the
// last step repeats. No resolver, no gateway, no model.
//
// createGatewayBackedAuxiliaryModel (below) is the other harness: the REAL
// service over a scripted gateway, for asserting the request a consumer's
// call produces and that an ineligible install makes no model call.

import type {
  AuxAttempt,
  AuxGroupStatus,
  AuxiliaryModelService,
  AuxNoneReason,
  AuxPurpose,
  AuxRequest,
  AuxResolution,
  AuxResult,
  AuxRoute,
} from '@modules/model/auxiliary'
import { createAuxiliaryModelService } from '@modules/model/auxiliary'
import type { BindingProviderConfig } from '@modules/model/binding'
import type { TierConfig } from '@modules/model/routing/types'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StopReason } from '@modules/model/types'

export type FakeAuxStep =
  | { kind: 'ok'; text: string; provider?: string; model?: string | null; route?: AuxRoute; stopReason?: StopReason }
  | { kind: 'none'; reason: AuxNoneReason }
  | { kind: 'error'; message: string; attempted?: AuxAttempt[] }
  | { kind: 'empty' }

export const auxOk = (text: string, extra: Omit<Extract<FakeAuxStep, { kind: 'ok' }>, 'kind' | 'text'> = {}): FakeAuxStep =>
  ({ kind: 'ok', text, ...extra })
export const auxNone = (reason: AuxNoneReason = 'no_eligible_provider'): FakeAuxStep => ({ kind: 'none', reason })
export const auxError = (message = 'fake failure', attempted?: AuxAttempt[]): FakeAuxStep =>
  ({ kind: 'error', message, ...(attempted ? { attempted } : {}) })
export const auxEmpty = (): FakeAuxStep => ({ kind: 'empty' })

export interface FakeAuxiliaryModel extends AuxiliaryModelService {
  /** Every request passed to complete() or completeText(), in order. */
  readonly calls: AuxRequest[]
  /** Replace the script; the call log is kept. */
  script(steps: FakeAuxStep | FakeAuxStep[]): void
}

const FAKE_PROVIDER = 'fake-provider'
const FAKE_MODEL = 'fake-model'

function toResult(step: FakeAuxStep): AuxResult {
  switch (step.kind) {
    case 'ok':
      return {
        ok: true,
        text: step.text,
        provider: step.provider ?? FAKE_PROVIDER,
        model: step.model === undefined ? FAKE_MODEL : step.model,
        route: step.route ?? 'api',
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: step.stopReason ?? 'end',
      }
    case 'none':
      return { ok: false, reason: step.reason }
    case 'empty':
      return { ok: false, reason: 'empty', attempted: [{ provider: FAKE_PROVIDER, model: FAKE_MODEL, route: 'api' }] }
    case 'error':
      return {
        ok: false,
        reason: 'error',
        attempted: step.attempted ?? [{ provider: FAKE_PROVIDER, model: FAKE_MODEL, route: 'api' }],
        error: { kind: 'other', message: step.message },
      }
  }
}

export function createFakeAuxiliaryModel(steps: FakeAuxStep | FakeAuxStep[] = auxOk('ok')): FakeAuxiliaryModel {
  let queue = Array.isArray(steps) ? [...steps] : [steps]
  const calls: AuxRequest[] = []

  const peek = (): FakeAuxStep => queue[0] ?? auxNone()
  const take = (): FakeAuxStep => (queue.length > 1 ? queue.shift()! : peek())

  const fake: FakeAuxiliaryModel = {
    calls,
    script(next) {
      queue = Array.isArray(next) ? [...next] : [next]
    },
    resolve(_purpose: AuxPurpose): AuxResolution {
      const step = peek()
      if (step.kind === 'none') return { ok: false, reason: step.reason }
      const provider = step.kind === 'ok' ? step.provider ?? FAKE_PROVIDER : FAKE_PROVIDER
      return { ok: true, candidates: [{ provider, model: FAKE_MODEL, route: step.kind === 'ok' ? step.route ?? 'api' : 'api' }] }
    },
    async complete(request) {
      calls.push(request)
      return toResult(take())
    },
    async completeText(request) {
      const { fallback, ...rest } = request
      calls.push(rest)
      const result = toResult(take())
      if (!result.ok || result.stopReason === 'refusal' || !result.text.trim()) return fallback
      return result.text
    },
    describe(): AuxGroupStatus[] {
      return []
    },
  }
  return fake
}

// ─── The real service over a scripted gateway ───────────────────────────────

export interface GatewayBackedAuxOptions {
  /** The answer text, or a function of the request; a thrown error fails that call. Default 'ok'. */
  answer?: string | ((request: ModelRequest) => string | Promise<string>)
  /**
   * Registered providers: `id`, or `id!` for a CLI advertising isolated
   * completion. Default: one API provider, 'fake-api'.
   */
  providers?: string[]
  /** Routing tiers. Default: a 'heartbeat' tier on 'fake-api' / 'fake-model'. */
  tiers?: TierConfig[]
}

export interface GatewayBackedAuxiliaryModel {
  aux: AuxiliaryModelService
  /** Every request that reached the gateway, in order. */
  readonly requests: ModelRequest[]
}

const GATEWAY_API = 'fake-api'
const GATEWAY_MODEL = 'fake-model'

/** A heartbeat tier row pointing at the harness's API provider. */
export function fakeHeartbeatTier(providerId = GATEWAY_API, modelId = GATEWAY_MODEL): TierConfig {
  return {
    tier: 'heartbeat', providerId, modelId, fallbackProviderId: null, fallbackModelId: null,
    description: '', enabled: true, updatedAt: '',
  }
}

/**
 * The REAL auxiliary model service over a scripted gateway, for consumer tests
 * that must see what the gateway receives (isolated, instruction in system,
 * one user message, purpose tag) and prove that an install without an eligible
 * model makes no model call at all.
 */
export function createGatewayBackedAuxiliaryModel(opts: GatewayBackedAuxOptions = {}): GatewayBackedAuxiliaryModel {
  const requests: ModelRequest[] = []
  const providers = (opts.providers ?? [GATEWAY_API]).map((raw) => {
    const id = raw.replace(/!$/, '')
    return raw.endsWith('!') ? { id, supportsIsolatedCompletion: true } : { id }
  })
  const answer = opts.answer ?? 'ok'
  const gateway = {
    listProviders: () => providers as unknown as AIProvider[],
    async complete(request: ModelRequest): Promise<ModelResponse> {
      requests.push(request)
      const text = typeof answer === 'function' ? await answer(request) : answer
      return {
        id: 'r', provider: request.provider ?? GATEWAY_API, model: request.model ?? GATEWAY_MODEL,
        content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
      }
    },
  }
  const row = (id: string) => ({ id, enabled: true, settings: {}, isDefault: false, defaultModel: null, updatedAt: '' })
  const known = providers.map((p) => p.id)
  const providerConfig: BindingProviderConfig = {
    getProvider: (id) => (known.includes(id) ? row(id) : null),
    getDefault: () => null,
    listProviders: () => known.map(row),
    listEnabledModels: (id): ModelInfo[] => (id === GATEWAY_API ? [{
      id: GATEWAY_MODEL, name: GATEWAY_MODEL, provider: id, contextWindow: 1000, maxOutputTokens: 100,
      supportsTools: true, supportsImages: false, supportsStreaming: true,
    }] : []),
  }
  const tiers = opts.tiers ?? [fakeHeartbeatTier()]
  const aux = createAuxiliaryModelService({
    getGateway: () => gateway,
    getTiers: () => tiers,
    getProviderConfig: () => providerConfig,
  })
  return { aux, requests }
}

// ─── The real service over a caller-supplied gateway ───────────────────────

export interface AuxOverGatewayOptions {
  /**
   * Registered, enabled providers: `id`, or `id!` for a CLI advertising
   * isolated completion. Each API provider has one enabled model,
   * `<id>-model`. Default: one API provider, 'p'.
   */
  providers?: string[]
  /** Routing tiers. Default: a 'heartbeat' tier on the first provider and its model. */
  tiers?: TierConfig[]
}

/**
 * The REAL auxiliary model service over a gateway mock the test owns (only
 * `complete` is called), for consumer tests that already script a gateway:
 * the requests the consumer's calls produce land on that mock, resolved by
 * the real ladder (so an ineligible install makes no call at all).
 */
export function createAuxiliaryModelOverGateway(
  gateway: { complete(request: ModelRequest): Promise<ModelResponse> },
  opts: AuxOverGatewayOptions = {},
): AuxiliaryModelService {
  const providers = (opts.providers ?? ['p']).map((raw) => {
    const id = raw.replace(/!$/, '')
    return raw.endsWith('!') ? { id, supportsIsolatedCompletion: true } : { id }
  })
  const known = providers.map((p) => p.id)
  const modelOf = (id: string) => `${id}-model`
  const row = (id: string) => ({ id, enabled: true, settings: {}, isDefault: false, defaultModel: null, updatedAt: '' })
  const providerConfig: BindingProviderConfig = {
    getProvider: (id) => (known.includes(id) ? row(id) : null),
    getDefault: () => null,
    listProviders: () => known.map(row),
    listEnabledModels: (id): ModelInfo[] => (known.includes(id) ? [{
      id: modelOf(id), name: modelOf(id), provider: id, contextWindow: 1000, maxOutputTokens: 100,
      supportsTools: true, supportsImages: false, supportsStreaming: true,
    }] : []),
  }
  const tiers = opts.tiers ?? (known[0] ? [fakeHeartbeatTier(known[0], modelOf(known[0]))] : [])
  return createAuxiliaryModelService({
    getGateway: () => ({
      listProviders: () => providers as unknown as AIProvider[],
      complete: (request: ModelRequest) => gateway.complete(request),
    }),
    getTiers: () => tiers,
    getProviderConfig: () => providerConfig,
  })
}
