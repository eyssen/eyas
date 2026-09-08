// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { RoutingTier } from './routing/types.js'
import type { ProviderConfigService } from './provider-config-service.js'

/** Provider id used throughout onboarding reconcile logic. */
export const CLAUDE_CODE_PROVIDER_ID = 'claude-code'
export const GROK_CLI_PROVIDER_ID = 'grok-cli'
export const KIMI_CLI_PROVIDER_ID = 'kimi-cli'

/** Host CLI providers that share the same onboarding / session patterns. */
export const CLI_PROVIDER_IDS = [CLAUDE_CODE_PROVIDER_ID, GROK_CLI_PROVIDER_ID, KIMI_CLI_PROVIDER_ID] as const
export type CliProviderId = (typeof CLI_PROVIDER_IDS)[number]

export function isCliProviderId(id: string): id is CliProviderId {
  return (CLI_PROVIDER_IDS as readonly string[]).includes(id)
}

/** Default model used when Claude Code becomes the global default provider. */
export const CLAUDE_CODE_DEFAULT_MODEL = 'claude-code-sonnet'
/** Default model used when Grok CLI becomes the global default provider. */
export const GROK_CLI_DEFAULT_MODEL = 'grok-cli-default'
/** Default model used when Kimi Code CLI becomes the global default provider. */
export const KIMI_CLI_DEFAULT_MODEL = 'kimi-cli-default'

export const CLI_DEFAULT_MODELS: Record<CliProviderId, string> = {
  'claude-code': CLAUDE_CODE_DEFAULT_MODEL,
  'grok-cli': GROK_CLI_DEFAULT_MODEL,
  'kimi-cli': KIMI_CLI_DEFAULT_MODEL,
}

/**
 * Claude Code model assigned per routing tier when that tier is still
 * unconfigured (empty `provider_id`). `embedding` is intentionally omitted —
 * Claude Code has no embedding model, so that tier is left empty.
 */
export const CLAUDE_CODE_TIER_DEFAULTS: Partial<Record<RoutingTier, { modelId: string; fallbackModelId: string | null }>> = {
  triage: { modelId: 'claude-code-haiku', fallbackModelId: 'claude-code-sonnet' },
  quick: { modelId: 'claude-code-haiku', fallbackModelId: 'claude-code-sonnet' },
  standard: { modelId: 'claude-code-sonnet', fallbackModelId: 'claude-code-haiku' },
  complex: { modelId: 'claude-code-opus', fallbackModelId: 'claude-code-sonnet' },
  code: { modelId: 'claude-code-sonnet', fallbackModelId: 'claude-code-opus' },
  heartbeat: { modelId: 'claude-code-haiku', fallbackModelId: null },
  prompt_enhancer: { modelId: 'claude-code-sonnet', fallbackModelId: 'claude-code-haiku' },
}

/**
 * Grok CLI currently exposes a single primary model — every non-embedding
 * tier points at it. Fallback is null (no cheaper alias).
 */
export const GROK_CLI_TIER_DEFAULTS: Partial<Record<RoutingTier, { modelId: string; fallbackModelId: string | null }>> = {
  triage: { modelId: GROK_CLI_DEFAULT_MODEL, fallbackModelId: null },
  quick: { modelId: GROK_CLI_DEFAULT_MODEL, fallbackModelId: null },
  standard: { modelId: GROK_CLI_DEFAULT_MODEL, fallbackModelId: null },
  complex: { modelId: GROK_CLI_DEFAULT_MODEL, fallbackModelId: null },
  code: { modelId: GROK_CLI_DEFAULT_MODEL, fallbackModelId: null },
  heartbeat: { modelId: GROK_CLI_DEFAULT_MODEL, fallbackModelId: null },
  prompt_enhancer: { modelId: GROK_CLI_DEFAULT_MODEL, fallbackModelId: null },
}

/**
 * Kimi Code CLI tier map — coding default for most tiers; K3 for complex.
 */
