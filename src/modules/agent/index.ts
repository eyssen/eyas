// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { BusSubscription, EyasBus, EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createAgentRegistry } from './agent-registry.js'
import { createBudgetEngine } from './budget-engine.js'
import { createAgentSessionRegistryAdapter } from './session-registry-adapter.js'
import { createAgentDailyStats } from './daily-stats.js'
import { createAgentRunner } from './agent-runner.js'
import { createAgentMessaging } from './agent-messaging.js'
import { createTeamSessionService } from './team-session-service.js'
import { createOrchestrationOwnership } from './orchestration-ownership.js'
import { createOrchestrator, gcOrphanedWorktrees } from './orchestrator.js'
import { createDelegationService } from './delegation.js'
import { createLazyGateway } from '@modules/model/lazy-gateway'
import { ensureRunSupervisionSchema, createRunSupervisor } from './run-supervisor.js'
import { ensureAgentPlansSchema } from './plan-store.js'
import type { ConversationCriticDeps } from './conversation-runner.js'
import { createCheckpointTables, createCheckpointServices, type CheckpointServices } from './checkpoint/index.js'
import { latestSeqSync } from '@modules/event-store/event-store.js'
import { resumeRun, runConversation, DESTRUCTIVE_TOOLS } from './conversation-runner.js'
import {
  resumeParked,
  sweepApprovalResumes,
  cancelParkedRun,
  type ApprovalResumeDeps,
  type ResumeDecision,
} from './approval-resume.js'
import { generateId } from '@shared/crypto.js'
import { runAgentPostBoot } from './boot-recovery.js'
import { ensureTeamSchema } from './team-schema.js'
import { ensureGodModeSchema } from './god-mode/schema.js'
import { createGodModeStore } from './god-mode/store.js'
import { reviveTeamSessions, type TeamDriverDeps } from './team-driver.js'
import { sweepRetries } from './retry-sweep.js'
import { createCostAccumulator } from '@shared/model-pricing.js'
import { toolWorkspaceFields } from '@modules/tools/working-directories.js'
import { buildDelegatedSystemPrompt } from './delegated-system-prompt.js'

/** Replayable orchestration history is kept this long (pruned at startup). */
const ORCHESTRATION_EVENT_RETENTION_MS = 7 * 24 * 3600 * 1000

/**
 * Lazy WS broadcast shim: resolve the registry at broadcast time so nothing
 * here depends on module-init ordering (main.ts sets ctx.wsRegistry during
 * bootstrap, after every onRegister has run).
 */
function createLazyWsBroadcast(ctx: ModuleContext): (topic: string, message: unknown) => void {
  return (topic, message) => { (ctx as any).wsRegistry?.broadcast(topic, message) }
}

/**
 * Subscribe the monthly budget reset. The scheduler emits `model:budget:reset`
 * on the 1st of the month; without a subscriber `tokens_used_month` is never
 * cleared, so an agent that once exceeded its budget stays blocked forever.
 * Exported (and dependency-injected) so the wiring itself is unit-testable.
 *
 * F2 T8 — routes through `budgetEngine.resetAll()` (not the bare registry)
 * so the monthly reset ALSO clears the engine's in-memory alert dedup —
 * otherwise a threshold band crossed last month would stay suppressed
 * forever even after the counter that earned it was zeroed.
 */
export function wireBudgetReset(deps: {
  bus: Pick<EyasBus, 'on'>
  budgetEngine: { resetAll(): void }
  logger: { info(obj: unknown, msg?: string): void; error(obj: unknown, msg?: string): void }
}): BusSubscription {
  const { bus, budgetEngine, logger } = deps
  return bus.on('model:budget:reset', async () => {
    try {
      budgetEngine.resetAll()
      logger.info({ period: 'monthly' }, 'Agent budgets: monthly token counters reset')
    } catch (err) {
      logger.error({ err }, 'Agent budgets: monthly reset failed')
    }
  })
}

/**
 * F2 T6 — subscribe the two events that wake a parked run: the operator's
 * decision (`autonomy:approval-resolved`, emitted by the approve/reject
 * routes) and the TTL sweep's `autonomy:approval-expired`. Both handlers are
 * error-isolated: a resume that blows up must never propagate back into the
 * bus emitter (the HTTP route deciding the approval, or the security-gate
 * sweep), and the hourly resume sweep will retry it anyway.
 *
 * Exported and dependency-injected so the wiring itself is unit-testable.
 */
export function wireApprovalResume(
  bus: Pick<EyasBus, 'on'>,
  deps: ApprovalResumeDeps,
): BusSubscription[] {
  const drive = async (approvalId: unknown, decision: ResumeDecision): Promise<void> => {
    const id = Number(approvalId)
    if (!Number.isFinite(id)) return
    try {
      await resumeParked(id, decision, deps)
    } catch (err) {
      deps.logger.error({ err, approvalId: id, decision }, 'Approval resume: bus-driven resume failed')
    }
  }

  return [
    bus.on('autonomy:approval-resolved', async (data) => {
      const payload = data as { approvalId?: number; status?: string }
      if (payload?.status !== 'approved' && payload?.status !== 'rejected') return
      await drive(payload.approvalId, payload.status)
    }),
    bus.on('autonomy:approval-expired', async (data) => {
      const payload = data as { approvalId?: number }
      await drive(payload?.approvalId, 'expired')
    }),
  ]
}

