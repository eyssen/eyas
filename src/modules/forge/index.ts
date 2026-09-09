// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createForgeTables } from './schema.js'
import { createFeedbackCollector } from './feedback-collector.js'
import { createFrictionAnalyzer } from './friction-analyzer.js'
import { createProposalStore } from './proposal-store.js'
import { createProposalEngine, type ProposalEngineDeps } from './proposal-engine.js'
import { createExperimentRunner } from './experiment-runner.js'
import { createProposalApplier } from './applier.js'
import { createForgeRoutes } from './routes.js'
import { gateHighConfidenceProposal, createForgeApplyHandler } from './apply-gate.js'
import type { ForgeConfig } from './types.js'

const DEFAULT_CONFIG: ForgeConfig = {
  minFeedbacksForAnalysis: 5,
  frictionRateThreshold: 0.3,
  autoApproveConfidence: 0.95,
  analysisWindowDays: 30,
  maxProposalsPerRun: 10,
}

export const forgeModule: EyasModule = {
  id: 'forge',
  name: 'Forge',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Collects usage feedback, detects friction patterns, and proposes improvements to skills and tools',
  dependencies: ['conversations', 'tools'],
  optional: ['skills', 'tools', 'scheduler'],

  async onRegister(ctx: ModuleContext) {
    createForgeTables(ctx.db)

    const config: ForgeConfig = {
      ...DEFAULT_CONFIG,
      ...(ctx.config as any).forge,
    }

    const collector = createFeedbackCollector(ctx.db)
    const analyzer = createFrictionAnalyzer(collector, config)
    const proposalStore = createProposalStore(ctx.db)
    // The tools/skills modules publish service *wrappers* on the context
    // (ctx.tools = { registry, executor, suggester }, ctx.skills = { loader, matcher }).
    // The proposal engine and applier need the underlying registry/loader — which
    // expose .get() — NOT the wrapper. Passing the wrapper made the engine call
    // wrapper.get() and throw, crashing every scan that hit a tool/skill pattern.
    // Resolution is lazy (read through ctx at call time) because forge is
    // registered before the skills module, so ctx.skills is not yet present here;
    // scans only run in onStart or later, by which point both are populated.
    const { toolRegistry, skillRegistry } = buildRegistryAccessors(ctx)
    // model/decisionEngine are not threaded in yet — onRegister runs before
    // the model module's onStart populates ctx.decisionEngine. onStart below
    // fills these in on the same deps object once both are available.
    const proposalEngineDeps: ProposalEngineDeps = { toolRegistry, skillRegistry }
    const proposalEngine = createProposalEngine(proposalStore, proposalEngineDeps)
    const experimentRunner = createExperimentRunner(ctx.db, proposalStore)
    const applier = createProposalApplier({ toolRegistry, skillRegistry })

    ;(ctx as any).forge = { config, collector, analyzer, proposalStore, proposalEngine, proposalEngineDeps, experimentRunner, applier }

    // Phase 6 wiring (forge_propose_soul_change tool + SOUL applier) runs in
    // onStart — depends on prompt-wizard.soulPipeline + agents.registry which
    // are not guaranteed to exist at onRegister time.

    ctx.logger.info('Forge module registered')
  },

  async onStart(ctx: ModuleContext) {
    await registerPhase6ForgeTools(ctx)

    const { config, collector, analyzer, proposalStore, proposalEngine, proposalEngineDeps, experimentRunner, applier } = (ctx as any).forge as {
      config: ForgeConfig
      collector: ReturnType<typeof createFeedbackCollector>
      analyzer: ReturnType<typeof createFrictionAnalyzer>
      proposalStore: ReturnType<typeof createProposalStore>
      proposalEngine: ReturnType<typeof createProposalEngine>
      proposalEngineDeps: ProposalEngineDeps
      experimentRunner: ReturnType<typeof createExperimentRunner>
      applier: ReturnType<typeof createProposalApplier>
    }

    // Thread the cheap-tier model + decision engine into the proposal engine
    // now — both are populated by this point (model's onStart already ran;
    // onRegister above ran too early for ctx.decisionEngine to exist).
    proposalEngineDeps.model = ctx.model
    proposalEngineDeps.decisionEngine = (ctx as any).decisionEngine
    proposalEngineDeps.logger = ctx.logger

    // Gated apply (Task 9 — safety-critical): register the apply-on-approval
    // handler for 'forge.apply' BEFORE the scan loop can enqueue anything, so
    // an owner approving a queued proposal (autonomyPolicy.decide(id,
    // 'approved', actor)) actually runs applier.apply(). If the autonomy
    // policy is unreachable, high-confidence proposals below are left
    // pending and logged — see gateHighConfidenceProposal.
    const autonomyPolicy = (ctx as any).securityGate?.autonomyPolicy
    autonomyPolicy?.registerApplyHandler?.(
      'forge.apply',
      createForgeApplyHandler({ applier, proposalStore, logger: ctx.logger }),
    )

    // Mount REST routes (soulApplier may be undefined if prompt-wizard was not loaded)
    const { soulApplier } = (ctx as any).forge as { soulApplier?: any }
    createForgeRoutes(ctx.http, { collector, analyzer, proposalStore, proposalEngine, experimentRunner, applier, soulApplier })

    // Auto-collect feedback when tools are executed
    ctx.bus.on('tools:executed', async (data: any) => {
      if (!data?.toolName || !data?.conversationId) return
      try {
        collector.record({
          target: 'tool',
          targetId: data.toolName,
          conversationId: data.conversationId,
          agentId: data.agentId,
          useful: data.success !== false,
          friction: data.error ? String(data.error) : undefined,
        })
      } catch (err) {
        ctx.logger.warn({ err, tool: data.toolName }, 'Failed to record tool feedback')
      }
    })

    // Run forge scan on scheduler trigger
    const runScan = async () => {
      // `forge.apply` Phase-3 loop flag (Task 10) — the flag that enables the
      // forge self-improvement loop overall, read fresh at fire time (never
      // cached), so toggling it takes effect on the next scan with no restart.
      // Absent feature store fails safe to disabled. OFF skips the model
      // authoring pass (falls back to the pre-Phase-3 string-concat) AND skips
      // enqueueing high-confidence proposals for owner approval.
      const forgeEnabled = (ctx as any).securityGate?.features?.isEnabled?.('forge.apply') === true

      ctx.logger.info('Forge scan triggered')
      const patterns = analyzer.analyze()
      let created = 0
      let queuedForApproval = 0

      for (const pattern of patterns) {
        const proposals = await proposalEngine.generateFromFriction(pattern, forgeEnabled)
        created += proposals.length

        for (const proposal of proposals) {
          // Gated apply (Task 9): a high-confidence proposal is NEVER
          // auto-applied here — it is enqueued for owner approval. The
          // actual apply fires only via the 'forge.apply' handler
          // registered above, on autonomyPolicy.decide(id, 'approved', …).
          // Task 10: the loop flag ALSO gates the enqueue step itself.
          if (proposal.confidence >= config.autoApproveConfidence && forgeEnabled) {
            gateHighConfidenceProposal(proposal, autonomyPolicy, ctx.logger)
            queuedForApproval++
          }
        }
      }

      ctx.logger.info({ patterns: patterns.length, created, queuedForApproval }, 'Forge scan complete')
      ctx.bus.emit('forge:scan-complete', { patterns: patterns.length, created, queuedForApproval })
    }

    ctx.bus.on('scheduler:job', async (data: any) => {
      if (data?.jobId !== 'forge-scan') return
      await runScan()
    })

    // Store runScan for manual trigger via routes
    ;(ctx as any).forge.runScan = runScan

    // Register scheduler job if scheduler is available
    if (ctx.hasModule('scheduler')) {
      const scheduler = (ctx as any).scheduler
      const existing = scheduler.list()

      if (!existing.some((j: any) => j.handler === 'forge.scan')) {
        scheduler.registerHandler('forge.scan', async () => {
          ctx.bus.emit('scheduler:job', { jobId: 'forge-scan' })
          return { triggered: true }
        })

        scheduler.create({
          name: 'Forge Scan',
          description: 'Analyze feedback friction patterns and generate improvement proposals',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '0 4 * * 0' }), // Weekly Sunday 04:00
          handler: 'forge.scan',
        })
        ctx.logger.info('Seeded forge scan scheduler job')
      }
    }

    ctx.logger.info('Forge module started')
  },

  async onStop(_ctx: ModuleContext) {
    // No cleanup needed
  },
}