export const KIMI_CLI_TIER_DEFAULTS: Partial<Record<RoutingTier, { modelId: string; fallbackModelId: string | null }>> = {
  triage: { modelId: 'kimi-cli-k2.6', fallbackModelId: KIMI_CLI_DEFAULT_MODEL },
  quick: { modelId: 'kimi-cli-k2.6', fallbackModelId: KIMI_CLI_DEFAULT_MODEL },
  standard: { modelId: KIMI_CLI_DEFAULT_MODEL, fallbackModelId: 'kimi-cli-k2.6' },
  complex: { modelId: 'kimi-cli-k3', fallbackModelId: KIMI_CLI_DEFAULT_MODEL },
  code: { modelId: 'kimi-cli-k2.7-code', fallbackModelId: KIMI_CLI_DEFAULT_MODEL },
  heartbeat: { modelId: 'kimi-cli-k2.6', fallbackModelId: null },
  prompt_enhancer: { modelId: KIMI_CLI_DEFAULT_MODEL, fallbackModelId: 'kimi-cli-k2.6' },
}

export const CLI_TIER_DEFAULTS: Record<CliProviderId, Partial<Record<RoutingTier, { modelId: string; fallbackModelId: string | null }>>> = {
  'claude-code': CLAUDE_CODE_TIER_DEFAULTS,
  'grok-cli': GROK_CLI_TIER_DEFAULTS,
  'kimi-cli': KIMI_CLI_TIER_DEFAULTS,
}

/**
 * Fill empty routing tiers with models from the given CLI provider.
 * Never overwrites a tier that already has a provider_id.
 */
export function reconcileCliProviderTiers(
  db: any,
  providerId: CliProviderId,
  available: boolean,
): RoutingTier[] {
  const tiersFilled: RoutingTier[] = []
  if (!available) return tiersFilled

  const defaults = CLI_TIER_DEFAULTS[providerId]
  const defaultModel = CLI_DEFAULT_MODELS[providerId]
  const now = new Date().toISOString()

  for (const [tier, mapping] of Object.entries(defaults) as Array<[RoutingTier, { modelId: string; fallbackModelId: string | null }]>) {
    const row = (db.all(sql`SELECT provider_id FROM routing_tiers WHERE tier = ${tier}`) as any[])[0]
    if (!row || row.provider_id) continue

    db.run(sql`UPDATE routing_tiers SET
      provider_id = ${providerId},
      model_id = ${mapping.modelId},
      fallback_provider_id = ${mapping.fallbackModelId ? providerId : null},
      fallback_model_id = ${mapping.fallbackModelId},
      updated_at = ${now}
      WHERE tier = ${tier}`)
    tiersFilled.push(tier)
  }

  db.run(sql`UPDATE provider_config SET default_model = ${defaultModel}
    WHERE id = ${providerId} AND (default_model IS NULL OR default_model = '')`)

  return tiersFilled
}

/**
 * Fix 1 — self-healing routing-tier reconcile for Claude Code.
 * @deprecated Prefer reconcileCliProviderTiers — kept for existing call sites/tests.
 */
export function reconcileClaudeCodeTiers(db: any, claudeCodeAvailable: boolean): RoutingTier[] {
  return reconcileCliProviderTiers(db, CLAUDE_CODE_PROVIDER_ID, claudeCodeAvailable)
}

/**
 * Enable a CLI provider. When `makeDefault` is true, also marks it the global
 * default. Callers must only invoke on fresh-install (or explicit wizard choice).
 */
export function applyCliFreshDefaults(
  providerConfig: ProviderConfigService,
  providerId: CliProviderId,
  makeDefault: boolean,
): void {
  providerConfig.updateProvider(providerId, { enabled: true })
  if (makeDefault) {
    providerConfig.setDefault(providerId, CLI_DEFAULT_MODELS[providerId])
  }
}

/**
 * Fix 2 — mark Claude Code enabled and the global default provider.
 * @deprecated Prefer applyCliFreshDefaults — kept for existing call sites/tests.
 */
export function applyClaudeCodeFreshDefaults(providerConfig: ProviderConfigService): void {
  applyCliFreshDefaults(providerConfig, CLAUDE_CODE_PROVIDER_ID, true)
}

/**
 * Apply the wizard's primary CLI choice: set global default + fill any still-
 * empty routing tiers from that provider. Does not disable the other CLI.
 */
export function applyPrimaryCliProvider(
  db: any,
  providerConfig: ProviderConfigService,
  providerId: CliProviderId,
): void {
  providerConfig.updateProvider(providerId, { enabled: true })
  providerConfig.setDefault(providerId, CLI_DEFAULT_MODELS[providerId])
  reconcileCliProviderTiers(db, providerId, true)
}
