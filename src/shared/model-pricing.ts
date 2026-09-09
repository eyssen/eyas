// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T9 — single pricing source for every cost producer (observability's
// trace-collector, the background/team/delegation run rollups, and the
// interactive chat route). Provider-qualified keys ('anthropic/claude-...')
// so the same model id under two providers (e.g. a CLI alias vs. the direct
// API) can carry different rates. Local providers are pinned to $0 — before
// this module, trace-collector's own hardcoded table billed EVERY call
// (including Ollama/LM Studio) at Anthropic prices, silently overcounting
// the global routing budget.

/** Usage shape enough to price a call. Providers that don't report a field simply omit it. */
export interface UsageForCost {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  /** Provider-reported authoritative cost (e.g. Claude Code SDK's total_cost_usd). Wins over any estimate. */
  costUsd?: number
}

/** USD per 1,000,000 tokens. */
export interface PricingRates {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export type PricingTable = Record<string, PricingRates>

/** Providers whose inference runs on the operator's own hardware — never billed. */
const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio'])

/**
 * Conservative fallback for a provider/model this table doesn't recognize —
 * deliberately priced at the high end of what we ship (above even Fable 5's
 * $10/$50, the priciest model any provider here serves) so an unrecognized
 * model is billed generously rather than under-reported: the risk of
 * overcounting an unrecognized cheap/free model is preferred over silently
 * under-counting an expensive one.
 */
const FALLBACK_RATES: PricingRates = { input: 15, output: 75 }

/**
 * Refreshed defaults for the model families the providers in this repo ship
 * (verified against Anthropic's current published pricing — fix round 1
 * Critical 1: the original table below was stale, pricing Opus-tier at
 * 3x its real rate). Keys are `${provider}/${modelId}`. See each submodule's
 * provider.ts for the exact model ids in play (claude-code uses its own
 * `claude-code-*` aliases, distinct from the direct Anthropic API ids, but
 * bills at the same per-model rate as its underlying real model).
 * Cache rates follow Anthropic's standard formula off each model's base input
 * rate: cacheRead = 0.1x, cacheWrite (5-minute TTL) = 1.25x.
 */
export const DEFAULT_MODEL_PRICING: PricingTable = {
  // Anthropic — direct API
  'anthropic/claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'anthropic/claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'anthropic/claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'anthropic/claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'anthropic/claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'anthropic/claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // Claude Code CLI — provider's own model aliases (mirrors provider.ts's
  // KNOWN_MODELS), billed at the same rate as the real model each alias
  // resolves to (fable → fable-5, opus → opus-4-8, sonnet → sonnet-4-6, haiku → haiku-4-5).
  // The provider fills usage.costUsd from the SDK's own total_cost_usd
  // whenever it's available, so these rates are only the fallback for a run
  // the SDK didn't price (e.g. an older CLI).
  'claude-code/claude-code-fable': { input: 10, output: 50 },
  'claude-code/claude-code-opus': { input: 5, output: 25 },
  'claude-code/claude-code-sonnet': { input: 3, output: 15 },
  'claude-code/claude-code-haiku': { input: 1, output: 5 },
  // Kimi / Moonshot API (platform.kimi.ai mid-2026)
  'kimi/kimi-k3': { input: 3, output: 15, cacheRead: 0.3 },
  'kimi/kimi-k2.7-code': { input: 0.95, output: 4 },
  'kimi/kimi-k2.7-code-highspeed': { input: 0.95, output: 4 },
  'kimi/kimi-k2.6': { input: 0.95, output: 4 },
  'kimi/kimi-k2.5': { input: 0.6, output: 3 },
  // Grok CLI — SpaceXAI published Grok 4.5/4.6 card ($2 / $6, cache $0.30).
  // Without these rows grok-cli-default hit the $15/$75 unrecognized fallback
  // and a single coding-agent turn looked like $2.60 instead of ~$0.33.
  'grok-cli/grok-cli-default': { input: 2, output: 6, cacheRead: 0.3 },
  'grok-cli/grok-cli-': { input: 2, output: 6, cacheRead: 0.3 },
  'grok-cli/grok-4': { input: 2, output: 6, cacheRead: 0.3 },
  // Kimi Code CLI — same rates as underlying Moonshot models
  'kimi-cli/kimi-cli-default': { input: 0.95, output: 4 },
  'kimi-cli/kimi-cli-k3': { input: 3, output: 15, cacheRead: 0.3 },
  'kimi-cli/kimi-cli-k2.7-code': { input: 0.95, output: 4 },
  'kimi-cli/kimi-cli-k2.6': { input: 0.95, output: 4 },
  // OpenAI
  'openai/gpt-4o': { input: 2.5, output: 10 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  'openai/gpt-4-turbo': { input: 10, output: 30 },
  'openai/o3-mini': { input: 1.1, output: 4.4 },
  // Gemini
  'gemini/gemini-2.5-pro-preview-05-06': { input: 1.25, output: 10 },
  'gemini/gemini-2.5-flash-preview-05-20': { input: 0.15, output: 0.6 },
  'gemini/gemini-2.0-flash': { input: 0.1, output: 0.4 },
  // Local providers — inference runs on the operator's own hardware.
  'ollama/*': { input: 0, output: 0 },
  'lmstudio/*': { input: 0, output: 0 },
}

function lookupRates(provider: string | undefined, model: string | undefined, table: PricingTable): PricingRates {
  if (provider && LOCAL_PROVIDERS.has(provider)) return { input: 0, output: 0 }

  const p = provider ?? 'unknown'
  const m = model ?? 'unknown'
  const exactKey = `${p}/${m}`
  if (table[exactKey]) return table[exactKey]

  // Prefix match — a provider that ships date-suffixed / versioned model ids
  // not enumerated verbatim above still resolves to its model family's rate.
  for (const key of Object.keys(table)) {
    if (!key.startsWith(`${p}/`)) continue
    const keyModel = key.slice(p.length + 1)
    if (keyModel !== '*' && m.startsWith(keyModel)) return table[key]
  }

  // Fix round 1 (Critical 2) — a pinned agent model with no resolvable
  // provider (the normal shape for orchestrator team-member runs: an agent
  // definition carries a `model` field but no separate `provider` field) must
  // still price against its real model rate instead of collapsing to the
  // conservative fallback. Only when the PROVIDER itself is unknown: scan
  // every entry's model segment regardless of which provider it's under —
  // exact match first, then prefix — before giving up.
  if (p === 'unknown') {
    for (const key of Object.keys(table)) {
      const keyModel = key.slice(key.indexOf('/') + 1)
      if (keyModel === m) return table[key]
    }
    for (const key of Object.keys(table)) {
      const keyModel = key.slice(key.indexOf('/') + 1)
      if (keyModel !== '*' && m.startsWith(keyModel)) return table[key]
    }
  }

  return FALLBACK_RATES
}

/**
 * Estimate the USD cost of a call. `usage.costUsd`, when present, is
 * authoritative and returned as-is (R3 — a CLI provider's own billed total
 * always wins over a table lookup). `overrides` — normally `config.model.pricing`
 * — replaces individual table entries wholesale (an override for one model
 * does not partially merge with that model's default cache rates).
 */
export function estimateCost(
  provider: string | undefined,
  model: string | undefined,
  usage: UsageForCost,
  overrides?: PricingTable,
): number {
  if (usage.costUsd !== undefined) return usage.costUsd

  const table = overrides && Object.keys(overrides).length > 0
    ? { ...DEFAULT_MODEL_PRICING, ...overrides }
    : DEFAULT_MODEL_PRICING
  const rates = lookupRates(provider, model, table)

  let cost = (usage.inputTokens * rates.input + usage.outputTokens * rates.output) / 1_000_000
  if (usage.cacheReadTokens && rates.cacheRead) {
    cost += (usage.cacheReadTokens * rates.cacheRead) / 1_000_000
  }
  if (usage.cacheCreationTokens && rates.cacheWrite) {
    cost += (usage.cacheCreationTokens * rates.cacheWrite) / 1_000_000
  }
  return cost
}

/**
 * Accumulates a run's per-turn usage into a single cost figure. A turn that
 * carries an authoritative `costUsd` (CLI providers) is summed directly;
 * everything else pools its token counts and is priced ONCE at `finalize()`
 * (R3) — never per turn, which would apply the run's resolved model's rate to
 * tokens that may have been billed at a different rate mid-run (failover).
 * That mid-run-failover imprecision is accepted by design.
 */
export interface CostAccumulator {
  addTurn(usage: UsageForCost): void
  finalize(provider: string | undefined, model: string | undefined, overrides?: PricingTable): number
}

export function createCostAccumulator(): CostAccumulator {
  let directCostUsd = 0
  let pendingInputTokens = 0
  let pendingOutputTokens = 0
  let pendingCacheReadTokens = 0
  let pendingCacheCreationTokens = 0

  return {
    addTurn(usage: UsageForCost): void {
      if (usage.costUsd !== undefined) {
        directCostUsd += usage.costUsd
        return
      }
      pendingInputTokens += usage.inputTokens
      pendingOutputTokens += usage.outputTokens
      pendingCacheReadTokens += usage.cacheReadTokens ?? 0
      pendingCacheCreationTokens += usage.cacheCreationTokens ?? 0
    },
    finalize(provider, model, overrides): number {
      if (
        pendingInputTokens === 0 && pendingOutputTokens === 0 &&
        pendingCacheReadTokens === 0 && pendingCacheCreationTokens === 0
      ) {
        return directCostUsd
      }
      return directCostUsd + estimateCost(provider, model, {
        inputTokens: pendingInputTokens,
        outputTokens: pendingOutputTokens,
        cacheReadTokens: pendingCacheReadTokens || undefined,
        cacheCreationTokens: pendingCacheCreationTokens || undefined,
      }, overrides)
    },
  }
}