export const agentModule: EyasModule = {
  id: 'agent',
  name: 'Agent Framework',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Agent definitions, execution engine, and tool-use loop orchestration',
  dependencies: ['tools', 'model'],
  // 'event-store' is optional for LOADING but the resume idempotency ledger
  // needs it — resumeRun refuses to resume when it is absent (fail safe).
  optional: ['conversations', 'memory', 'security-gate', 'skills', 'scheduler', 'permissions', 'event-store'],

  async onRegister(ctx: ModuleContext) {
    // Create tables
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS agent_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      description TEXT,
      goal TEXT,
      backstory TEXT,
      tier TEXT NOT NULL DEFAULT 'specialist',
      agent_type TEXT NOT NULL DEFAULT 'assistant',
      system_prompt TEXT,
      capabilities TEXT,
      tools TEXT,
      constraints TEXT,
      model TEXT,
      max_turns INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'seed',
      avatar TEXT,
      tags TEXT,
      monthly_token_budget INTEGER DEFAULT 0,
      tokens_used_month INTEGER DEFAULT 0,
      budget_reset_at TEXT,
      config TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)

    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      turns_used INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      tool_calls TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    )`)

    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS agent_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`)

    // Team sessions, team memory and the F2 T10 durability artifacts (phase
    // cursor + team_phase_results) — idempotent runtime DDL, mirrored in
    // schema.ts and guarded by tests/contracts/team-schema.contract.test.ts.
    ensureTeamSchema(ctx.db)
    ensureGodModeSchema(ctx.db)
    const godModeStore = createGodModeStore(ctx.db)

    // Persisted orchestration events — replay for reloads + board views.
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS orchestration_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      node_id TEXT NOT NULL,
      parent_id TEXT,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_orchestration_events_run ON orchestration_events(run_id, seq)`)

    // Migration: add goal and backstory columns
    try {
      ctx.db.run(sql`ALTER TABLE agent_definitions ADD COLUMN goal TEXT`)
    } catch { /* column already exists */ }
    try {
      ctx.db.run(sql`ALTER TABLE agent_definitions ADD COLUMN backstory TEXT`)
    } catch { /* column already exists */ }
    try {
      ctx.db.run(sql`ALTER TABLE agent_definitions ADD COLUMN tier TEXT NOT NULL DEFAULT 'specialist'`)
    } catch { /* exists */ }
    try {
      ctx.db.run(sql`ALTER TABLE agent_definitions ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'assistant'`)
    } catch { /* exists */ }
    try {
      ctx.db.run(sql`ALTER TABLE agent_definitions ADD COLUMN workspace_path TEXT`)
    } catch { /* exists */ }
    try {
      ctx.db.run(sql`ALTER TABLE agent_definitions ADD COLUMN addressable INTEGER NOT NULL DEFAULT 0`)
    } catch { /* exists */ }
    try {
      ctx.db.run(sql`ALTER TABLE agent_definitions ADD COLUMN effort TEXT`)
    } catch { /* exists */ }

    // Migration: add team_session_id to conversations
    try {
      ctx.db.run(sql`ALTER TABLE conversations ADD COLUMN team_session_id TEXT`)
    } catch { /* column already exists */ }

    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_sessions_conv ON agent_sessions(conversation_id)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent ON agent_sessions(agent_id)`)

    // Run-supervision columns on agent_sessions + the AgentRun CASL subject.
    ensureRunSupervisionSchema(ctx.db)
    // F2 T7 (D8) — plan-as-rubric artifacts (idempotent runtime DDL).
    ensureAgentPlansSchema(ctx.db)
    // Cap 3 keystone — checkpoint store (idempotent; the table is otherwise
    // never created at runtime, leaving warm-resume with nowhere to persist).
    createCheckpointTables(ctx.db)
    try {
      ;(ctx as any).permissions?.registerSubject?.('AgentRun', {
        actions: ['read', 'cancel', 'retry', 'refresh', 'manage'],
        defaults: {
          owner: ['manage'],
          admin: ['manage'],
          user: ['read', 'cancel'],
          agent: [],
          guest: [],
        },
      })
    } catch { /* already registered */ }
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages(session_id)`)

    // Create registry
    const registry = createAgentRegistry(ctx.db)

    // F2 T8 — the budget engine wraps registry.addTokenUsage with threshold-
    // band alert emission (eyas.agent.budget.alert). Every token-tracking
    // call site (conversation-runner, orchestrator, channel-run-agent) routes
    // through it below so the alert actually fires; wireBudgetReset (in
    // onStart) drives its monthly resetAll().
    const budgetEngine = createBudgetEngine({ registry, bus: ctx.bus })

    // Create runner (needs model gateway and tool executor + optional integrations)
    // NOTE: Use lazy getters for optional deps that may not be initialized yet
    // (module loading order: security-gate and skills may register AFTER agent)
    const tools = (ctx as any).tools

    // Cap 3 keystone — checkpoint services, built lazily on first run (by which
    // point the event-store module's onStart has exposed ctx.eventStore, so
    // warm-resume can fold follow-up events). Memoized: the event-store handle
    // is a stable singleton. createCheckpoint itself does not need the event
    // store, so capture works even if the store is absent.
    let checkpointServices: CheckpointServices | null = null
    const getCheckpointServices = (): CheckpointServices => {
      if (!checkpointServices) {
        checkpointServices = createCheckpointServices(ctx.db, {
          eventStore: (ctx as any).eventStore?.events,
          // Capture a clean checkpoint after EVERY tool turn (not every 5) so a
          // short run that did destructive work and failed early still has a
          // lossless resume seed; expand the risky set to all destructive tools.
          policy: { everyTurns: 1, riskyToolNames: DESTRUCTIVE_TOOLS },
        })
      }
      return checkpointServices
    }

    // Lazy gateway: privacy + observability wrap ctx.model during their
    // onStart, which runs AFTER this onRegister. Resolving per call keeps the
    // runner and orchestrator on the fully-wrapped gateway (same lazy pattern
    // as securityGate/eventStore below).
    const lazyGateway = createLazyGateway(() => ctx.model)

    // F2 T7 — verification-before-done deps, shared by EVERY runConversation
    // call site (the retry/refresh routes and the approval resume below, plus
    // the proactive bot-executor, which reads them off ctx.agents). Config is
    // read per access so a `config reload` takes effect without a restart, and
    // the tier resolver is lazy: the decision engine is built in the model
    // module's onStart, long after this onRegister.
    const criticDeps: ConversationCriticDeps = {
      get enabled() { return ctx.config?.agent?.criticEnabled ?? true },
      get maxRounds() { return ctx.config?.agent?.criticMaxRounds ?? 1 },
      gateway: lazyGateway,
      resolveTier: (tier) => {
        try { return (ctx as any).decisionEngine?.resolveForTier(tier) ?? null } catch { return null }
      },
    }

    // P1 — deterministic verify-before-done (lint/test commands from config).
    const verifyDeps = {
      get commands() { return (ctx.config as any)?.agent?.verifyCommands ?? [] },
      get cwd() { return (ctx.config as any)?.agent?.verifyCwd ?? process.cwd() },
    }

    const runner = createAgentRunner({
      gateway: lazyGateway,
      toolExecutor: tools?.executor,
      get securityGate() { return (ctx as any).securityGate ?? undefined },
      // Graduated-autonomy ladder (security-gate exposes it). Only autonomous
      // runs are gated by it; interactive runs are unaffected.
      get autonomyPolicy() { return (ctx as any).securityGate?.autonomyPolicy ?? undefined },
      // Cap 3 keystone — fail-open run-event capture + checkpointing. Lazy:
      // event-store is exposed by a sibling module's onStart, and runs only
      // happen post-onStart, so these resolve to live services at call time.
      get eventStore() { return (ctx as any).eventStore?.events ?? undefined },
      get checkpoint() { return getCheckpointServices().api },
      logger: ctx.logger,
    })

    // Create messaging service for agent-to-agent communication
    const messaging = createAgentMessaging(ctx.db)

    // Create team session service (stores team sessions in DB).
    // Project-scoped findings/decisions go to the project wiki (one truth);
    // projectless sessions still promote to a vault note (P3.14).
    const teamSessionService = createTeamSessionService(ctx.db, {
      onComplete: async (session, entries) => {
        try {
          const runVault = async () => {
            const memoryService = (ctx as any).memory
            if (!memoryService?.vault || !memoryService?.indexer) return null
            const { createTeamSessionPromoter } = await import('../memory/vault/team-session-promoter.js')
            return createTeamSessionPromoter({
              vault: memoryService.vault,
              indexer: memoryService.indexer,
              logger: ctx.logger,
            }).promote(session, entries)
          }

          const auto = (ctx as any).wikiAutoUpdate as {
            promoteTeamSession: (input: {
              projectId: string | null
              session: typeof session
              entries: typeof entries
              vaultPromote: () => { path: string } | null
            }) => 'wiki' | 'vault' | 'none'
          } | undefined

          if (auto) {
            const parent = ctx.conversations?.get(session.parentConversationId)
            let vaultWork: Promise<unknown> | null = null
            auto.promoteTeamSession({
              projectId: parent?.projectId ?? null,
              session,
              entries,
              vaultPromote: () => {
                vaultWork = runVault()
                return null
              },
            })
            if (vaultWork) await vaultWork
            return
          }

          await runVault()
        } catch (err) {
          ctx.logger.debug({ err: String(err) }, 'team session promotion skipped')
        }
      },
      // F2 T10 — where a failed phase-cursor / phase-result write is reported.
      logger: ctx.logger,
    })

    // D14 — shared ownership resolver for team/orchestration resources: the
    // WS topic ACL resolvers registered right below AND the REST replay
    // routes (routes-orchestration.ts, wired in onStart off
    // ctx.agents.orchestrationOwnership) both reuse this one instance rather
    // than each re-implementing the parent-chain walk.
    const orchestrationOwnership = createOrchestrationOwnership({
      ownsConversation: (conversationId, userId) =>
        (ctx as any).conversations?.ownsConversation(conversationId, userId) ?? false,
      getTeamSession: (id) => teamSessionService.get(id),
    })
    ;(ctx as any).wsAcl?.registerResolver('teamEvent', (userId: string, id: string) =>
      orchestrationOwnership.ownsTeamEvent(id, userId))
    ;(ctx as any).wsAcl?.registerResolver('teamProposed', (userId: string, id: string) =>
      orchestrationOwnership.ownsTeamProposed(id, userId))
    ;(ctx as any).wsAcl?.registerResolver('orchestration', (userId: string, id: string) =>
      orchestrationOwnership.ownsOrchestrationRun(id, userId))

    // Run supervisor — agent_sessions lifecycle + stuck detection. Progress
    // is fed by the consumer (per runner event); a leader-gated scheduler tick
    // (registered in onStart) kills stuck runs by aborting their signal.
    // Created here (moved up from below F2 T4) so both the orchestrator and
    // executeAgent can be handed the real instance directly, rather than
    // referencing a `const` that hasn't initialized yet.
    const supervisor = createRunSupervisor({
      db: ctx.db,
      emit: (event, payload) => ctx.bus.emit(event, payload),
      // Cap 3 keystone — feed the real event-store progress signal (sync bridge)
      // so stuck-detection is event-aware, not heartbeat-only. Defensive: -1
      // when the event-store is disabled / its table absent.
      eventSeq: (sid) => latestSeqSync(ctx.db, sid),
    })

    // Create orchestrator (lazy getters for optional deps)
    const orchestrator = createOrchestrator({
      agentRegistry: registry,
      agentRunner: runner,
      gateway: lazyGateway,
      get conversations() { return (ctx as any).conversations },
      get toolRegistry() { return (ctx as any).tools?.registry },
      get toolExecutor() { return (ctx as any).tools?.executor },
      bus: ctx.bus,
      teamSessions: teamSessionService,
      get promptAssembler() { return (ctx as any).promptAssembler },
      // F2 T4 — supervises every team member run (kind='team').
      supervisor,
      // F2 T8 — threshold-band alert emission on token tracking.
      budgetEngine,
      // F2 T9 — config `model.pricing` override, read fresh on every access
      // so a config reload takes effect without a restart.
      get pricingOverrides() { return (ctx.config as any)?.model?.pricing },
      // Task 11 — records what actually reached the model on each member run.
      get contextRecorder() { return (ctx as any).contextRecorder },
    })

    // High-level single-shot agent execution: resolve the agent definition,
    // pick a model/provider, persist the user + assistant turns onto
    // `conversationId`, and return an HONEST result. Used both by
    // delegation (below) and exposed directly on `ctx.agents.executeAgent`
    // for other modules that need to run an agent without the delegation
    // ancestry/depth bookkeeping (e.g. the ticket-to-code pipeline's
    // AgentRunnerPort adapter).
    //
    // F2 T4 (D1) — supervised (kind='delegation': agent_sessions row +
    // checkpoint/event-store capture, same as a team member run). The result
    // no longer fabricates 'Task completed.' when the model produced no
    // text, and a thrown provider error (T1's providers-always-throw
    // contract) is caught here — translated into status:'failed' (surfacing
    // ProviderRunError.partialText when the throw carries one) — rather than
    // propagating, so every caller gets a shapely result to inspect instead
    // of a rejected promise.
    async function executeAgent(
      conversationId: string,
      agentId: string,
      task: string,
      opts?: { origin?: 'pipeline' | 'delegation' },
    ): Promise<{ text: string; status: 'completed' | 'failed' | 'max_turns' | 'parked'; sessionId: string; approvalId?: number }> {
      // Look up agent definition for model/provider/system prompt
      const agent = registry.get(agentId)
      const agentDef = agent ?? { model: undefined, systemPrompt: '', tools: undefined, maxTurns: 10 } as any

      // Hoisted above the model-selection branch so both the provider/model
      // fallback and the team-session threading below share one lookup
      // instead of two separate `convService.get(conversationId)` calls.
      const convService = (ctx as any).conversations
      const conv = convService?.get(conversationId)
      const teamSessionId = conv?.teamSessionId ?? undefined

      // Model selection strategy:
      // 1. Agent has explicit model → use it
      // 2. Child conversation inherited parent's provider/model via createSubConversation → use those
      // 3. Fallback: no provider/model → gateway uses first available provider
      let provider: string | undefined
      let model: string | undefined
      if (agentDef.model) {
        model = agentDef.model
      } else if (conv) {
        provider = conv.providerId ?? undefined
        model = conv.modelId ?? undefined
      }

      const toolDefs = agentDef.tools && agentDef.tools.length > 0
        ? ((ctx as any).tools?.registry?.toToolDefinitions(agentDef.tools) ?? [])
        : ((ctx as any).tools?.registry?.toToolDefinitions() ?? [])

      // Save user message (the delegated task) to child conversation
      if (convService) {
        convService.addMessage(conversationId, { role: 'user', content: task, provider: provider ?? null, model: model ?? null })
      }

      // F0 R4 — executeAgent is always an unattended call (no human directs
      // it): the default 'delegation' origin covers delegate_to_agent /
      // team-orchestrated subagent calls; the pipeline adapter passes
      // 'pipeline' explicitly. Both are autonomous.
      const origin = opts?.origin ?? 'delegation'

      // F2 T4 — supervise this run (kind='delegation'). The handle's
      // sessionId activates the runner's checkpoint + event-store capture;
      // its AbortSignal lets an operator cancel (Mission Control) abort it.
      const sessionId = generateId()
      const handle = supervisor.beginRun({ sessionId, conversationId, agentId, kind: 'delegation' })

      let text = ''
      let turns = 0
      // F2 T9 — rollup source for THIS delegation run (agent_sessions.tokens_used/
      // cost_usd ← finalize, conversations.total_cost_usd ← addRunCost below).
      let tokensUsed = 0
      const costAcc = createCostAccumulator()
      const toolNames: string[] = []
      // D6 — how the loop ended, mirrored from runConversation/orchestrator.
      let outcome: 'max_turns' | 'tool_budget' | undefined
      // Fix round 1 / Critical 1 — an aborted/stuck run (operator cancel, or
      // now automatically the scheduled stuck sweep) makes the runner yield
      // 'cancelled' and return normally (no throw), so the loop below has to
      // observe it itself — otherwise this reads as a normal 'completed' run.
      let cancelled = false
      // F2 T5 — the run stopped on an escalation: it is parked on this
      // approval, not finished. Neither complete() nor fail() may run.
      let parkedApprovalId: number | undefined

      try {
        // F0 — executeAgent now goes through the assembler. The agent
        // definition's own prompt is APPENDED, never replaced, so an agent
        // whose persona lives only in the DB is unaffected.
        const delegated = await buildDelegatedSystemPrompt({
          assembler: (ctx as any).promptAssembler,
          agentId,
          conversationId,
          projectId: conv?.projectId ?? null,
          agentSystemPrompt: agentDef.systemPrompt,
        })
        const compositionId = (ctx as any).contextRecorder?.record({
          sections: delegated.sections,
          entryPoint: delegated.entryPoint === 'assembled' ? 'delegated' : 'unassembled',
          assemblerError: delegated.assemblerError,
          conversationId,
          agentId,
          provider,
          model,
        }) ?? null

        const result = runner.run({
          messages: [{ role: 'user', content: task }],
          tools: toolDefs,
          system: delegated.system,
          maxTurns: agentDef.maxTurns ?? 10,
          provider,
          model,
          conversationId,
          autonomous: true,
          // The executor authorizes every tool call against the context's actor
          // (F0 R2), and agent-runner only builds one when a toolContext exists —
          // without this, every delegated / pipeline tool call is denied.
          // teamSessionId/sessionId (R7): inside a team run the team session IS
          // the messaging session — the agent-messaging tools key on ctx.sessionId.
          toolContext: { conversationId, projectId: conv?.projectId ?? null, userId: 'system', agentId, logger: ctx.logger, teamSessionId, sessionId: teamSessionId, agentRole: agentDef.role, ...toolWorkspaceFields(conv?.workingDirectories) },
          metadata: { conversationId, agentId, origin, autonomous: true, teamSessionId, compositionId: compositionId ?? undefined },
          signal: handle.signal,
          sessionId: handle.sessionId,
        })
        for await (const event of result) {
          if (event.type === 'text') text += (event as any).text
          if (event.type === 'tool_use_start') toolNames.push((event as any).name)
          if (event.type === 'turn_complete') {
            turns++
            tokensUsed += (event as any).tokensUsed ?? 0
            costAcc.addTurn((event as any).usage ?? { inputTokens: 0, outputTokens: 0 })
          }
          if (event.type === 'max_turns_reached') outcome = 'max_turns'
          if (event.type === 'tool_budget_exhausted') outcome = 'tool_budget'
          if (event.type === 'cancelled') cancelled = true
          if (event.type === 'parked_for_approval') parkedApprovalId = (event as any).approvalId
          handle.progress()
        }

        // Save whatever the run produced before it stopped, either way.
        const persistText = () => {
          if (convService && text) {
            convService.addMessage(conversationId, { role: 'assistant', content: text, provider: provider ?? null, model: model ?? null })
          }
        }

        // F2 T5 — park the delegated/pipeline run instead of finalizing it.
        // The row stays 'waiting_approval' (no completed_at) so Task 6 can
        // resume THIS session once the operator decides. park() refuses a row
        // that is no longer 'running'; only then is 'parked' the truth — a
        // refused park leaves nothing to resume, so the caller is told the run
        // failed rather than being sent to wait on a run that will never wake.
        if (parkedApprovalId !== undefined) {
          if (supervisor.park(sessionId, parkedApprovalId)) {
            persistText()
            ctx.logger.info({ sessionId, agentId, conversationId, approvalId: parkedApprovalId }, 'executeAgent: run parked for approval')
            return { text, status: 'parked', sessionId, approvalId: parkedApprovalId }
          }
          const costUsd = costAcc.finalize(provider, model, (ctx.config as any)?.model?.pricing)
          handle.complete({ toolCalls: toolNames, turns, outcome, tokensUsed, costUsd })
          convService?.addRunCost?.(conversationId, { tokens: tokensUsed, costUsd })
          persistText()
          ctx.logger.warn({ sessionId, agentId, conversationId, approvalId: parkedApprovalId }, 'executeAgent: run stopped on an escalation but could not be parked')
          return { text, status: 'failed', sessionId, approvalId: parkedApprovalId }
        }

        const costUsd = costAcc.finalize(provider, model, (ctx.config as any)?.model?.pricing)
        handle.complete({ toolCalls: toolNames, turns, outcome, tokensUsed, costUsd })
        convService?.addRunCost?.(conversationId, { tokens: tokensUsed, costUsd })

        // Save assistant response to child conversation
        persistText()

        // Cancelled takes priority: the run did not deliver a finished
        // result, so it must not read as 'completed' just because the loop
        // ended without throwing.
        const status: 'completed' | 'failed' | 'max_turns' = cancelled
          ? 'failed'
          : outcome === 'max_turns'
            ? 'max_turns'
            : 'completed'
        return { text, status, sessionId }
      } catch (err: any) {
        handle.fail(String(err?.message ?? err))
        // Fix round 1 / Important 3 — this used to swallow the error
        // silently (handle.fail() records it on the row, but nothing was
        // logged); conversation-runner.ts's equivalent catch path always
        // logs, so this brings executeAgent in line with it.
        ctx.logger.error({ err, sessionId, agentId, conversationId }, 'executeAgent: run failed')
        // A ProviderRunError (T1) carries whatever the model produced before
        // the provider gave up — prefer it over the partial `text` streamed
        // through this loop (which is empty for providers that only surface
        // an answer at the very end, e.g. the Claude Code SDK).
        const partial = typeof err?.partialText === 'string' && err.partialText ? err.partialText : text
        if (convService && partial) {
          convService.addMessage(conversationId, { role: 'assistant', content: partial, provider: provider ?? null, model: model ?? null })
        }
        return { text: partial, status: 'failed', sessionId }
      }
    }

    // Create delegation service (lazy conversations access — may not be ready yet)
    const delegation = createDelegationService({
      maxDepth: 5,
      getAncestry(conversationId: string) {
        const convService = (ctx as any).conversations
        if (!convService) return []
        return convService.getAncestry(conversationId).map((c: any) => ({ agentId: c.agentId }))
      },
      createChildConversation(parentId: string, agentId: string, task: string) {
        const convService = (ctx as any).conversations
        if (!convService) throw new Error('Conversations module not available for delegation')
        const child = convService.createSubConversation({
          title: task.slice(0, 100),
          goalDescription: task,
          parentConversationId: parentId,
          agentId,
        })
        // Emit on eyas.conversation.* namespace so ws-bridge picks it up
        ctx.bus.emit('eyas.conversation.sub_created', {
          conversationId: parentId,
          childConversationId: child.id,
          agentId,
          task,
        })
        return child.id
      },
      runTransaction<T>(fn: () => T): T {
        // ctx.db is a drizzle instance. Drizzle's sync transaction() runs the
        // callback immediately and returns its result — it does NOT return a
        // wrapper function. An earlier version of this helper called `fn()`
        // a second time on the "wrapped is not a function" branch, which
        // caused delegate_to_agent to create two child conversations per
        // delegation. The current shape handles both the sync-immediate and
        // sync-wrapper returns without a double-invocation path.
        const t = (ctx.db as any).transaction
        if (typeof t !== 'function') {
          return fn()
        }
        try {
          const result = t.call(ctx.db, fn) as T | (() => T)
          if (typeof result === 'function') {
            // better-sqlite3 style: transaction(fn) returns a function to call
            return (result as () => T)()
          }
          // drizzle/bun-sqlite style: transaction(fn) ran fn immediately and
          // returned its value.
          return result as T
        } catch (err) {
          // If the transaction itself threw before fn ran (e.g. driver
          // unsupported shape), fall back to a plain call — but only once.
          if ((err as any)?.__fnAlreadyRan) throw err
          return fn()
        }
      },
      executeAgent,
    })

    ;(ctx as any).agents = { registry, runner, messaging, orchestrator, teamSessions: teamSessionService, delegation, supervisor, getCheckpoint: getCheckpointServices, executeAgent, critic: criticDeps, verify: verifyDeps, budgetEngine, orchestrationOwnership, godMode: godModeStore }

    // Mission Control reads live runs through this port. Publishing it here
    // (rather than leaving mission-control on its empty fallback registry) is
    // what makes the dashboard show real sessions.
    ;(ctx as any).agentRegistry = createAgentSessionRegistryAdapter({
      db: ctx.db,
      supervisor,
      agents: registry,
    })

    // F2 T9 (R8) — real daily stats (mission-control's getStats() falls back
    // to a hardwired ()=>0 stub without this). Published here, same timing as
    // agentRegistry above, so it's available before mission-control's onStart
    // reads it.
    ;(ctx as any).agentDailyStats = createAgentDailyStats(ctx.db)

    const wsBroadcast = createLazyWsBroadcast(ctx)

    // Register delegate_to_agent tool in the tools registry.
    // This runs AFTER the tools module's own registerBuiltins(), which only
    // sees `ctx.agents` as undefined because tools.onRegister runs before us
    // (tools has no hard deps, agent depends on tools). Anything that needs
    // agent services must be registered from here.
    const toolsCtx = (ctx as any).tools as { registry?: any } | undefined
    if (toolsCtx?.registry) {
      const { createDelegateTool } = await import('@modules/tools/builtin/delegate-tool.js')
      for (const t of createDelegateTool(delegation, registry)) toolsCtx.registry.register(t)

      // assign_task — the ASYNC counterpart of delegate_to_agent. Board and
      // conversations resolve lazily: both modules' onRegister may not have run
      // when this one does, so capturing them here would freeze `undefined`.
      const { createAssignTaskTool } = await import('@modules/tools/builtin/assign-task-tool.js')
      for (const t of createAssignTaskTool({
        getConversations: () => (ctx as any).conversations,
        getStages: () => (ctx as any).board?.stages,
        registry,
        bus: ctx.bus,
      })) toolsCtx.registry.register(t)

      // Team tools: write_team_memory / read_team_memory + propose_team
      const { createTeamTools, createProposeTeamTool } = await import('@modules/tools/builtin/team-tools.js')
      for (const t of createTeamTools(teamSessionService, wsBroadcast)) toolsCtx.registry.register(t)
      for (const t of createProposeTeamTool(orchestrator, teamSessionService, ctx.bus, wsBroadcast)) toolsCtx.registry.register(t)

      // Agent messaging tools (post_to_agent, read_agent_messages, etc.)
      const { createAgentMessagingTools } = await import('@modules/tools/builtin/agent-messaging-tools.js')
      for (const t of createAgentMessagingTools(messaging)) toolsCtx.registry.register(t)

      // propose_agent_creation — spin up draft agent_definitions for user approval
      const { createProposeAgentTool } = await import('@modules/tools/builtin/propose-agent-tool.js')
      for (const t of createProposeAgentTool(ctx.db, ctx.bus)) toolsCtx.registry.register(t)

      ctx.logger.info('Agent module: delegate + team + messaging + propose_agent tools registered')

    // Bring seeded agents up to the tool set their template grants today. New
    // tools otherwise never reach an agent that already exists — see
    // agent-tool-reconcile.ts for how the design tools reached nobody.
    try {
      const { reconcileAgentTools } = await import('./agent-tool-reconcile.js')
      const { PRIOR_TOOLSETS } = await import('./agent-templates.js')
      const upgraded = reconcileAgentTools(ctx.db, PRIOR_TOOLSETS, ctx.logger)
      if (upgraded > 0) ctx.logger.info({ upgraded }, 'Agent tool allow-lists reconciled')
    } catch (err) {
      ctx.logger.warn({ err: String(err) }, 'Agent tool reconcile unavailable')
    }
    }

    // Phase 6 self-edit tools register in onStart — they need workspaceLoader,
    // notifications, and internalContactsRegistry from sibling modules whose
    // onRegister order is not guaranteed by `dependencies`.

    ctx.logger.info('Agent module registered')
  },

  async onStart(ctx: ModuleContext) {
    await registerPhase6Tools(ctx)


    // Sweep up any agent worktrees left behind by a previous run that died
    // without hitting its finally-block (SIGKILL, OOM, host crash). Safe on
    // non-repos and reruns — it's idempotent.
    try {
      const result = gcOrphanedWorktrees(process.cwd())
      if (result.pruned || result.branchesDeleted > 0) {
        ctx.logger.info(
          `Agent worktree GC: pruned=${result.pruned} branchesDeleted=${result.branchesDeleted}`,
        )
      }
    } catch (err) {
      ctx.logger.warn({ err }, 'Agent worktree GC failed — continuing startup')
    }

    const { createAgentRoutes } = await import('./routes.js')
    createAgentRoutes(ctx.http, (ctx as any).agents.registry, { db: ctx.db, dataDir: (ctx.config as any)?.dataDir ?? 'data' })

    // Markdown personas from instance directories. File contents overlay an
    // existing id (template or prior import); isolation stays on — this is
    // how host agent files reach the Agents page without settingSources.
    const { importPersonasFromDirectory, resolvePersonaImportRoots } = await import('./persona-import.js')
    const personaRoots = resolvePersonaImportRoots(ctx.config)
    for (const dir of personaRoots) {
      try {
        const imported = await importPersonasFromDirectory((ctx as any).agents.registry, dir)
        if (imported > 0) {
          ctx.logger.info({ dir, imported }, 'Imported personas from markdown')
        }
      } catch (err) {
        ctx.logger.warn({ err, dir }, 'Persona import failed — continuing startup')
      }
    }

    // Run supervision: cancel/list/retry routes + a leader-gated stuck-detection sweep.
    const agents = (ctx as any).agents
    const supervisor = agents.supervisor
    const { createRunSupervisionRoutes } = await import('./run-routes.js')
    const runDeps = {
      db: ctx.db,
      agentRunner: agents.runner,
      agentRegistry: agents.registry,
      toolRegistry: (ctx as any).tools?.registry,
      supervisor: agents.supervisor,
      logger: ctx.logger,
      promptAssembler: (ctx as any).promptAssembler,
      // F2 T7 — the completeness critic (and the feedback resume it can start).
      // eventStore stays a getter: the event-store module exposes it in its own
      // onStart, which may run after this one.
      critic: agents.critic,
      verify: agents.verify,
      get eventStore() { return (ctx as any).eventStore?.events },
      getCheckpoint: agents.getCheckpoint,
      // F2 T8 — threshold-band alert emission on token tracking.
      budgetEngine: agents.budgetEngine,
      // F2 T9 — config `model.pricing` override for the cost rollup.
      get pricingOverrides() { return (ctx.config as any)?.model?.pricing },
      // Task 11 — records what actually reached the model on each resumed run.
      // Lazy: observability may register after this module.
      get contextRecorder() { return (ctx as any).contextRecorder },
      // F7 — attached designs on the background path. Lazy for the same reason
      // as the rest: the design module publishes this in its own onRegister.
      getDesigns: () => (ctx as any).designs,
      // …and the documents service, so what a background run writes ends up
      // findable rather than only on disk.
      getDocuments: () => (ctx as any).documents,
      // F1 — durable-memory capture on the background path. Resolved per call:
      // the memory module publishes this in its own onStart, which may run
      // after this one, and a build without it simply captures nothing.
      memoryCapture: (input: import('@modules/memory/capture/index.js').CaptureInput) =>
        (ctx as any).memoryCapture?.(input) ?? Promise.resolve(),
    }
    // F2 T6 — everything that drives a PARKED run (bus subscribers, the hourly
    // sweep, the cancel escape hatch) shares one dependency bundle. The
    // autonomy policy is resolved lazily: security-gate is an optional module
    // and may register after this one.
    const approvalResumeDeps: ApprovalResumeDeps = {
      db: ctx.db,
      get autonomyPolicy() { return (ctx as any).securityGate?.autonomyPolicy },
      supervisor,
      resumeRun: (runId: string, opts) => resumeRun(runId, {
        ...runDeps,
        eventStore: (ctx as any).eventStore?.events,
        getCheckpoint: agents.getCheckpoint,
      }, opts),
      logger: ctx.logger,
    }

    createRunSupervisionRoutes(ctx.http, supervisor, ctx.db, {
      // Both retry (seedFromCheckpoint:false → re-plan from goal) and refresh
      // (default → lossless checkpoint resume) route through resumeRun, which
      // arms the destructive idempotency ledger + do-not-repeat recap EITHER
      // way. The re-run goes through the runner loop → security gate per tool.
      resumeRun: (runId: string, opts?: { seedFromCheckpoint?: boolean }) => resumeRun(runId, {
        ...runDeps,
        eventStore: (ctx as any).eventStore?.events,
        getCheckpoint: agents.getCheckpoint,
      }, opts),
      // A parked run has no live loop to abort, so cancelling one is a
      // separate, guarded transition (+ rejecting the approval it waits on).
      cancelParked: (runId: string, actor: string) => cancelParkedRun(runId, actor, approvalResumeDeps),
    })

    // The operator's decision (and the TTL expiry) is what wakes a parked run.
    if (ctx.hasModule('security-gate')) {
      wireApprovalResume(ctx.bus, approvalResumeDeps)
    } else {
      ctx.logger.warn('Approval resume wiring skipped: security-gate module not loaded — parked runs cannot be resumed')
    }

    // Crash recovery: any agent_sessions row still 'running' on boot is an
    // orphan from a previous process that died mid-run — mark it failed.
    try {
      const recovered = supervisor.recoverOrphans()
      if (recovered > 0) ctx.logger.info(`Run supervisor: recovered ${recovered} orphaned run(s) from a previous crash`)
    } catch (err) {
      ctx.logger.warn({ err }, 'Run supervisor: orphan recovery failed')
    }
    if (ctx.hasModule('scheduler')) {
      const scheduler = (ctx as any).scheduler
      scheduler.registerHandler('agent.run.supervisor.tick', () => { supervisor.tick() })
      if (!scheduler.list().some((j: any) => j.handler === 'agent.run.supervisor.tick')) {
        scheduler.create({
          name: 'Agent Run Supervisor',
          description: 'Detect and cancel stuck agent runs',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '* * * * *' }),
          handler: 'agent.run.supervisor.tick',
        })
      }

      // F2 T8 — the durable half of auto-retry. run-supervisor's fail()
      // schedules next_attempt_at on a BACKGROUND run that failed with a
      // retryable error_kind and is still under the retry budget; nothing
      // else polls that column, so this minutely sweep is what actually
      // drives it.
      scheduler.registerHandler('agent.run.retry.sweep', async () => {
        await sweepRetries({
          db: ctx.db,
          resumeRun: (runId: string, opts) => resumeRun(runId, {
            ...runDeps,
            eventStore: (ctx as any).eventStore?.events,
            getCheckpoint: agents.getCheckpoint,
          }, opts),
          logger: ctx.logger,
        })
      })
      if (!scheduler.list().some((j: any) => j.handler === 'agent.run.retry.sweep')) {
        scheduler.create({
          name: 'Agent Auto-Retry Sweep',
          description: 'Warm-resume background runs scheduled for auto-retry after a retryable failure',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '* * * * *' }),
          handler: 'agent.run.retry.sweep',
        })
      }

      // F2 T6 (S3) — the durable half of the resume trigger. The bus
      // subscription only fires while THIS process is up and listening; the
      // sweep covers a decision made during a restart, an event nobody was
      // subscribed for, a resume that refused, and a claim whose owner died.
      // Skipped without security-gate: the approvals table it scans is that
      // module's, so the job would only log a failed query every hour.
      if (ctx.hasModule('security-gate')) {
        scheduler.registerHandler('agent.approval.resume.sweep', async () => {
          await sweepApprovalResumes(approvalResumeDeps)
        })
        if (!scheduler.list().some((j: any) => j.handler === 'agent.approval.resume.sweep')) {
          scheduler.create({
            name: 'Parked Run Resume Sweep',
            description: 'Resume runs parked on an approval that has since been decided or expired',
            triggerType: 'cron',
            triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
            handler: 'agent.approval.resume.sweep',
          })
        }
      }

      // God Mode workspace retention: GC only (never fail in-flight runs).
      scheduler.registerHandler('agent.god-mode.gc', async () => {
        try {
          const { sweepGodModeWorkspaces } = await import('./god-mode/boot.js')
          sweepGodModeWorkspaces(ctx.db, agents.godMode)
        } catch (err) {
          ctx.logger.warn({ err }, 'God Mode workspace GC failed')
        }
      })
      if (!scheduler.list().some((j: any) => j.handler === 'agent.god-mode.gc')) {
        scheduler.create({
          name: 'God Mode Workspace GC',
          description: 'Prune expired God Mode worktrees after retention',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
          handler: 'agent.god-mode.gc',
        })
      }
    }

    // Register workspace routes if prompt-wizard services are available
    await registerWorkspaceRoutes(ctx)

    // Register agent memory routes if memory module is available
    const memoryService = (ctx as any).memory
    if (memoryService) {
      const { createAgentMemoryRoutes } = await import('./routes-memory.js')
      createAgentMemoryRoutes(ctx.http, {
        episodicMemory: memoryService.episodic,
        workingMemory: memoryService.working,
      })
      ctx.logger.info('Agent memory routes registered')
    }

    // Register team session routes under /api/v1
    const { createTeamRoutes } = await import('./routes-team.js')
    const { createOrchestrationBroadcaster } = await import('./orchestration-broadcaster.js')
    const { createOrchestrationEventService } = await import('./orchestration-event-service.js')
    const { createOrchestrationRoutes } = await import('./routes-orchestration.js')
    const { Hono } = await import('hono')
    const teamApi = new Hono()
    const wsBroadcast = createLazyWsBroadcast(ctx)
    const orchestrationBroadcaster = createOrchestrationBroadcaster({ broadcast: wsBroadcast })
    // Persisting sink (drop-in broadcaster): live WS + replayable history.
    // Exposed on ctx so the CLI provider manifests use the same sink.
    const orchestrationEvents = createOrchestrationEventService({
      db: ctx.db,
      broadcaster: orchestrationBroadcaster,
      logger: ctx.logger,
    })
    orchestrationEvents.pruneOlderThan(ORCHESTRATION_EVENT_RETENTION_MS)
    ;(ctx as any).orchestration = orchestrationEvents
    createTeamRoutes(teamApi, (ctx as any).agents.teamSessions, (ctx as any).agents.orchestrator, (ctx as any).conversations, ctx.bus, orchestrationEvents, wsBroadcast, ctx.logger)
    createOrchestrationRoutes(teamApi, orchestrationEvents, (ctx as any).agents.orchestrationOwnership)
    ctx.http.route('/api/v1', teamApi)
    ctx.logger.info('Team session + orchestration routes registered')

    const {
      createGodModeRoutes,
      collectGodModeLiveKeys,
      createGodModeOrchestrator,
    } = await import('./god-mode/index.js')
    const { bootGodMode } = await import('./god-mode/boot.js')
    const godModeStore = (ctx as any).agents.godMode
    try {
      const boot = bootGodMode(ctx.db, {
        retentionHours: godModeStore.getConfig().workspaceRetentionHours,
      })
      if (boot.failed > 0 || boot.gcRemoved > 0) {
        ctx.logger.info(boot, 'God Mode boot: in-flight runs failed + workspace GC')
      }
    } catch (err) {
      ctx.logger.warn({ err }, 'God Mode boot recovery failed')
    }

    const conversations = (ctx as any).conversations
    const godModeOrchestrator = conversations
      ? createGodModeOrchestrator({
          store: godModeStore,
          conversations,
          runConversation,
          runConversationDeps: runDeps,
          gateway: createLazyGateway(() => ctx.model),
          logger: ctx.logger,
        })
      : undefined
    if (godModeOrchestrator) {
      ;(ctx as any).agents.godModeOrchestrator = godModeOrchestrator
      // Conversations routes resolve this lazily (module start order is not guaranteed).
      ;(ctx as any).godMode = godModeOrchestrator
    }

    createGodModeRoutes(ctx.http, godModeStore, {
      getLimits: () => ({
        min: ctx.config.agent?.godModeMinParticipants ?? 2,
        max: ctx.config.agent?.godModeMaxParticipants ?? 5,
      }),
      getLiveKeys: () => collectGodModeLiveKeys(ctx as any),
      conversations,
      orchestrator: godModeOrchestrator,
      getPricing: () => (ctx.config as any)?.model?.pricing,
    })
    ctx.logger.info('God Mode config + run routes registered')

    wireBudgetReset({ bus: ctx.bus, budgetEngine: agents.budgetEngine, logger: ctx.logger })

    // F2 T8 — boot recovery: warm-resume restart-orphaned background runs
    // with a checkpoint, and release conversations left 'working' by a run
    // nobody is driving any more. main.ts / serve.ts call this AFTER WS
    // wiring so any resumed run's progress/terminal frames have somewhere to
    // broadcast to. Wrapped so a throw here can never abort startup — the
    // hook itself is already error-isolated internally (see boot-recovery.ts).
    // F2 T10 — the same deps the routes drive a team session with, so a boot
    // re-drive broadcasts and persists exactly like a user-started one.
    const teamDriverDeps: TeamDriverDeps = {
      teamSessions: (ctx as any).agents.teamSessions,
      orchestrator: (ctx as any).agents.orchestrator,
      bus: ctx.bus,
      broadcaster: orchestrationEvents,
      wsBroadcast,
      logger: ctx.logger,
    }

    ;(ctx as any).agentPostBoot = async (): Promise<void> => {
      try {
        const result = await runAgentPostBoot({
          db: ctx.db,
          resumeRun: (runId: string, opts) => resumeRun(runId, {
            ...runDeps,
            eventStore: (ctx as any).eventStore?.events,
            getCheckpoint: agents.getCheckpoint,
          }, opts),
          getCheckpoint: agents.getCheckpoint,
          // Team sessions a crash left mid-phase: re-driven from their cursor.
          reviveTeamSessions: () => reviveTeamSessions(teamDriverDeps),
          logger: ctx.logger,
        })
        if (result.warmResumed > 0 || result.conversationsReleased > 0 || result.teamSessionsRevived > 0) {
          ctx.logger.info(result, 'Agent boot recovery complete')
        }
      } catch (err) {
        ctx.logger.warn({ err }, 'Agent boot recovery failed')
      }
    }

    ctx.logger.info('Agent module started')
  },

  async onStop() {},
}

// ─── Workspace HTTP routes wiring ─────────────────────

async function registerWorkspaceRoutes(ctx: ModuleContext): Promise<void> {
  const wsLoader = (ctx as any).workspaceLoader
  const wsWriter = (ctx as any).workspaceWriter
  const soulPipeline = (ctx as any).soulPipeline
  const registry = (ctx as any).agents?.registry
  const dataDir: string = (ctx.config as any).dataDir ?? process.cwd()

  if (!wsLoader || !wsWriter || !soulPipeline || !registry) {
    ctx.logger.warn(
      'Agent workspace routes skipped: workspaceLoader/workspaceWriter/soulPipeline/registry not wired ' +
        '(prompt-wizard module missing or loaded after agent?)',
    )
    return
  }

  const { createAgentWorkspaceRoutes } = await import('./routes-workspace.js')
  createAgentWorkspaceRoutes(ctx.http, {
    workspaceLoader: wsLoader,
    workspaceWriter: wsWriter,
    soulPipeline,
    registry,
    dataDir,
  })
  ctx.logger.info('Agent workspace routes registered')
}

// ─── Phase 6 self-edit tool wiring ─────────────────────

async function registerPhase6Tools(ctx: ModuleContext): Promise<void> {
  const toolsCtx = (ctx as any).tools as { registry?: any } | undefined
  const wsLoader = (ctx as any).workspaceLoader
  const wsWriter = (ctx as any).workspaceWriter
  const auditService = (ctx as any).audit
  const notifications = (ctx as any).notifications
  const internalContacts = (ctx as any).internalContactsRegistry
  const registry = (ctx as any).agents?.registry

  if (!toolsCtx?.registry) {
    ctx.logger.warn('Phase 6 tools skipped: tool registry unavailable')
    return
  }
  if (!wsLoader || !wsWriter) {
    ctx.logger.warn('Phase 6 tools skipped: workspace loader/writer not wired (prompt-wizard module missing?)')
    return
  }
  if (!auditService) {
    ctx.logger.warn('Phase 6 tools skipped: audit service not wired')
    return
  }

  const { wrapAgentTool } = await import('./tools/wrap-agent-tool.js')
  const { createWorkspaceAppendTool } = await import('./tools/workspace-append-tool.js')
  const { createWorkspaceEditTool } = await import('./tools/workspace-edit-tool.js')
  const { createWorkspaceUpdateIdentityTool } = await import('./tools/workspace-update-identity-tool.js')
  const { createIdentityUpdateRateLimit } = await import('./tools/identity-update-rate-limit.js')
  const { createAddInternalContactTool } = await import('./tools/add-internal-contact-tool.js')
  const { createOwnerUserIdResolver } = await import('@modules/auth/owner-lookup')

  // The audit service exposes a sync log() that returns the inserted row;
  // tool factories expect Promise<void>, so wrap it.
  const auditAsync = async (entry: { agentId: string; action: string; [k: string]: unknown }) => {
    auditService.log(entry as never)
  }
  const ownerUserId = createOwnerUserIdResolver(ctx.db)

  toolsCtx.registry.register(
    wrapAgentTool(
      createWorkspaceAppendTool({ loader: wsLoader, writer: wsWriter, audit: auditAsync }),
      { category: 'agent', riskTier: 'yellow' },
    ),
  )
  toolsCtx.registry.register(
    wrapAgentTool(
      createWorkspaceEditTool({ loader: wsLoader, writer: wsWriter, audit: auditAsync }),
      { category: 'agent', riskTier: 'yellow' },
    ),
  )

  if (notifications && registry) {
    toolsCtx.registry.register(
      wrapAgentTool(
        createWorkspaceUpdateIdentityTool({
          loader: wsLoader,
          writer: wsWriter,
          notifications,
          audit: auditAsync,
          identitySelfUpdateEnabled: () => ctx.config.autonomy.identitySelfUpdate,
          ownerUserId,
          agentName: async (id: string) => registry.get(id)?.name ?? 'Unknown',
          rateLimit: createIdentityUpdateRateLimit(),
        }),
        { category: 'agent', riskTier: 'red' },
      ),
    )

    if (internalContacts) {
      toolsCtx.registry.register(
        wrapAgentTool(
          createAddInternalContactTool({
            registry: internalContacts,
            ownerUserId,
            ownerConfirm: async (input) => {
              return await notifications.requestConfirmation({
                userId: ownerUserId(),
                title: `Add ${input.displayName} as internal contact?`,
                body: `Identifier: ${input.identifier}`,
                timeoutMs: 5 * 60_000,
              })
            },
          }),
          { category: 'agent', riskTier: 'red', requiresApproval: true },
        ),
      )
    } else {
      ctx.logger.warn('add_internal_contact skipped: internalContactsRegistry not wired')
    }
  } else {
    ctx.logger.warn('Identity + contact tools skipped: notifications or agent registry not wired')
  }

  ctx.logger.info('Agent module: Phase 6 self-edit tools registered')
}

// ─── Public API re-exports ─────────────────────
// Exposed so external callers (custom orchestrators, higher-level agent
// templates, future routes) can build on the Phase-3E/3F/3G primitives
// without reaching into subpaths.

// Phase 3F — approval-tier policy
export {
  createApprovalTierPolicy,
  DEFAULT_APPROVAL_CONFIG,
} from '@modules/security-gate/approval-tiers.js'
export type {
  ApprovalMode,
  ApprovalTierConfig,
  ApprovalDecision,
  ApprovalContext,
  ApprovalTierPolicy,
} from '@modules/security-gate/approval-tiers.js'

// Phase 3E — interactive planning
export {
  PlanSchema,
  PlanStepSchema,
  PlanRiskSchema,
  detectComplexity,
  generatePlan,
  approvePlan,
  rejectPlan,
  markPlanInProgress,
  markStepStatus,
} from './planning.js'
export type {
  Plan,
  PlanStep,
  PlanRisk,
  ComplexitySignals,
  GeneratePlanInput,
  GeneratePlanResult,
  PlanGeneratorOptions,
} from './planning.js'
export { maybePlanTask } from './planning-runner.js'
export type {
  PlanningHookOptions,
  PlanningDecision,
} from './planning-runner.js'

// Phase 3G — Flow runner (deterministic Zod-typed DAG)
export {
  buildFlow,
  defineNode,
  FlowBuildError,
} from './flow.js'
export type {
  FlowDefinition,
  FlowNode,
  FlowEdge,
  FlowEdgeMap,
  FlowContext,
  FlowRunResult,
  FlowRunStatus,
  FlowRunError,
} from './flow.js'
