import type { AIProvider, ModelGateway, ModelRequest, ModelResponse, ModelInfo, StreamEvent, EmbedRequest, EmbedResponse } from './types.js'
import type { RoutingTier } from './routing/types.js'
import { normalizeModelAlias, type ProviderModels } from './tier-resolver.js'
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
  /** Backoff before the same-provider retry. Injected so tests don't wait. */
  sleep?: (ms: number) => Promise<void>
}

/** Delay before the single same-provider retry (D10). */
const RETRY_BACKOFF_MS = 1000

/** Per-call failover budget: at most one same-provider retry + one tier hop. */
interface FailoverState {
  retried: boolean
  fellBack: boolean
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createModelGateway(hooks?: ModelGatewayHooks, options?: ModelGatewayOptions): ModelGateway {
  const providers = new Map<string, AIProvider>()
  const sleep = options?.sleep ?? defaultSleep
  let modelCache: Map<string, string> | null = null
  let providerModels: ProviderModels[] = []

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

      // Bare alias / non-listed model → normalize to a concrete listed id and
      // forward that to the provider (the seeded YAML agents use 'sonnet'/'opus').
      const normalized = normalizeModelAlias(request.model, providerModels)
      if (normalized) {
        const pid = modelCache.get(normalized)
        if (pid) { request.model = normalized; return providers.get(pid)! }
      }
      throw new Error(`No provider found for model: ${request.model}`)
    }

    // Fallback: use the first registered provider (prefer anthropic if available)
    const anthropic = providers.get('anthropic')
    if (anthropic) return anthropic
    const first = providers.values().next().value
    if (first) return first
    throw new Error('Either provider or model must be specified, or register a default provider')
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
    if (!providers.has(fallback.providerId)) return null
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
      const state: FailoverState = { retried: false, fellBack: false }
      let attempt = request
      for (;;) {
        const provider = await resolveProvider(attempt)
        try {
          const response = await provider.complete(attempt)
          hooks?.onSuccess?.(provider.id)
          return response
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
      const state: FailoverState = { retried: false, fellBack: false }
      let attempt = request
      for (;;) {
        const provider = await resolveProvider(attempt)
        // Answer content already handed to the consumer — a retry would
        // duplicate it, so the failure has to surface instead (D10).
        let delivered = false
        // grok-cli reports a failure BOTH as a frame and as a throw. The frame
        // is not answer content: holding it keeps the retry open and stops the
        // caller rendering the same failure twice (once as the frame, once as
        // the thrown error).
        let pendingError: StreamEvent | null = null
        try {
          for await (const event of provider.stream(attempt)) {
            if (event.type === 'error') { pendingError = event; continue }
            delivered = true
            if (pendingError) {
              const held = pendingError
              pendingError = null
              yield held
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
      // Resolve provider: explicit > model lookup > first with embed support
      if (request.provider) {
        const provider = providers.get(request.provider)
        if (!provider) throw new Error(`Provider not found: ${request.provider}`)
        if (!provider.embed) throw new Error(`Provider ${request.provider} does not support embeddings`)
        return provider.embed(request)
      }

      // Try to find a provider that supports embeddings
      for (const [, provider] of providers) {
        if (provider.embed) {
          return provider.embed(request)
        }
      }

      throw new Error('No embedding-capable provider registered')
    },
  }
}
