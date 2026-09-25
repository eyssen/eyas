// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createModelGateway } from './gateway.js'
import { createEgressSlot } from './egress.js'
import { createReauthHealer } from './reauth-healer.js'
import { AgentModelAssignmentsSchema, buildAgentProposals, applyAgentModelAssignments } from './ai-models-step.js'
import type { ProviderModels } from './tier-resolver.js'
import { createProviderConfigService } from './provider-config-service.js'
import { createReasoningRegistry } from './reasoning/registry.js'
import { buildBudgetStatus, readSpendTotals } from './routing/spending.js'
import { getTierEffort, readAutoRoutingEnabled, readTiers } from './routing/tier-store.js'
import { catalogBindingDeps, createBindingResolver, findModelOwner, resolveDefault } from './binding.js'
import { createAuxiliaryModelService } from './auxiliary.js'
import { isRuntimeVerifiedModel } from './cli-model-id.js'
import { createLazyGateway } from './lazy-gateway.js'
import { resolveModelContextWindow } from './model-window.js'
import { classifyAuthError } from '@shared/classify-auth-error.js'
import { startRunScratchSweeper } from './cli-runtime/workspaces.js'
import { createCliSignInService, isCliSignInProvider } from './cli-runtime/sign-in.js'
import { configureCliSandbox } from './cli-runtime/sandbox/index.js'
import { createAcpProfile } from './submodules/grok-cli/acp-profiles.js'
import { anthropicManifest } from './submodules/anthropic/manifest.js'
import { openaiManifest } from './submodules/openai/manifest.js'
import { openrouterManifest } from './submodules/openrouter/manifest.js'
import { geminiManifest } from './submodules/gemini/manifest.js'
import { claudeCodeManifest, isClaudeRuntimeUsable } from './submodules/claude-code/manifest.js'
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