// ─── Registry/skill accessors ──────────────────────

/**
 * Build lazy accessors over the tools/skills service wrappers on the module
 * context. Resolution is deferred to call time so that services registered
 * after forge (e.g. skills) are still picked up, and so the applier can mutate
 * the live tool object returned by the registry.
 *
 * Tool descriptions are stored on the live ToolImplementation objects held by
 * the registry (registry.get returns that live reference, and toToolDefinitions
 * reads .description off it), so updateDescription mutates in place. Skills are
 * DB-backed: the loader returns copies, so a persistent skill description update
 * requires a skill-loader.update method — see crossModuleNeeds; until it exists
 * the applier reports the skill change as needing manual application rather than
 * silently claiming success.
 */
export function buildRegistryAccessors(ctx: ModuleContext) {
  const toolRegistry = {
    get(name: string): { name: string; description: string } | undefined {
      return (ctx as any).tools?.registry?.get(name)
    },
    updateDescription(name: string, description: string): void {
      const tool = (ctx as any).tools?.registry?.get(name)
      if (tool) tool.description = description
    },
  }
  const skillRegistry = {
    get(id: string): { id: string; name: string; description: string; content: string } | undefined {
      return (ctx as any).skills?.loader?.get(id) ?? undefined
    },
    update(id: string, patch: { description?: string; content?: string }): boolean {
      const loader = (ctx as any).skills?.loader
      if (!loader?.update) return false
      return loader.update(id, patch) != null
    },
  }
  return { toolRegistry, skillRegistry }
}

