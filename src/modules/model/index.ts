// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createModelGateway } from './gateway.js'
import { createReauthHealer } from './reauth-healer.js'
import { buildAgentProposals, applyAgentModelAssignments } from './ai-models-step.js'
import type { ProviderModels } from './tier-resolver.js'
import { createProviderConfigService } from './provider-config-service.js'
import { buildBudgetStatus } from './routing/spending.js'
import { classifyAuthError } from '@shared/classify-auth-error.js'
import { anthropicManifest } from './submodules/anthropic/manifest.js'
import { openaiManifest } from './submodules/openai/manifest.js'
import { openrouterManifest } from './submodules/openrouter/manifest.js'
import { geminiManifest } from './submodules/gemini/manifest.js'
import { claudeCodeManifest, isClaudeCliAvailable } from './submodules/claude-code/manifest.js'
import { grokCliManifest, isGrokCliAvailable } from './submodules/grok-cli/manifest.js'
import { kimiManifest } from './submodules/kimi/manifest.js'
import { kimiCliManifest, isKimiCliAvailable } from './submodules/kimi-cli/manifest.js'
import { openaiCompatManifest } from './submodules/openai-compat/manifest.js'
import { anthropicCompatManifest } from './submodules/anthropic-compat/manifest.js'
import { ollamaManifest } from './submodules/ollama/manifest.js'
import { lmstudioManifest } from './submodules/lmstudio/manifest.js'
import {
  reconcileCliProviderTiers,
  applyCliFreshDefaults,
  applyPrimaryCliProvider,
  isCliProviderId,
  CLAUDE_CODE_PROVIDER_ID,
  GROK_CLI_PROVIDER_ID,
  KIMI_CLI_PROVIDER_ID,
  CLI_PROVIDER_IDS,
  type CliProviderId,
} from './onboarding-reconcile.js'

