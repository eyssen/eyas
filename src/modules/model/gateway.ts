import type { Logger } from 'pino'
import type { AIProvider, ModelGateway, ModelRequest, ModelResponse, ModelInfo, StreamEvent, EmbedRequest, EmbedResponse } from './types.js'
import type { RoutingTier } from './routing/types.js'
import { normalizeModelAlias, type ProviderModels } from './tier-resolver.js'
import { BindingUnavailableError, canRunIsolated } from './binding.js'
import { applyEmbedEgress, applyRequestEgress, type EgressSlot } from './egress.js'
import { UNKNOWN_CAPABILITY, type ReasoningCapability } from './reasoning/capability.js'
import type { EffortIntent, EffortLevel } from './reasoning/ladder.js'
import { mergeEffortOutcome } from './reasoning/outcome.js'
import { resolveEffortPlan, type EffortOutcome, type EffortPlan } from './reasoning/resolve.js'
import { EffortIntentSchema } from './reasoning/schemas.js'
import { classifyModelError } from '@shared/classify-model-error.js'

export interface ModelGatewayHooks {
  /** Called when a provider call throws — the reauth healer inspects the error. */
  onError?: (providerId: string, err: unknown) => void
  /** Called when a provider call succeeds — clears any prior auth_error health. */
  onSuccess?: (providerId: string) => void
}

/** Cross-provider target for a tier, as configured in `routing_tiers`. */
export interface TierFallback {
  providerId: string
  modelId: string
}

export interface ModelGatewayOptions {
  /**
   * Fallback provider+model for an auto-routed tier. Injected by the model
   * module from `routing_tiers` so the gateway never touches the DB itself.
   */
  getTierFallback?: (tier: RoutingTier) => TierFallback | null
  /**
   * The install default for a request that names neither provider nor model
   * (binding.ts resolveDefault, injected by the model module). Null means no
   * default can be served, and the call fails with an explicit error.
   */
  getDefault?: () => { providerId: string; modelId: string } | null
  /**
   * The egress slot (egress.ts). Its filter sees every attempt after provider
   * resolution — first try, retry and tier-fallback hop alike — plus embed().
   * Absent or empty: requests reach the provider unchanged.
   */
  egress?: EgressSlot
  /**
   * The provider that owns a model id no registered provider lists itself —
   * a model a refresh discovered and model_config persisted (binding.ts
   * findModelOwner, exact ids only). Consulted only after the listModels()
   * miss and before alias normalization. It answers only for an enabled row
   * of an enabled, registered provider, and null when several own the id, so
   * a disabled or unknown model still fails with 'No provider found'.
   */
  lookupModelOwner?: (modelId: string) => string | null
  /**
   * The reasoning capability of the model an attempt goes to (reasoning/
   * registry.ts). Absent: every model counts as unknown, so effort resolves
   * to Auto (nothing is sent).
   */
  getReasoningCapability?: (providerId: string, modelId: string) => ReasoningCapability
  /** The model's output cap in tokens (catalog maxOutputTokens); null when unknown. */
  getMaxOutputTokens?: (providerId: string, modelId: string) => number | null
  /**
   * A routing tier's default effort (null = Auto). Applied only to a call
   * auto-routed to that tier (metadata.tier) that carries no effort intent.
   */
  getTierEffort?: (tier: RoutingTier) => EffortLevel | null
  /** Backoff before the same-provider retry. Injected so tests don't wait. */
  sleep?: (ms: number) => Promise<void>
  logger?: Pick<Logger, 'warn'> & Partial<Pick<Logger, 'debug'>>
}

/**
 * Only 'user' and 'assistant' turns are portable: each provider class treats
 * a 'system' turn inside `messages` differently (rejected, turned into a user
 * turn, or rendered as an assistant line). Instructions travel in
 * request.system, so anything else is a caller bug, refused before any call.
 */
function assertMessageRoles(request: ModelRequest): void {
  for (const message of request.messages ?? []) {
    const role = (message as { role?: unknown }).role
    if (role !== 'user' && role !== 'assistant') {
      throw new TypeError(
        `Model request message role '${String(role)}' is not allowed: messages carry only 'user' and 'assistant' turns — put instructions in request.system`,
      )
    }
  }
}

/** Delay before the single same-provider retry (D10). */
const RETRY_BACKOFF_MS = 1000