/** Stops the run scratch sweeper started in onStart. */
let stopRunScratchSweeper: (() => void) | null = null

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
    // Kernel file sandbox for the CLIs' own tools: every CLI turn, the
    // provider panel and the sandbox status read security.cliSandbox here,
    // per call (cli-runtime/sandbox).
    configureCliSandbox({ mode: () => ctx.config?.security?.cliSandbox })

    // Continuity is EYAS replay only: no provider session is ever resumed, so
    // the old conversation → Claude Code session id table goes away.
    try { ctx.db.run(sql`DROP TABLE IF EXISTS claude_code_sessions`) } catch (err) {
      ctx.logger.warn({ err }, 'model: dropping the legacy claude_code_sessions table failed')
    }

    // Create tables
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS provider_config (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, settings TEXT DEFAULT '{}', is_default INTEGER NOT NULL DEFAULT 0, default_model TEXT, updated_at TEXT NOT NULL)`)
    // Migrate existing tables: add columns if missing
    try { ctx.db.run(sql`ALTER TABLE provider_config ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`) } catch {}
    try { ctx.db.run(sql`ALTER TABLE provider_config ADD COLUMN default_model TEXT`) } catch {}
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS model_config (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES provider_config(id), model_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, context_window INTEGER, max_output_tokens INTEGER, supports_tools INTEGER DEFAULT 1, supports_images INTEGER DEFAULT 1, supports_streaming INTEGER DEFAULT 1, updated_at TEXT NOT NULL)`)
    // model_config additive columns — the ONE block for this table; later
    // waves append their ALTERs here (fresh installs get them the same way).
    // metadata: provider-discovered facts as JSON (ModelConfigMetadataSchema).
    try { ctx.db.run(sql`ALTER TABLE model_config ADD COLUMN metadata TEXT`) } catch { /* column already exists */ }

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
    // routing_tiers.effort: the tier's default reasoning effort (NULL = Auto).
    // The Low seed for the cheap tiers runs only in the boot that creates the
    // column (the ALTER throws on every later boot), so a tier the user later
    // sets to Auto is never re-seeded. Fresh installs get the column here too,
    // and their seed INSERT below carries each tier's default.
    {
      const { LOW_EFFORT_DEFAULT_TIERS } = await import('./routing/types.js')
      let effortColumnAdded = false
      try {
        ctx.db.run(sql`ALTER TABLE routing_tiers ADD COLUMN effort TEXT`)
        effortColumnAdded = true
      } catch { /* column already exists */ }
      if (effortColumnAdded) {
        for (const tier of LOW_EFFORT_DEFAULT_TIERS) {
          ctx.db.run(sql`UPDATE routing_tiers SET effort = 'low' WHERE tier = ${tier} AND effort IS NULL`)
        }
      }
    }

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
        ctx.db.run(sql`INSERT INTO routing_tiers (tier, provider_id, model_id, fallback_provider_id, fallback_model_id, description, enabled, updated_at, effort)
          VALUES (${t.tier}, ${t.providerId}, ${t.modelId}, ${t.fallbackProviderId}, ${t.fallbackModelId}, ${t.description}, ${t.enabled ? 1 : 0}, ${now}, ${t.effort ?? null})`)
        inserted++
      }
      if (inserted > 0) ctx.logger.info(`Seeded ${inserted} routing tier(s)`)
    }

    // Seed budget config if missing
    const budgetCount = ((ctx.db as any).all(sql`SELECT COUNT(*) as cnt FROM routing_budget`) as any[])[0]?.cnt ?? 0
    if (budgetCount === 0) {
      ctx.db.run(sql`INSERT INTO routing_budget (id) VALUES ('global')`)
    }

    const configService = createProviderConfigService(ctx.db, ctx.logger)
    ctx.providerConfig = configService

    // One answer to "which effort levels does this model accept": discovered
    // levels (model_config.metadata.reasoning) merged over the static overlay.
    ctx.reasoningRegistry = createReasoningRegistry({
      getDiscovered: (providerId, modelId) => configService.getModelMetadata(providerId, modelId)?.reasoning ?? null,
      // The concrete model a discovery named, so a lookup by the EYAS pair
      // alone (gateway, write-time effort validation) matches its overlay row.
      getRealModelId: (providerId, modelId) => configService.getModelMetadata(providerId, modelId)?.realModelId,
      logger: ctx.logger,
    })

    // The one window resolver (model-window.ts): window + tool support of a
    // model, read per call so a models refresh is seen at once. The catalog
    // (model_config) is its only per-model source: the per-model capability
    // record above (reasoningRegistry) holds reasoning facts only — effort
    // levels and thinking — never a window or tool support.
    ctx.modelWindow = (target) => resolveModelContextWindow(target, { catalog: ctx.providerConfig })
    ctx.providerReload = new Map()

    // Reauth healer (Cap 4) — on an auth error the gateway notifies the healer,
    // which reloads that provider's credentials once per cooldown and tracks a
    // health badge. A successful call clears it. Single source of truth for
    // "is this an auth failure" is @shared/classify-auth-error.
    // Sign-in into the EYAS-owned Grok/Kimi homes (device code, or an API key
    // in EYAS secrets). The login runs through the same launch profile as
    // every turn; the stored key reaches grok only through that profile.
    const cliSignIn = createCliSignInService({
      profileFor: (id) => createAcpProfile(id, { extraEnv: () => cliSignIn.profileEnv(id) }),
      secrets: ctx.secrets,
      logger: ctx.logger,
      // A sign-in clears a stale auth badge from an earlier failed call.
      onChange: (id, signedIn) => { if (signedIn) reauthHealer.recordSuccess(id) },
    })
    ctx.cliSignIn = cliSignIn

    const reauthHealer = createReauthHealer({
      classify: classifyAuthError,
      reload: (id) => {
        const fn = ctx.providerReload.get(id)
        return fn ? fn() : Promise.resolve()
      },
      // A registered Grok/Kimi CLI whose EYAS home is not signed in cannot
      // answer at all: badge it before the first call fails.
      signInRequired: (id) => isCliSignInProvider(id) && !!ctx.model?.getProvider(id) && !cliSignIn.isSignedIn(id),
    })
    ;(ctx as any).reauthHealer = reauthHealer

    // Failover (D10) — the gateway retries a transient failure once on the same
    // provider and, for auto-routed calls only, hops to the tier's configured
    // fallback. The tier lookup is injected so the gateway stays DB-free; both
    // ids must be configured, since hopping providers with the primary's model
    // id would just fail on the other side. A request naming neither provider
    // nor model goes to the install default (binding.ts resolveDefault).
    // Outgoing traffic passes the egress slot on every attempt; an egress
    // filter (privacy) installs itself through ctx.modelEgress.
    const egress = createEgressSlot()
    ctx.modelEgress = egress
    const gateway = createModelGateway({
      onError: (id, err) => { void reauthHealer.onProviderError(id, err) },
      onSuccess: (id) => reauthHealer.recordSuccess(id),
    }, {
      getTierFallback: (tier) => {
        try {
          const row = readTiers(ctx.db).find((t) => t.tier === tier && t.enabled)
          const providerId = row?.fallbackProviderId
          const modelId = row?.fallbackModelId
          if (!providerId || !modelId) return null
          return { providerId, modelId }
        } catch (err) {
          ctx.logger.debug({ err, tier }, 'tier fallback lookup failed — no cross-provider failover')
          return null
        }
      },
      getDefault: () => resolveDefault({
        getTiers: () => readTiers(ctx.db),
        providerConfig: ctx.providerConfig,
        isRegistered: (id) => !!gateway.getProvider(id),
      }),
      // A model a refresh discovered (only model_config knows it) still
      // routes when a caller names just the model.
      lookupModelOwner: (modelId) => findModelOwner({
        providerConfig: ctx.providerConfig,
        isRegistered: (id) => !!gateway.getProvider(id),
      }, modelId, { exact: true }),
      egress,
      // Effort is resolved per attempt against the model that attempt goes
      // to: its capability (discovered levels over the overlay, matched on
      // the concrete model a discovery named), its output cap, and — for an
      // auto-routed call without an intent — the tier's default effort.
      getReasoningCapability: (providerId, modelId) => ctx.reasoningRegistry!.get(providerId, modelId),
      getMaxOutputTokens: (providerId, modelId) => {
        const row = ((ctx.db as any).all(sql`SELECT max_output_tokens FROM model_config
          WHERE provider_id = ${providerId} AND model_id = ${modelId} LIMIT 1`) as Array<{ max_output_tokens: number | null }>)[0]
        return typeof row?.max_output_tokens === 'number' ? row.max_output_tokens : null
      },
      getTierEffort: (tier) => getTierEffort(ctx.db, tier, ctx.logger),
      logger: ctx.logger,
    })
    ctx.model = gateway

    // Conversation/agent binding (D3): pinned pair, Auto-routing only on an
    // Auto conversation (and only while the switch allows it), the
    // colleague's pair, the install default. Read per call: providers
    // register, the catalog refreshes and the decision engine appears in
    // onStart, all after this.
    ctx.modelBinding = createBindingResolver(catalogBindingDeps({
      isRegistered: (id) => !!ctx.model?.getProvider(id),
      getCatalog: () => ctx.providerConfig,
      getTiers: () => readTiers(ctx.db),
      getRouter: () => (ctx as any).decisionEngine,
      autoRoutingEnabled: () => readAutoRoutingEnabled(ctx.db),
    }))

    // Background model calls resolve through one isolation-aware service.
    // Everything is read per call: ctx.model is the trace-wrapped gateway by
    // then (privacy masks inside the egress slot), and the decision engine
    // appears in onStart.
    ctx.auxiliaryModel = createAuxiliaryModelService({
      getGateway: () => ctx.model,
      getTiers: () => readTiers(ctx.db),
      getProviderConfig: () => ctx.providerConfig,
      getBudgetStatus: () => (ctx as any).decisionEngine?.getBudgetStatus?.() ?? null,
      // The purpose's tier effort, sent as an intent the gateway resolves.
      getTierEffort: (tier) => getTierEffort(ctx.db, tier, ctx.logger),
      // A CLI is pinned to a model only when its own runtime discovery
      // offered that model (else by provider, and the CLI picks its default).
      isRuntimeVerifiedModel: (providerId, modelId) => isRuntimeVerifiedModel(ctx.providerConfig, providerId, modelId),
      logger: ctx.logger,
    })

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
        let json: unknown = {}
        try { json = JSON.parse(raw) } catch { json = {} }
        // { agentId: {providerId, modelId} | modelId } (H4); anything else is ignored.
        const parsed = AgentModelAssignmentsSchema.safeParse(json)
        if (!parsed.success) {
          ctx.logger.warn({ issues: parsed.error.issues.length }, 'ai-models step: assignments not applied (invalid shape)')
          return
        }
        const { unknown } = applyAgentModelAssignments(ctx.db, parsed.data)
        if (unknown.length > 0) ctx.logger.warn({ agents: unknown }, 'ai-models step: unknown models skipped')
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
        // Claude Code: the resolved runtime is signed in, not merely `claude` on PATH.
        claudeFresh ? isClaudeRuntimeUsable({ logger: ctx.logger }) : Promise.resolve(false),
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

    // Initialize decision engine. Both handles are read per call: privacy
    // and tracing wrap ctx.model after this onStart, so a captured gateway
    // would send the triage classifier around them.
    const { createDecisionEngine } = await import('./routing/decision-engine.js')
    const decisionEngine = createDecisionEngine({
      gateway: createLazyGateway(() => ctx.model),
      getAux: () => ctx.auxiliaryModel,
      getTiers: () => readTiers(ctx.db),
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
        // (background calls included) in observability's ai_traces table;
        // readSpendTotals sums it over each budget window and the decision
        // engine downgrades/stops when a limit is exceeded.
        const row = ((ctx.db as any).all(sql`SELECT * FROM routing_budget WHERE id = 'global'`) as any[])[0]
        const budget = {
          dailyLimit: row?.daily_limit ?? null,
          weeklyLimit: row?.weekly_limit ?? null,
          monthlyLimit: row?.monthly_limit ?? null,
          warnAt: row?.warn_at ?? 0.8,
          downgradeAt: row?.downgrade_at ?? 1.0,
          hardStopAt: row?.hard_stop_at ?? 1.2,
        }
        return buildBudgetStatus(readSpendTotals(ctx.db, ctx.logger), budget)
      },
    })
    ;(ctx as any).decisionEngine = decisionEngine

    // Store routing routes factory for auth module to register
    // (auth module must register routes AFTER auth middleware is wired)
    ;(ctx as any)._pendingRoutingRoutes = async () => {
      const { createRoutingRoutes } = await import('./routing/routes.js')
      createRoutingRoutes(ctx.http, ctx.db, {
        getAuxiliaryModel: () => ctx.auxiliaryModel,
        // A tier's effort is validated against the tier's model.
        getReasoningRegistry: () => ctx.reasoningRegistry,
      })
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
        const assignments: Record<string, { providerId: string; modelId: string }> = {}
        for (const a of buildAgentProposals(rows, providerModels, preferredProviderId)) {
          if (a.proposedProviderId && a.proposedModelId) assignments[a.id] = { providerId: a.proposedProviderId, modelId: a.proposedModelId }
        }
        await ctx.setup.completeStep('ai-models', { assignments: JSON.stringify(assignments) })
        ctx.logger.info({ count: Object.keys(assignments).length }, 'ai-models step auto-completed from env')
      } catch (err) {
        ctx.logger.warn({ err }, 'ai-models env auto-complete failed (non-fatal)')
      }
    }

    // Wave 2 — suggest/apply empty tier fallbacks when ≥2 providers are live.
    // Opt-in via EYAS_AUTO_FAILOVER=1 or config.model.autoFailover === true.
    // Never overwrites operator-set fallbacks (see planAutoFailover).
    try {
      const autoOn =
        process.env.EYAS_AUTO_FAILOVER === '1' ||
        process.env.EYAS_AUTO_FAILOVER === 'true' ||
        (ctx.config as any)?.model?.autoFailover === true
      if (autoOn) {
        const { planAutoFailover } = await import('./routing/auto-failover.js')
        const live = []
        for (const p of ctx.model.listProviders()) {
          const models = await p.listModels().catch(() => [])
          live.push({ id: p.id, models: models.map((m) => ({ id: m.id })) })
        }
        const tiers = (ctx as any).decisionEngine?.getTiers?.()
          ?? (ctx as any).routing?.listTiers?.()
          ?? []
        // Prefer provider-config tier rows when decision engine shape differs
        const tierRows = Array.isArray(tiers) && tiers.length
          ? tiers
          : ((ctx.db as any).all?.(
              // best-effort — table name from routing schema
              (await import('drizzle-orm')).sql`SELECT tier, provider_id as providerId, model_id as modelId,
                fallback_provider_id as fallbackProviderId, fallback_model_id as fallbackModelId, enabled
                FROM routing_tiers`,
            ) as any[]) ?? []
        const plan = planAutoFailover(
          tierRows.map((t: any) => ({
            tier: t.tier,
            providerId: t.providerId ?? t.provider_id ?? '',
            modelId: t.modelId ?? t.model_id ?? '',
            fallbackProviderId: t.fallbackProviderId ?? t.fallback_provider_id ?? '',
            fallbackModelId: t.fallbackModelId ?? t.fallback_model_id ?? '',
            enabled: t.enabled !== 0 && t.enabled !== false,
            description: '',
            updatedAt: '',
          })),
          live,
        )
        for (const item of plan) {
          try {
            ;(ctx.db as any).run?.(
              (await import('drizzle-orm')).sql`UPDATE routing_tiers SET
                fallback_provider_id = ${item.fallbackProviderId},
                fallback_model_id = ${item.fallbackModelId}
                WHERE tier = ${item.tier}
                  AND (fallback_provider_id IS NULL OR fallback_provider_id = '')`,
            )
            ctx.logger.info(
              { tier: item.tier, fallback: `${item.fallbackProviderId}/${item.fallbackModelId}` },
              'auto-failover: tier fallback applied',
            )
          } catch (err) {
            ctx.logger.debug({ err: String(err), tier: item.tier }, 'auto-failover apply skipped')
          }
        }
        if (plan.length) {
          ctx.logger.info({ count: plan.length }, 'auto-failover planned and applied where possible')
        }
      }
    } catch (err) {
      ctx.logger.debug({ err: String(err) }, 'auto-failover pass skipped')
    }

    // CLI runs without folders work in <workspaces>/_runs/<runId>; folders of
    // runs that stopped asking for them are removed after a week.
    stopRunScratchSweeper?.()
    stopRunScratchSweeper = startRunScratchSweeper({ logger: ctx.logger })

    const providerCount = ctx.model.listProviders().length
    ctx.logger.info({ providerCount }, 'Model module started')
  },

  async onStop(ctx?: ModuleContext) {
    stopRunScratchSweeper?.()
    stopRunScratchSweeper = null
    // A pending device sign-in must not outlive the server.
    ctx?.cliSignIn?.dispose()
  },
}