export const modelModule: EyasModule = {
  id: 'model',
  name: 'Model',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'AI provider gateway — Anthropic, OpenAI, OpenRouter, Gemini, Kimi, xAI, Mistral, Groq, and OpenClaw-compatible OpenAI/Anthropic endpoints, plus Claude/Grok/Kimi CLIs, Ollama, LM Studio, vLLM',
  dependencies: ['secrets', 'setup'],

  submodules: [
    anthropicManifest,
    openaiManifest,
    openrouterManifest,
    geminiManifest,
    kimiManifest,
    openaiCompatManifest,
    anthropicCompatManifest,
    claudeCodeManifest,
    grokCliManifest,
    kimiCliManifest,
    ollamaManifest,
    lmstudioManifest,
  ],

  async onRegister(ctx: ModuleContext) {
    // Claude Code CLI session continuity (conversation → SDK session id)
    try {
      const { createClaudeSessionTables, createClaudeSessionStore } = await import('./submodules/claude-code/session-store.js')
      createClaudeSessionTables(ctx.db)
      ;(ctx as any).claudeSessionStore = createClaudeSessionStore(ctx.db)
    } catch (err) {
      ctx.logger.warn({ err }, 'model: claude session store init failed')
    }

    // Create tables
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS provider_config (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, settings TEXT DEFAULT '{}', is_default INTEGER NOT NULL DEFAULT 0, default_model TEXT, updated_at TEXT NOT NULL)`)
    // Migrate existing tables: add columns if missing
    try { ctx.db.run(sql`ALTER TABLE provider_config ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`) } catch {}
    try { ctx.db.run(sql`ALTER TABLE provider_config ADD COLUMN default_model TEXT`) } catch {}
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS model_config (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES provider_config(id), model_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, context_window INTEGER, max_output_tokens INTEGER, supports_tools INTEGER DEFAULT 1, supports_images INTEGER DEFAULT 1, supports_streaming INTEGER DEFAULT 1, updated_at TEXT NOT NULL)`)

    // Routing tiers table
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS routing_tiers (
      tier TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      fallback_provider_id TEXT,
      fallback_model_id TEXT,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)

    // Budget config table
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS routing_budget (
      id TEXT PRIMARY KEY DEFAULT 'global',
      auto_routing_enabled INTEGER NOT NULL DEFAULT 1,
      daily_limit REAL,
      weekly_limit REAL,
      monthly_limit REAL,
      warn_at REAL NOT NULL DEFAULT 0.8,
      downgrade_at REAL NOT NULL DEFAULT 1.0,
      hard_stop_at REAL NOT NULL DEFAULT 1.2,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)

    // Seed default tiers — insert any tier from DEFAULT_TIERS that isn't yet
    // present, so schema additions (new tiers) propagate to existing DBs too.
    {
      const { DEFAULT_TIERS } = await import('./routing/types.js')
      const now = new Date().toISOString()
      const existing = new Set(
        ((ctx.db as any).all(sql`SELECT tier FROM routing_tiers`) as any[]).map((r: any) => r.tier),
      )
      let inserted = 0
      for (const t of DEFAULT_TIERS) {
        if (existing.has(t.tier)) continue
        ctx.db.run(sql`INSERT INTO routing_tiers (tier, provider_id, model_id, fallback_provider_id, fallback_model_id, description, enabled, updated_at)
          VALUES (${t.tier}, ${t.providerId}, ${t.modelId}, ${t.fallbackProviderId}, ${t.fallbackModelId}, ${t.description}, ${t.enabled ? 1 : 0}, ${now})`)
        inserted++
      }
      if (inserted > 0) ctx.logger.info(`Seeded ${inserted} routing tier(s)`)
    }

    // Seed budget config if missing
    const budgetCount = ((ctx.db as any).all(sql`SELECT COUNT(*) as cnt FROM routing_budget`) as any[])[0]?.cnt ?? 0
    if (budgetCount === 0) {
      ctx.db.run(sql`INSERT INTO routing_budget (id) VALUES ('global')`)
    }

    const configService = createProviderConfigService(ctx.db)
    ctx.providerConfig = configService
    ctx.providerReload = new Map()

    // Reauth healer (Cap 4) — on an auth error the gateway notifies the healer,
    // which reloads that provider's credentials once per cooldown and tracks a
    // health badge. A successful call clears it. Single source of truth for
    // "is this an auth failure" is @shared/classify-auth-error.
    const reauthHealer = createReauthHealer({
      classify: classifyAuthError,
      reload: (id) => {
        const fn = ctx.providerReload.get(id)
        return fn ? fn() : Promise.resolve()
      },
    })
    ;(ctx as any).reauthHealer = reauthHealer

    // Failover (D10) — the gateway retries a transient failure once on the same
    // provider and, for auto-routed calls only, hops to the tier's configured
    // fallback. The tier lookup is injected so the gateway stays DB-free; both
    // ids must be configured, since hopping providers with the primary's model
    // id would just fail on the other side.
    const gateway = createModelGateway({
      onError: (id, err) => { void reauthHealer.onProviderError(id, err) },
      onSuccess: (id) => reauthHealer.recordSuccess(id),
    }, {
      getTierFallback: (tier) => {
        try {
          const row = ((ctx.db as any).all(
            sql`SELECT fallback_provider_id, fallback_model_id FROM routing_tiers WHERE tier = ${tier} AND enabled = 1`,
          ) as any[])[0]
          const providerId = row?.fallback_provider_id
          const modelId = row?.fallback_model_id
          if (!providerId || !modelId) return null
          return { providerId, modelId }
        } catch (err) {
          ctx.logger.debug({ err, tier }, 'tier fallback lookup failed — no cross-provider failover')
          return null
        }
      },
    })
    ctx.model = gateway

    // First-run wizard: pick + configure an AI provider before assigning
    // models. Optional (headless deploys skip it), but it is the single place
    // the user can, in-wizard: (a) see that locally-detected CLI providers
    // (Claude Code / Grok CLI) are already configured, (b) choose a primary
    // when both are present, and (c) set up a cloud provider instead.
    // Key/enable writes for cloud providers are done by the wizard UI through
    // authenticated /model/providers + /secrets endpoints; for CLI primary
    // selection the onComplete below sets the global default + fills empty
    // routing tiers.
    ctx.setup.registerStep({
      id: 'ai-provider',
      module: 'model',
      title: 'AI Provider',
      description: 'Choose and configure the AI provider that powers your agents',
      required: false,
      order: 28,
      fields: [
        { name: 'providerId', type: 'text', label: 'Primary / configured provider id', required: false },
      ],
      async onComplete(data) {
        const providerId = typeof data.providerId === 'string' ? data.providerId.trim() : ''
        if (!providerId || !isCliProviderId(providerId)) return
        try {
          applyPrimaryCliProvider(ctx.db, ctx.providerConfig, providerId)
          ctx.logger.info({ providerId }, 'Wizard primary CLI provider applied')
        } catch (err) {
          ctx.logger.warn({ err, providerId }, 'Wizard primary CLI apply failed (non-fatal)')
        }
      },
    })

    // First-run wizard: assign each pre-installed agent a suitable model.
    ctx.setup.registerStep({
      id: 'ai-models',
      module: 'model',
      title: 'AI Models',
      description: 'Assign the best model to each pre-installed agent',
      required: false,
      order: 30,
      fields: [
        { name: 'assignments', type: 'text', label: 'Model assignments (JSON)', required: false },
      ],
      async onComplete(data) {
        const raw = (data.assignments as string) || '{}'
        let map: Record<string, string> = {}
        try { map = JSON.parse(raw) } catch { map = {} }
        applyAgentModelAssignments(ctx.db, map)
      },
    })

    ctx.logger.info('Model module registered')
  },

  async onStart(ctx: ModuleContext) {
    // Onboarding Fix 2 (part 1): on a genuinely fresh install for each host
    // CLI provider — the provider_config row has never been created before
    // this boot — probe the CLI and, if present, enable it BEFORE the
    // submodules loop runs. `ensureProvider` creates the row disabled by
    // default; pre-flipping lets the submodule register in THIS boot.
    //
    // When multiple host CLIs are available on a fresh install, enable all but
    // set NEITHER as the global default — the setup wizard asks which is
    // primary. When only one is present, it becomes the default immediately.
    // Never runs again once the provider_config row exists.
    try {
      const claudeFresh = ctx.providerConfig.getProvider(CLAUDE_CODE_PROVIDER_ID) === null
      const grokFresh = ctx.providerConfig.getProvider(GROK_CLI_PROVIDER_ID) === null
      const kimiFresh = ctx.providerConfig.getProvider(KIMI_CLI_PROVIDER_ID) === null

      const [claudeOk, grokOk, kimiOk] = await Promise.all([
        claudeFresh ? isClaudeCliAvailable() : Promise.resolve(false),
        grokFresh ? isGrokCliAvailable() : Promise.resolve(false),
        kimiFresh ? isKimiCliAvailable() : Promise.resolve(false),
      ])

      // Track which CLIs we enable this boot so we can decide makeDefault.
      const enabledNow: CliProviderId[] = []
      if (claudeFresh) {
        ctx.providerConfig.ensureProvider(CLAUDE_CODE_PROVIDER_ID)
        if (claudeOk) enabledNow.push(CLAUDE_CODE_PROVIDER_ID)
      }
      if (grokFresh) {
        ctx.providerConfig.ensureProvider(GROK_CLI_PROVIDER_ID)
        if (grokOk) enabledNow.push(GROK_CLI_PROVIDER_ID)
      }
      if (kimiFresh) {
        ctx.providerConfig.ensureProvider(KIMI_CLI_PROVIDER_ID)
        if (kimiOk) enabledNow.push(KIMI_CLI_PROVIDER_ID)
      }

      if (enabledNow.length === 1) {
        applyCliFreshDefaults(ctx.providerConfig, enabledNow[0], true)
      } else if (enabledNow.length > 1) {
        for (const id of enabledNow) {
          applyCliFreshDefaults(ctx.providerConfig, id, false)
        }
        ctx.logger.info({ providers: enabledNow }, 'Multiple host CLIs detected — all enabled; wizard will pick primary')
      }
    } catch (err) {
      ctx.logger.warn({ err }, 'host-CLI fresh-install probe failed (non-fatal)')
    }

    const submodules = modelModule.submodules ?? []
    for (const sub of submodules) {
      if (sub.enabled && sub.onStart) {
        await sub.onStart(ctx)
      }
    }

    // Onboarding Fix 1 — self-healing routing-tier reconcile. Runs on every
    // boot, fills empty tiers from the current global default when it is a
    // host CLI provider; otherwise falls back to whichever single CLI is
    // enabled. Never overwrites configured tiers or flips `enabled`.
    try {
      const def = ctx.providerConfig.getDefault()
      let primary: CliProviderId | null = null
      if (def && isCliProviderId(def.providerId) && ctx.model.getProvider(def.providerId)) {
        primary = def.providerId
      } else {
        // No CLI default yet (multi-CLI wizard pending, or none enabled).
        // If exactly one CLI is registered, fill from that; if multiple, leave
        // tiers empty until the wizard picks a primary.
        const registered: CliProviderId[] = []
        for (const id of CLI_PROVIDER_IDS) {
          if (ctx.model.getProvider(id)) registered.push(id)
        }
        if (registered.length === 1) primary = registered[0]
      }
      if (primary) {
        const tiersFilled = reconcileCliProviderTiers(ctx.db, primary, true)
        if (tiersFilled.length > 0) {
          ctx.logger.info({ tiers: tiersFilled, provider: primary }, 'Routing tiers auto-configured for host CLI')
        }
      }
    } catch (err) {
      ctx.logger.warn({ err }, 'routing-tier reconcile failed (non-fatal)')
    }

    // Initialize decision engine
    const { createDecisionEngine } = await import('./routing/decision-engine.js')
    const decisionEngine = createDecisionEngine({
      gateway: ctx.model,
      getTiers() {
        const rows = (ctx.db as any).all(sql`SELECT * FROM routing_tiers`) as any[]
        return rows.map((r: any) => ({
          tier: r.tier, providerId: r.provider_id, modelId: r.model_id,
          fallbackProviderId: r.fallback_provider_id, fallbackModelId: r.fallback_model_id,
          description: r.description, enabled: !!r.enabled, updatedAt: r.updated_at,
        }))
      },
      getBudget() {
        const row = ((ctx.db as any).all(sql`SELECT * FROM routing_budget WHERE id = 'global'`) as any[])[0]
        return {
          dailyLimit: row?.daily_limit ?? null,
          weeklyLimit: row?.weekly_limit ?? null,
          monthlyLimit: row?.monthly_limit ?? null,
          warnAt: row?.warn_at ?? 0.8,
          downgradeAt: row?.downgrade_at ?? 1.0,
          hardStopAt: row?.hard_stop_at ?? 1.2,
        }
      },
      getSpending() {
        // Enforce user-set caps against real spend. Cost is recorded per call
        // in observability's ai_traces table; sum it over each budget window and
        // let the decision engine downgrade/stop when a limit is exceeded.
        const row = ((ctx.db as any).all(sql`SELECT * FROM routing_budget WHERE id = 'global'`) as any[])[0]
        const budget = {
          dailyLimit: row?.daily_limit ?? null,
          weeklyLimit: row?.weekly_limit ?? null,
          monthlyLimit: row?.monthly_limit ?? null,
          warnAt: row?.warn_at ?? 0.8,
          downgradeAt: row?.downgrade_at ?? 1.0,
          hardStopAt: row?.hard_stop_at ?? 1.2,
        }
        let daily = 0, weekly = 0, monthly = 0
        try {
          const spend = ((ctx.db as any).all(sql`SELECT
            COALESCE(SUM(CASE WHEN date(timestamp) = date('now') THEN cost_usd ELSE 0 END), 0) AS daily,
            COALESCE(SUM(CASE WHEN timestamp >= datetime('now', '-7 days') THEN cost_usd ELSE 0 END), 0) AS weekly,
            COALESCE(SUM(CASE WHEN timestamp >= datetime('now', 'start of month') THEN cost_usd ELSE 0 END), 0) AS monthly
            FROM ai_traces`) as any[])[0]
          daily = Number(spend?.daily ?? 0)
          weekly = Number(spend?.weekly ?? 0)
          monthly = Number(spend?.monthly ?? 0)
        } catch (err) {
          // ai_traces absent (observability disabled) — no spend source to
          // enforce against; treat as unconstrained rather than crashing.
          ctx.logger.debug({ err }, 'budget spend query skipped (ai_traces unavailable)')
        }
        return buildBudgetStatus({ daily, weekly, monthly }, budget)
      },
    })
    ;(ctx as any).decisionEngine = decisionEngine

    // Store routing routes factory for auth module to register
    // (auth module must register routes AFTER auth middleware is wired)
    ;(ctx as any)._pendingRoutingRoutes = async () => {
      const { createRoutingRoutes } = await import('./routing/routes.js')
      createRoutingRoutes(ctx.http, ctx.db)
    }

    // Pre-auth read endpoint backing the wizard's AI-models step. Allowed by
    // setupGuard (path under /api/v1/setup). Computes proposals at request time.
    ctx.http.get('/api/v1/setup/ai-models', async (c) => {
      try {
        const providerModels: ProviderModels[] = []
        const providersOut: Array<{ id: string; models: Array<{ id: string; name: string }> }> = []
        for (const provider of ctx.model.listProviders()) {
          const models = await provider.listModels()
          providerModels.push({ providerId: provider.id, modelIds: models.map((m) => m.id) })
          providersOut.push({ id: provider.id, models: models.map((m) => ({ id: m.id, name: m.name })) })
        }
        const preferredProviderId = ctx.providerConfig.getDefault()?.providerId ?? null
        const rows = (ctx.db as any).all(
          sql`SELECT id, name, agent_type FROM agent_definitions WHERE source = 'seed' ORDER BY name`,
        ) as Array<{ id: string; name: string; agent_type: string }>
        const agents = buildAgentProposals(rows, providerModels, preferredProviderId)
        const claudeDetected = providerModels.some((p) => p.providerId === CLAUDE_CODE_PROVIDER_ID)
        const grokDetected = providerModels.some((p) => p.providerId === GROK_CLI_PROVIDER_ID)
        const kimiDetected = providerModels.some((p) => p.providerId === KIMI_CLI_PROVIDER_ID)
        return c.json({
          claudeDetected,
          grokDetected,
          kimiDetected,
          // Back-compat: true when any host CLI is active.
          cliDetected: claudeDetected || grokDetected || kimiDetected,
          preferredProviderId,
          providers: providersOut,
          agents,
        })
      } catch (err) {
        ctx.logger.warn({ err }, 'ai-models read endpoint failed')
        return c.json({ error: 'Failed to enumerate providers' }, 500)
      }
    })

    // Headless: auto-apply the type-based mapping when explicitly opted in.
    // Best-effort — the entire block is wrapped so it can never crash startup.
    if (process.env.EYAS_SETUP_AI_MODELS === 'auto' && !ctx.setup.getStep('ai-models')?.completedAt) {
      try {
        const providerModels: ProviderModels[] = []
        for (const provider of ctx.model.listProviders()) {
          const models = await provider.listModels()
          providerModels.push({ providerId: provider.id, modelIds: models.map((m) => m.id) })
        }
        const preferredProviderId = ctx.providerConfig.getDefault()?.providerId ?? null
        const rows = (ctx.db as any).all(
          sql`SELECT id, name, agent_type FROM agent_definitions WHERE source = 'seed'`,
        ) as Array<{ id: string; name: string; agent_type: string }>
        const assignments: Record<string, string> = {}
        for (const a of buildAgentProposals(rows, providerModels, preferredProviderId)) {
          if (a.proposedModelId) assignments[a.id] = a.proposedModelId
        }
        await ctx.setup.completeStep('ai-models', { assignments: JSON.stringify(assignments) })
        ctx.logger.info({ count: Object.keys(assignments).length }, 'ai-models step auto-completed from env')
      } catch (err) {
        ctx.logger.warn({ err }, 'ai-models env auto-complete failed (non-fatal)')
      }
    }

    const providerCount = ctx.model.listProviders().length
    ctx.logger.info({ providerCount }, 'Model module started')
  },

  async onStop() {},
}