/** Per-call failover budget: at most one same-provider retry + one tier hop. */
interface FailoverState {
  retried: boolean
  fellBack: boolean
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A request without a caller-supplied effortPlan: the gateway is the plan's only author. */
function withoutEffortPlan(request: ModelRequest): ModelRequest {
  if (!('effortPlan' in request)) return request
  const { effortPlan: _callerPlan, ...rest } = request
  return rest
}

export function createModelGateway(hooks?: ModelGatewayHooks, options?: ModelGatewayOptions): ModelGateway {
  const providers = new Map<string, AIProvider>()
  const sleep = options?.sleep ?? defaultSleep
  let modelCache: Map<string, string> | null = null
  let providerModels: ProviderModels[] = []
  let warnedNoDefaultHook = false

  /** options.lookupModelOwner, where a failing lookup counts as "no owner". */
  function lookupOwner(modelId: string): string | null {
    if (!options?.lookupModelOwner) return null
    try {
      return options.lookupModelOwner(modelId)
    } catch (err) {
      options.logger?.warn({ err, modelId }, 'Model owner lookup failed — resolving without the model catalog')
      return null
    }
  }

  async function resolveProvider(request: ModelRequest): Promise<AIProvider> {
    if (request.provider) {
      const provider = providers.get(request.provider)
      if (!provider) throw new Error(`Provider not found: ${request.provider}`)
      return provider
    }

    if (request.model) {
      // Rebuild cache if needed
      if (!modelCache) {
        modelCache = new Map()
        providerModels = []
        for (const [providerId, provider] of providers) {
          // One unreachable provider (e.g. Ollama went down after registering)
          // must not poison model resolution for every other provider — skip it.
          let models: ModelInfo[]
          try {
            models = await provider.listModels()
          } catch {
            continue
          }
          const ids: string[] = []
          for (const model of models) { modelCache.set(model.id, providerId); ids.push(model.id) }
          providerModels.push({ providerId, modelIds: ids })
        }
      }
      const providerId = modelCache.get(request.model)
      if (providerId) return providers.get(providerId)!

      // A model only the persisted catalog knows (discovered by a refresh):
      // the one enabled provider owning an enabled row for this exact id.
      const owner = lookupOwner(request.model)
      const ownerProvider = owner ? providers.get(owner) : undefined
      if (ownerProvider) return ownerProvider

      // Bare alias / non-listed model → normalize to a concrete listed id and
      // forward that to the provider (the seeded YAML agents use 'sonnet'/'opus').
      const normalized = normalizeModelAlias(request.model, providerModels)
      if (normalized) {
        const pid = modelCache.get(normalized)
        if (pid) { request.model = normalized; return providers.get(pid)! }
      }
      throw new Error(`No provider found for model: ${request.model}`)
    }

    throw new Error('Either provider or model must be specified, or register a default provider')
  }

  /** The request's effort intent when it is a valid one; anything else counts as absent. */
  function intentOf(request: ModelRequest): EffortIntent | undefined {
    if (request.effort === undefined) return undefined
    const parsed = EffortIntentSchema.safeParse(request.effort)
    if (parsed.success) return parsed.data
    options?.logger?.warn({ effort: request.effort }, 'Model request carries an invalid effort intent — ignored')
    return undefined
  }

  function capabilityOf(providerId: string, modelId: string): ReasoningCapability {
    if (!options?.getReasoningCapability) return UNKNOWN_CAPABILITY
    try {
      return options.getReasoningCapability(providerId, modelId)
    } catch (err) {
      options.logger?.warn({ err, providerId, modelId }, 'Reasoning capability lookup failed — effort resolves to Auto')
      return UNKNOWN_CAPABILITY
    }
  }

  function maxOutputOf(providerId: string, modelId: string): number | null {
    try {
      return options?.getMaxOutputTokens?.(providerId, modelId) ?? null
    } catch {
      return null
    }
  }

  function tierEffortOf(request: ModelRequest): EffortLevel | null {
    const tier = request.metadata?.tier
    if (!tier || !options?.getTierEffort) return null
    try {
      return options.getTierEffort(tier)
    } catch (err) {
      options.logger?.warn({ err, tier }, 'Tier effort lookup failed — the model default applies')
      return null
    }
  }

  /**
   * The effort plan for ONE attempt, resolved against the provider and model
   * that attempt actually goes to — so a retry keeps it and a failover hop
   * re-resolves it for the fallback model. Always from the request's original
   * intent; the tier default only when there is none.
   */
  function planEffort(attempt: ModelRequest, provider: AIProvider, streaming: boolean): { plan: EffortPlan; outcome: EffortOutcome } {
    const intent = intentOf(attempt)
    const modelId = attempt.model
    const resolved = resolveEffortPlan({
      intent,
      tierDefault: intent ? null : tierEffortOf(attempt),
      capability: modelId ? capabilityOf(provider.id, modelId) : null,
      maxOutputTokens: modelId ? maxOutputOf(provider.id, modelId) : null,
      streaming,
    })
    if (resolved.outcome.clamped) {
      options?.logger?.debug?.({
        providerId: provider.id,
        modelId,
        requested: resolved.outcome.requested,
        effective: resolved.outcome.effective,
        source: resolved.outcome.source,
        reason: resolved.outcome.reason,
      }, 'Reasoning effort clamped to the model')
    }
    return resolved
  }

  /** Embedding provider: the explicit one, else the first embedding-capable one. */
  function resolveEmbedProvider(request: EmbedRequest): AIProvider {
    if (request.provider) {
      const provider = providers.get(request.provider)
      if (!provider) throw new Error(`Provider not found: ${request.provider}`)
      if (!provider.embed) throw new Error(`Provider ${request.provider} does not support embeddings`)
      return provider
    }
    for (const provider of providers.values()) {
      if (provider.embed) return provider
    }
    throw new Error('No embedding-capable provider registered')
  }

  /**
   * A request that names neither provider nor model is bound to the install
   * default (binding.ts resolveDefault) BEFORE the first attempt, as a copy:
   * the caller's object is untouched and a retry stays on the same provider.
   * Never a provider preferred by id, never Map (registration) order, so a
   * provider reload cannot change who answers.
   */
  function bindUnpinned(request: ModelRequest): ModelRequest {
    if (request.provider || request.model) return request
    if (options?.getDefault) {
      const binding = options.getDefault()
      // Coded, so every caller maps it to the same localized error.
      if (!binding) throw new BindingUnavailableError('no_model_configured')
      return { ...request, provider: binding.providerId, model: binding.modelId }
    }
    // A standalone gateway (unit tests, tools) has no binding source: the
    // first registered provider by id, so the choice is at least stable.
    const firstId = [...providers.keys()].sort()[0]
    if (!firstId) throw new Error('Either provider or model must be specified, or register a default provider')
    if (!warnedNoDefaultHook) {
      warnedNoDefaultHook = true
      options?.logger?.warn({ providerId: firstId }, 'Model gateway has no default binding hook; unpinned calls use the first provider by id')
    }
    return { ...request, provider: firstId }
  }

  /**
   * Cross-provider fallback target for a failed attempt, or null when this
   * request may not leave its provider. Only auto-routed requests carry
   * `metadata.tier`, so a hand-pinned provider can never be silently swapped.
   */
  function tierFallbackFor(request: ModelRequest, failedProviderId: string): TierFallback | null {
    const tier = request.metadata?.tier
    if (!tier || !options?.getTierFallback) return null
    const fallback = options.getTierFallback(tier)
    if (!fallback?.providerId || fallback.providerId === failedProviderId) return null
    // An unregistered fallback would just fail resolution with a worse error.
    const target = providers.get(fallback.providerId)
    if (!target) return null
    // An isolated call may only hop to a provider that honours isolation.
    if (request.isolated === true && !canRunIsolated(target)) return null
    return fallback
  }

  /**
   * Decides what to do after a failed attempt: retry the same provider once
   * (after a backoff), hop to the tier fallback, or give up. Shared by
   * complete() and stream() so both obey the same D10 budget: at most one
   * same-provider retry plus at most one cross-provider hop.
   */
  async function nextAttempt(
    request: ModelRequest,
    providerId: string,
    err: unknown,
    state: FailoverState,
  ): Promise<ModelRequest | null> {
    // A cancelled call must stay cancelled, whatever the provider blamed.
    if (request.signal?.aborted) return null
    if (!classifyModelError(err).retryable) return null

    if (!state.retried) {
      state.retried = true
      await sleep(RETRY_BACKOFF_MS)
      return request
    }

    if (state.fellBack) return null
    const fallback = tierFallbackFor(request, providerId)
    if (!fallback) return null
    state.fellBack = true
    return { ...request, provider: fallback.providerId, model: fallback.modelId }
  }

  return {
    registerProvider(provider: AIProvider) {
      providers.set(provider.id, provider)
      modelCache = null // invalidate cache
      providerModels = []
    },

    unregisterProvider(id: string) {
      providers.delete(id)
      modelCache = null
      providerModels = []
    },

    getProvider(id: string) {
      return providers.get(id)
    },

    listProviders() {
      return Array.from(providers.values())
    },

    async listAllModels(): Promise<ModelInfo[]> {
      const allModels: ModelInfo[] = []
      for (const provider of providers.values()) {
        // Skip a provider whose listModels() fails so one unreachable backend
        // doesn't blank out the whole model list.
        try {
          const models = await provider.listModels()
          allModels.push(...models)
        } catch {
          continue
        }
      }
      return allModels
    },

    async complete(request: ModelRequest): Promise<ModelResponse> {
      assertMessageRoles(request)
      const state: FailoverState = { retried: false, fellBack: false }
      let attempt = withoutEffortPlan(bindUnpinned(request))
      for (;;) {
        const provider = await resolveProvider(attempt)
        // Filtered for THIS provider; `attempt` stays raw, so the retry and
        // the fallback hop are each filtered once, for their own provider.
        // Then the effort plan is resolved for this provider's model and
        // spread onto what the filter returned.
        const filtered = applyRequestEgress(options?.egress, attempt, provider)
        const effort = planEffort(attempt, provider, false)
        const outgoing: ModelRequest = { ...filtered, effortPlan: effort.plan }
        try {
          const response = await provider.complete(outgoing)
          hooks?.onSuccess?.(provider.id)
          return { ...response, effortOutcome: mergeEffortOutcome(effort.outcome, response.effortOutcome) }
        } catch (err) {
          hooks?.onError?.(provider.id, err)
          // A tools-bearing completion is an agentic run — claude-code
          // implements complete() by draining its own stream, so by the time it
          // fails the tool bridge may have executed real side effects. Unlike
          // stream(), nothing here says how far it got, so a retry could redo
          // that work and double the cost. Plain completions still retry.
          const next = attempt.tools?.length
            ? null
            : await nextAttempt(attempt, provider.id, err, state)
          if (!next) throw err
          attempt = next
        }
      }
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      assertMessageRoles(request)
      const state: FailoverState = { retried: false, fellBack: false }
      let attempt = withoutEffortPlan(bindUnpinned(request))
      for (;;) {
        const provider = await resolveProvider(attempt)
        const filtered = applyRequestEgress(options?.egress, attempt, provider)
        const effort = planEffort(attempt, provider, true)
        const outgoing: ModelRequest = { ...filtered, effortPlan: effort.plan }
        // Answer content already handed to the consumer — a retry would
        // duplicate it, so the failure has to surface instead (D10).
        let delivered = false
        // grok-cli reports a failure BOTH as a frame and as a throw. The frame
        // is not answer content: holding it keeps the retry open and stops the
        // caller rendering the same failure twice (once as the frame, once as
        // the thrown error).
        let pendingError: StreamEvent | null = null
        try {
          for await (const event of provider.stream(outgoing)) {
            if (event.type === 'error') { pendingError = event; continue }
            delivered = true
            if (pendingError) {
              const held = pendingError
              pendingError = null
              yield held
            }
            if (event.type === 'done' && event.response) {
              yield { ...event, response: { ...event.response, effortOutcome: mergeEffortOutcome(effort.outcome, event.response.effortOutcome) } }
              continue
            }
            yield event
          }
          // Ended without throwing — a provider that reports failure ONLY as a
          // frame (LM Studio) still owes the consumer that frame, and the call
          // failed: treating it as a success would clear the provider's health
          // badge on a call that produced no answer.
          if (pendingError) {
            const failure = pendingError.type === 'error' ? pendingError.error : undefined
            hooks?.onError?.(provider.id, failure)
            yield pendingError
            return
          }
          hooks?.onSuccess?.(provider.id)
          return
        } catch (err) {
          hooks?.onError?.(provider.id, err)
          const next = delivered ? null : await nextAttempt(attempt, provider.id, err, state)
          // Giving up: the thrown error is the single transport, so the held
          // frame is dropped rather than duplicated alongside it.
          if (!next) throw err
          attempt = next
        }
      }
    },

    async embed(request: EmbedRequest): Promise<EmbedResponse> {
      const provider = resolveEmbedProvider(request)
      // Filtered for the provider that actually embeds, like complete()/stream().
      return provider.embed!(applyEmbedEgress(options?.egress, request, provider))
    },
  }
}