// ─── Phase 6 forge tool wiring ─────────────────────

async function registerPhase6ForgeTools(ctx: ModuleContext): Promise<void> {
  const toolsCtx = (ctx as any).tools as { registry?: any } | undefined
  if (!toolsCtx?.registry) {
    ctx.logger.warn('Phase 6 forge tools skipped: tool registry unavailable')
    return
  }

  const { wrapAgentTool } = await import('@modules/agent/tools/wrap-agent-tool')
  const { createForgeProposeSoulTool } = await import('./tools/forge-propose-soul-tool.js')

  toolsCtx.registry.register(
    wrapAgentTool(
      createForgeProposeSoulTool({ db: ctx.db }),
      { category: 'agent', riskTier: 'yellow' },
    ),
  )

  // SOUL proposal applier — needs prompt-wizard.soulPipeline + agents.registry.
  // Both are populated in their respective onStart hooks, so order matters: if
  // either is missing we leave the applier off and rely on the existing
  // (non-soul) ProposalApplier for the legacy paths.
  const soulPipeline = (ctx as any).soulPipeline
  const wsLoader = (ctx as any).workspaceLoader
  const agentRegistry = (ctx as any).agents?.registry

  if (soulPipeline && wsLoader && agentRegistry) {
    const { createSoulProposalApplier } = await import('./soul-proposal-applier.js')
    const soulApplier = createSoulProposalApplier({
      db: ctx.db,
      workspaceLoader: wsLoader,
      soulPipeline,
      agentName: async (id: string) => agentRegistry.get(id)?.name ?? 'Unknown',
    })
    ;(ctx as any).forge.soulApplier = soulApplier
    ctx.logger.info('Forge module: SOUL proposal applier wired')
  } else {
    ctx.logger.warn('Forge module: SOUL applier skipped (soulPipeline/workspaceLoader/agentRegistry missing)')
  }

  ctx.logger.info('Forge module: forge_propose_soul_change tool registered')
}
