// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** Capability tier shared across all Claude-family providers. */
export type ModelTier = 'opus' | 'sonnet' | 'haiku'

/** A provider and the concrete model IDs it currently exposes. */
export interface ProviderModels {
  providerId: string
  modelIds: string[]
}

/** Most-suitable tier per agent type (the wizard's default policy). */
export const AGENT_TYPE_TIER: Record<string, ModelTier> = {
  assistant: 'sonnet',
  engineer: 'opus',
  developer: 'opus',
  reviewer: 'opus',
  critic: 'opus',
  researcher: 'sonnet',
  planner: 'opus',
  coordinator: 'opus',
  observer: 'haiku',
}

/** Concrete model ID per provider for each tier. */
const PROVIDER_TIER_MODEL: Record<string, Record<ModelTier, string>> = {
  'claude-code': { opus: 'claude-code-opus', sonnet: 'claude-code-sonnet', haiku: 'claude-code-haiku' },
  // Grok CLI currently has a single primary model for every capability tier.
  'grok-cli': { opus: 'grok-cli-default', sonnet: 'grok-cli-default', haiku: 'grok-cli-default' },
  'kimi-cli': { opus: 'kimi-cli-k3', sonnet: 'kimi-cli-default', haiku: 'kimi-cli-k2.6' },
  anthropic: { opus: 'claude-opus-4-8', sonnet: 'claude-sonnet-4-6', haiku: 'claude-haiku-4-5' },
  kimi: { opus: 'kimi-k3', sonnet: 'kimi-k2.7-code', haiku: 'kimi-k2.5' },
}

/** Provider preference order when more than one can serve a tier. */
const PROVIDER_PREFERENCE = ['claude-code', 'grok-cli', 'kimi-cli', 'anthropic', 'kimi']

const TIER_ALIASES = new Set<string>(['opus', 'sonnet', 'haiku'])

export function tierForAgentType(agentType: string): ModelTier {
  return AGENT_TYPE_TIER[agentType] ?? 'sonnet'
}

export function resolveTier(
  tier: ModelTier,
  providers: ProviderModels[],
  /** When set (wizard primary / global default), this provider is tried first. */
  preferredProviderId?: string | null,
): { provider: string; modelId: string } | null {
  const byId = new Map(providers.map((p) => [p.providerId, new Set(p.modelIds)]))
  const base = [
    ...PROVIDER_PREFERENCE.filter((id) => byId.has(id)),
    ...providers.map((p) => p.providerId).filter((id) => !PROVIDER_PREFERENCE.includes(id)),
  ]
  const ordered = preferredProviderId && byId.has(preferredProviderId)
    ? [preferredProviderId, ...base.filter((id) => id !== preferredProviderId)]
    : base
  for (const providerId of ordered) {
    const have = byId.get(providerId)!
    const want = PROVIDER_TIER_MODEL[providerId]?.[tier]
    if (want && have.has(want)) return { provider: providerId, modelId: want }
    // Heuristic only for providers we don't have an explicit tier map for.
    if (!PROVIDER_TIER_MODEL[providerId]) {
      const heur = [...have].find((id) => id.toLowerCase().includes(tier))
      if (heur) return { provider: providerId, modelId: heur }
    }
  }
  return null
}

export function normalizeModelAlias(
  model: string,
  providers: ProviderModels[],
  preferredProviderId?: string | null,
): string | undefined {
  // Already a concrete, listed id → pass through.
  for (const p of providers) if (p.modelIds.includes(model)) return model
  // Bare tier alias → resolve to the preferred provider's concrete id.
  if (TIER_ALIASES.has(model)) return resolveTier(model as ModelTier, providers, preferredProviderId)?.modelId
  return undefined
}
