// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ModelGateway } from '../types.js'
import type {
  RoutingDecision, RoutingTier, TierConfig, BudgetStatus, BudgetConfig,
} from './types.js'
import { MODEL_DOWNGRADE_PATH } from './types.js'
import { triage } from './triage.js'

export interface DecisionEngineDeps {
  gateway: ModelGateway
  getTiers: () => TierConfig[]
  getBudget: () => BudgetConfig
  getSpending: () => BudgetStatus
}

/**
 * Decision Engine — routes messages to the optimal provider+model based on:
 * 1. Triage (keyword → LLM classification)
 * 2. Tier configuration (user-defined provider+model per tier)
 * 3. Budget constraints (downgrade if over limit)
 * 4. Fallback (if primary provider unavailable)
 */
export function createDecisionEngine(deps: DecisionEngineDeps) {

  function resolveTier(tier: RoutingTier): TierConfig | null {
    return deps.getTiers().find(t => t.tier === tier && t.enabled) ?? null
  }

  function resolveProviderModel(tierConfig: TierConfig): { provider: string; model: string; fallback: boolean } {
    // Check if primary provider is available
    if (deps.gateway.getProvider(tierConfig.providerId)) {
      return { provider: tierConfig.providerId, model: tierConfig.modelId, fallback: false }
    }

    // Try fallback
    if (tierConfig.fallbackProviderId && deps.gateway.getProvider(tierConfig.fallbackProviderId)) {
      return {
        provider: tierConfig.fallbackProviderId,
        model: tierConfig.fallbackModelId ?? tierConfig.modelId,
        fallback: true,
      }
    }

    // Return primary anyway — caller handles provider-not-found
    return { provider: tierConfig.providerId, model: tierConfig.modelId, fallback: false }
  }

  function applyBudgetConstraints(decision: RoutingDecision): RoutingDecision {
    const spending = deps.getSpending()
    const periods = [spending.daily, spending.weekly, spending.monthly]
    const needsStop = periods.some(p => p.action === 'stop')
    const needsDowngrade = periods.some(p => p.action === 'downgrade')

    if (needsStop) {
      // Force to cheapest — try ollama first (free), then haiku
      const ollamaTier = resolveTier('heartbeat')
      if (ollamaTier && deps.gateway.getProvider(ollamaTier.providerId)) {
        return {
          ...decision,
          provider: ollamaTier.providerId,
          model: ollamaTier.modelId,
          strategy: 'budget_downgrade',
          downgraded: true,
          reason: `${decision.reason} [BUDGET STOP → ${ollamaTier.providerId}/${ollamaTier.modelId}]`,
        }
      }
    }

    if (needsDowngrade) {
      const cheaper = MODEL_DOWNGRADE_PATH[decision.model]
      if (cheaper) {
        return {
          ...decision,
          model: cheaper,
          strategy: 'budget_downgrade',
          downgraded: true,
          reason: `${decision.reason} [BUDGET → downgraded to ${cheaper}]`,
        }
      }
    }

    return decision
  }

  return {
    /**
     * Route a message to the best provider+model.
     * If explicitProvider/Model are given, skip triage (user override).
     */
    async route(
      message: string,
      options?: { explicitProvider?: string; explicitModel?: string; tier?: RoutingTier },
    ): Promise<RoutingDecision> {
      // 1. Explicit override — user manually chose provider+model
      if (options?.explicitProvider && options?.explicitModel) {
        return {
          provider: options.explicitProvider,
          model: options.explicitModel,
          tier: options.tier ?? 'standard',
          strategy: 'explicit',
          confidence: 1.0,
          reason: `User override: ${options.explicitProvider}/${options.explicitModel}`,
        }
      }

      // 2. Explicit tier override (e.g. heartbeat tasks, embedding requests)
      if (options?.tier) {
        const tierConfig = resolveTier(options.tier)
        if (tierConfig) {
          const resolved = resolveProviderModel(tierConfig)
          return applyBudgetConstraints({
            provider: resolved.provider,
            model: resolved.model,
            tier: options.tier,
            strategy: resolved.fallback ? 'fallback' : 'triage',
            confidence: 1.0,
            reason: `Explicit tier: ${options.tier}`,
            fallback: resolved.fallback,
          })
        }
      }

      // 3. Triage — classify the message
      const triageTierConfig = resolveTier('triage')
      if (!triageTierConfig) {
        // No triage configured — use standard tier
        const stdConfig = resolveTier('standard')
        if (stdConfig) {
          const resolved = resolveProviderModel(stdConfig)
          return {
            provider: resolved.provider,
            model: resolved.model,
            tier: 'standard',
            strategy: 'default',
            confidence: 0.5,
            reason: 'No triage tier configured — defaulting to standard',
            fallback: resolved.fallback,
          }
        }
        throw new Error('No routing tiers configured')
      }

      const triageResult = await triage(message, deps.gateway, triageTierConfig)

      // 4. Resolve tier to provider+model
      const targetTierConfig = resolveTier(triageResult.tier)
      if (!targetTierConfig) {
        // Tier not configured — fall back to standard
        const stdConfig = resolveTier('standard')
        if (stdConfig) {
          const resolved = resolveProviderModel(stdConfig)
          return applyBudgetConstraints({
            provider: resolved.provider,
            model: resolved.model,
            tier: 'standard',
            strategy: 'fallback',
            confidence: triageResult.confidence,
            reason: `${triageResult.reason} [tier ${triageResult.tier} not configured → standard]`,
            fallback: true,
          })
        }
        throw new Error(`Tier ${triageResult.tier} not configured and no standard fallback`)
      }

      const resolved = resolveProviderModel(targetTierConfig)

      // 5. Apply budget constraints
      return applyBudgetConstraints({
        provider: resolved.provider,
        model: resolved.model,
        tier: triageResult.tier,
        strategy: resolved.fallback ? 'fallback' : 'triage',
        confidence: triageResult.confidence,
        reason: triageResult.reason,
        fallback: resolved.fallback,
      })
    },

    /**
     * Get the provider+model for a specific tier (no triage needed).
     * Used by internal systems (heartbeat, embedding, etc.)
     */
    resolveForTier(tier: RoutingTier): { provider: string; model: string } | null {
      const config = resolveTier(tier)
      if (!config) return null
      const resolved = resolveProviderModel(config)
      return { provider: resolved.provider, model: resolved.model }
    },
  }
}

export type DecisionEngine = ReturnType<typeof createDecisionEngine>
