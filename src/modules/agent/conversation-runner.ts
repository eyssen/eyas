// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import { classifyModelError } from '@shared/classify-model-error.js'
import { createCostAccumulator, type PricingTable } from '@shared/model-pricing.js'
import type { ModelGateway, ModelMessage } from '@modules/model/types.js'
import type { EventStore } from '@modules/event-store/event-store.js'
import type { CheckpointAPI } from './checkpoint/index.js'
import { buildTaskStateReinjection, type DoneToolCall } from './task-state-reinjection.js'
import { runCritic, isRetrievalTool, type CriticPlanStep, type CriticTier } from './critic.js'
import { maybePlanTask } from './planning-runner.js'
import {
  latestPlanForConversation,
  savePlan,
  planStepsForCritic,
  buildPlanRubricSection,
} from './plan-store.js'
// Pure helpers shared with the interactive chat route so a background run
// resolves its settings exactly as the foreground one does (precedent for a
// runtime cross-module import: the proactive bot-executor imports runConversation).
import { resolveThinkingAndEffort } from '@modules/conversations/thinking-resolver.js'
import { buildOrchestrationDirective } from '@modules/conversations/orchestration-directive.js'
import { addRunCost } from '@modules/conversations/conversation-service.js'
import { runVerifyCommands, type VerifyCommand } from './verify-commands.js'
import { parseWorkingDirectories, toolWorkspaceFields } from '@modules/tools/working-directories.js'
import { estimateTokens } from '@modules/prompt-wizard/token-budget.js'
import { DESIGN_SECTION_KEY } from '@modules/design/design-context.js'
import type { ContextRecorder } from '@modules/observability/context-recorder.js'

/**
 * F2 T7 (D7/D8) — everything the verification-before-done pass needs. Absent
 * (or `enabled: false`) leaves a run un-critic'd: it completes exactly as
 * before and its `verification` column stays NULL.
 */
export interface ConversationCriticDeps {
  /** config `agent.criticEnabled` (default true). Also gates plan-as-rubric. */
  enabled?: boolean
  /** config `agent.criticMaxRounds` (default 1) — feedback resumes per lineage. */
  maxRounds?: number
  /** Lazy gateway (privacy + tracing wrappers), same one the runner uses. */
  gateway: ModelGateway
  /** Routing-tier resolver — the critic ladders heartbeat → quick → default. */
  resolveTier?: (tier: CriticTier) => { provider: string; model: string } | null

}

/** F7 — the design service, so an attached canvas reaches a background run. */
export type GetDesigns = () => import('@modules/design/design-service.js').DesignService | undefined

/** P1 — deterministic project checks after the agent finishes. */
export interface ConversationVerifyDeps {
  commands: VerifyCommand[]
  cwd?: string
}

/**
 * runConversation — the single supervised "run one conversation through the
 * agent runner" unit. Extracted from the proactive bot-executor so the same
 * code path backs both autonomous background execution AND the
 * POST /agent/runs/:id/retry route.
 *
 * SECURITY INVARIANT: re-running goes through agentRunner.run(), so the
 * security gate + graduated-autonomy ladder fire per tool call exactly as on
 * the original run. A retry can never bypass the gate (that would be a
 * privilege escalation). The conversation's persisted goal IS the state the
 * fresh run restarts from; warm-resume from a checkpoint is a separate path.
 */
export interface ConversationRunnerDeps {
  db: any
  agentRunner: any
  agentRegistry: any
  toolRegistry: any
  supervisor?: any
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void; debug?: (m: string) => void }
  /** Override the session-id generator (tests). Defaults to shared generateId. */
  generateId?: () => string
  promptAssembler?: import('@modules/prompt-wizard/assembler').PromptAssembler
  /**
   * F2 T7 — the critic's transcript source AND the feedback resume's ledger
   * source. Absent leaves a finished run 'unverified': there is no record of
   * what it produced, so there is nothing to judge.
   */
  eventStore?: EventStore
  /** F2 T7 — needed by the feedback resume (lossless checkpoint seed). */
  getCheckpoint?: () => { api: CheckpointAPI }
  critic?: ConversationCriticDeps
  /**
   * P1 — shell-free verify commands (lint/test). Runs after a successful agent
   * loop and before the LLM critic; failures feed the same feedback resume path.
   */
  verify?: ConversationVerifyDeps
  /**
   * F2 T8 — routes token tracking through the budget engine (threshold-band
   * alerts) when wired; absent falls back to the bare `agentRegistry.addTokenUsage`
   * write, so every existing call site keeps working unchanged.
   */
  budgetEngine?: { trackUsage(agentId: string, tokens: number): void }
  /** F2 T9 — config `model.pricing` override, merged over the shared default table. */
  pricingOverrides?: PricingTable
  /** Task 11 — records what actually reached the model on this run. Optional everywhere: a missing recorder must never break a run. */
  contextRecorder?: ContextRecorder
  /**
   * F7 — resolves the design service. Lazy and optional: the design module may
   * be disabled, and a run must not depend on it existing.
   */
  getDesigns?: GetDesigns
  /**
   * F7 — the documents service, so a background run's output is findable.
   * Lazy and optional for the same reason as the rest.
   */
  getDocuments?: () => import('@modules/documents/document-service.js').DocumentService | undefined
  /**
   * F1 — durable-memory capture for the background path. A scheduled run that
   * cannot record what the owner told it is the same failure as an interactive
   * turn that cannot. Optional: a build without the memory module still runs.
   */
  memoryCapture?: (input: import('@modules/memory/capture/index.js').CaptureInput) => Promise<void>
}

const DEFAULT_CRITIC_MAX_ROUNDS = 1

export interface RunConversationResult {
  ran: boolean
  sessionId?: string
  reason?: 'not_found' | 'incomplete' | 'agent_unavailable' | 'over_budget' | 'error' | 'event_store_required' | 'ledger_unavailable'
  /** Provider/runtime message when `reason` is 'error' (e.g. HTTP 529 Overloaded). */
  error?: string
  /**
   * F2 T5 — the run stopped on an escalation and is now parked
   * ('waiting_approval' on both the run row and the conversation). It was NOT
   * completed and must not be retried: Task 6 resumes it from the operator's
   * decision on the approval.
   */
  parked?: boolean
}

/**
 * Escalations one resume lineage may accumulate before we stop parking it.
 * A run that keeps re-planning into the same wall would otherwise queue an
 * approval, park, get approved, and immediately park again — burning operator
 * attention instead of the agent's own budget.
 */
const MAX_APPROVALS_PER_LINEAGE = 5

/**
 * Walk the resume lineage (runId → parent_run_id → …). Shared shape with
 * resumeRun's walk: bounded, cycle-safe, and inclusive of `runId` itself.
 */
function runLineage(db: any, runId: string): string[] {
  const chain: string[] = []
  const seen = new Set<string>()
  let cur: string | null = runId
  while (cur && !seen.has(cur) && chain.length < 50) {
    const id: string = cur
    chain.push(id)
    seen.add(id)
    const rows = db.all(sql`SELECT parent_run_id FROM agent_sessions WHERE id = ${id}`) as Array<{ parent_run_id?: string | null }>
    cur = rows[0]?.parent_run_id ?? null
  }
  return chain
}

/**
 * Approvals queued across a run's whole resume lineage. Counting the lineage
 * (not just this run) is what makes the cap bite: every park→approve→resume
 * cycle starts a NEW run row, so a per-run count would always read 1.
 *
 * A query failure counts as 0 (park proceeds): the approvals table is also
 * what produced the id being parked on, so a broken read here means something
 * larger is wrong — refusing the park would only turn a visible wait into an
 * invisible failure.
 */
function countLineageApprovals(db: any, runId: string, logger: { warn: (m: string) => void }): number {
  try {
    let total = 0
    for (const id of runLineage(db, runId)) {
      const row = (db.all(sql`SELECT COUNT(*) AS n FROM autonomy_approvals WHERE run_id = ${id}`) as Array<{ n: number }>)[0]
      total += Number(row?.n ?? 0)
    }
    return total
  } catch {
    logger.warn(`Conversation runner: could not count approvals for run ${runId} — parking without the loop cap`)
    return 0
  }
}

/**
 * Warm-resume overrides. When resuming a checkpoint, the seed messages are the
 * lossless ModelMessage[] (not the goal), plus a do-not-repeat recap and an
 * idempotency ledger that hard-skips already-executed destructive calls.
 */
export interface RunConversationOverrides {
  messages?: ModelMessage[]
  reinjection?: string
  idempotencyLedger?: ReadonlySet<string>
  /** The run this one resumes (recorded as lineage so the ledger is transitive). */
  parentRunId?: string
  /**
   * F2 T8 / D13 — bump the parent's attempts by 1 for this child. ONLY the
   * retry sweep passes true; every other resume (approval, critic feedback,
   * manual retry/refresh) leaves it undefined so the child inherits the
   * parent's attempts unchanged.
   */
  attemptsBump?: boolean
  /**
   * F2 T7 — feedback rounds already spent on this lineage, stamped on the NEW
   * run row BEFORE its own loop starts. It has to be seeded up front, not
   * after the run returns: this run's own critic reads the column to decide
   * whether it may hand back another round, and a zero there would restart the
   * count on every child — an unbounded critic→resume→critic loop.
   */
  criticRounds?: number
  /**
   * F2 T7 — this run CONTINUES its parent's work (checkpoint-seeded) rather
   * than restarting it. Set by resumeRun when seedFromCheckpoint is true —
   * i.e. for a refresh, an approval resume and a critic feedback resume, but
   * NOT for a retry, which re-plans from the goal.
   *
   * It decides what the completeness critic is allowed to read: a continuation
   * only does the REMAINING work, so judging its own output against the WHOLE
   * goal condemns the very run that finished the job. A restart is judged on
   * its own output, because that IS the attempt.
   */
  continuation?: boolean
}

/**
 * Transcript for the critic: the model output of `sessionIds` (oldest→newest),
 * capped by the critic, which keeps the TAIL — so on a continuation chain the
 * current run's output stays dominant while its ancestors supply the context
 * for what "done" already covers. Fail-open — an unreadable event store yields
 * '' and the run ends up 'unverified' rather than failing.
 */
async function buildRunTranscript(eventStore: EventStore | undefined, sessionIds: string[]): Promise<string> {
  if (!eventStore) return ''
  try {
    const parts: string[] = []
    for (const sessionId of sessionIds) {
      const events = await eventStore.getByTypes(sessionId, ['LlmResponse'])
      for (const e of events) {
        const text = String((e.payload as any)?.response?.content ?? '').trim()
        if (text) parts.push(text)
      }
    }
    return parts.join('\n\n')
  } catch {
    return ''
  }
}

/**
 * The run's LAST recorded model output — the background path's equivalent of
 * the delivered reply an interactive turn hands to durable-memory capture.
 * The tail, not the join `buildRunTranscript` builds: capture clips from the
 * head, so a joined transcript would feed the extractor the run's opening
 * moves instead of what it concluded. Fail-open — '' means "nothing to
 * capture", which the caller turns into no capture at all.
 */
async function lastRunOutput(eventStore: EventStore | undefined, sessionId: string | undefined): Promise<string> {
  if (!eventStore || !sessionId) return ''
  try {
    const events = await eventStore.getByTypes(sessionId, ['LlmResponse'])
    for (let i = events.length - 1; i >= 0; i--) {
      const text = String((events[i].payload as any)?.response?.content ?? '').trim()
      if (text) return text
    }
    return ''
  } catch {
    return ''
  }
}

/**
 * Feedback rounds already spent on this run's lineage.
 *
 * The row's own `critic_rounds` is seeded by the resume that created it, but
 * the count of ancestors already marked `verification='failed'` is the floor:
 * derived from the lineage itself, it still bounds the loop if that seed were
 * ever lost (a failed UPDATE, a hand-made row), which is the one failure mode
 * that would otherwise let the critic re-drive a run forever.
 */
function criticRoundsSpent(db: any, runId: string): number {
  const chain = runLineage(db, runId)
  let own = 0
  let failedAncestors = 0
  for (let i = 0; i < chain.length; i++) {
    const row = (db.all(sql`SELECT critic_rounds, verification FROM agent_sessions WHERE id = ${chain[i]}`) as Array<{ critic_rounds: number | null; verification: string | null }>)[0]
    if (i === 0) own = Number(row?.critic_rounds ?? 0)
    else if (row?.verification === 'failed') failedAncestors++
  }
  return Math.max(own, failedAncestors)
}

/** The reviewer note handed back to the agent on a feedback resume. */
export function buildCriticFeedbackMessage(goal: string, reason: string, missing: string[]): string {
  const gaps = missing.length > 0
    ? `\n\nStill missing:\n${missing.map((m) => `- ${m}`).join('\n')}`
    : ''
  return [
    'A reviewer checked your work against the goal and found it INCOMPLETE.',
    `Goal: ${goal}`,
    `Reviewer's finding: ${reason || 'the goal was not fully achieved'}${gaps}`,
    'Finish the remaining work now. Do not redo what is already done — the do-not-repeat list above still applies.',
  ].join('\n\n')
}

export async function runConversation(
  conversationId: string,
  deps: ConversationRunnerDeps,
  overrides: RunConversationOverrides = {},
): Promise<RunConversationResult> {
  const { db, agentRunner, agentRegistry, toolRegistry, supervisor, logger } = deps
  const genId = deps.generateId ?? generateId

  // Explicit column list on purpose: a column that goes missing must fail
  // LOUDLY here rather than silently arriving as undefined and disabling the
  // feature that reads it (which is exactly how thinking/effort/orchestration
  // stayed dead — they were read below but never selected).
  const conv = (db.all(sql`
    SELECT id, agent_id, project_id, goal_description, provider_id, model_id,
           team_session_id, thinking, thinking_budget, effort, orchestration,
           working_directories
    FROM conversations WHERE id = ${conversationId}
  `) as any[])[0]

  if (!conv) return { ran: false, reason: 'not_found' }
  if (!conv.agent_id || !conv.goal_description) return { ran: false, reason: 'incomplete' }

  const agent = agentRegistry.get(conv.agent_id)
  if (!agent || !agent.enabled) return { ran: false, reason: 'agent_unavailable' }
  if (!agentRegistry.isWithinBudget(conv.agent_id)) {
    logger.warn(`Conversation runner: agent ${conv.agent_id} over budget, skipping conversation ${conv.id}`)
    return { ran: false, reason: 'over_budget' }
  }

  // F2 T8 — route through the budget engine (threshold-band alerts) when
  // wired; fall back to the bare registry write otherwise.
  const trackTokens = (tokens: number): void => {
    if (deps.budgetEngine) deps.budgetEngine.trackUsage(conv.agent_id, tokens)
    else agentRegistry.addTokenUsage(conv.agent_id, tokens)
  }

  // Stamped before anything runs: what is newer than this is what this run made.
  const runStartedMs = Date.now()

  let handle: any
  try {
    logger.info(`Conversation runner: processing conversation ${conv.id} with agent ${conv.agent_id}`)
    db.run(sql`UPDATE conversations SET status = 'working' WHERE id = ${conv.id}`)

    // Supervise this run (lifecycle + stuck detection + cancel). parentRunId
    // records resume lineage so the idempotency ledger is transitive.
    handle = supervisor?.beginRun({ sessionId: genId(), conversationId: conv.id, agentId: conv.agent_id, kind: 'background', parentRunId: overrides.parentRunId, attemptsBump: overrides.attemptsBump })

    // F2 T7 — stamp the lineage's spent feedback rounds onto the fresh row
    // BEFORE the loop starts, so this run's own critic reads the real count.
    if (overrides.criticRounds !== undefined && handle?.sessionId) {
      db.run(sql`UPDATE agent_sessions SET critic_rounds = ${overrides.criticRounds} WHERE id = ${handle.sessionId}`)
    }

    // Absent deps (or `enabled: false`) turn BOTH halves of D7/D8 off: no plan
    // is generated and the run finishes exactly as it did before this feature.
    const critic = deps.critic?.enabled === false ? undefined : deps.critic

    // D8 — plan-as-rubric. A complex goal gets a written plan whose steps'
    // successCriteria become both the agent's checklist (injected below) and
    // the critic's rubric. Rubric-only mode: auto-approved, no approval UI.
    // Entirely fail-open — a plan is an aid, never a precondition to running.
    let planSteps: CriticPlanStep[] | undefined
    let planSection = ''
    if (critic && handle?.sessionId) {
      // Keyed on the goal, not just the conversation: goal_description is
      // editable, and a plan written for the previous goal is not a rubric for
      // this run — serving it would misdirect the agent AND then judge it
      // against criteria it was never given.
      const existing = latestPlanForConversation(db, conv.id, conv.goal_description)
      if (existing) {
        // A feedback resume inherits its parent's plan — regenerating one would
        // pay a second time for a rubric the run is already being judged against.
        planSteps = planStepsForCritic(existing.plan)
        planSection = buildPlanRubricSection(existing.plan)
      } else {
        try {
          const tier = (() => {
            try { return critic.resolveTier?.('quick') ?? null } catch { return null }
          })()
          const decision = await maybePlanTask(conv.goal_description, {
            gateway: critic.gateway,
            provider: tier?.provider,
            model: tier?.model,
            // Rubric-only: nobody gates this plan, it exists to be measured against.
            onPlanApproval: async () => true,
          })
          if (decision.kind === 'approved') {
            savePlan(db, { runId: handle.sessionId, conversationId: conv.id, plan: decision.plan, goal: conv.goal_description })
            planSteps = planStepsForCritic(decision.plan)
            planSection = buildPlanRubricSection(decision.plan)
          } else if (decision.kind === 'failed') {
            logger.warn(`Conversation runner: plan generation failed for conversation ${conv.id} (${decision.reason}) — running without a rubric`)
          }
        } catch (err: any) {
          logger.warn(`Conversation runner: plan generation threw for conversation ${conv.id}: ${err?.message ?? err} — running without a rubric`)
        }
      }
    }

    // The plan rides the runner's EXISTING reinjection channel (the same one
    // the resume recap uses), so a resumed run carries both.
    const reinjection = [overrides.reinjection, planSection].filter((s) => s && s.trim()).join('\n\n') || undefined

    const toolDefs = agent.tools && agent.tools.length > 0 ? toolRegistry.toToolDefinitions(agent.tools) : toolRegistry.toToolDefinitions()
    let tokensUsed = 0
    let turns = 0
    // F2 T9 (R2/R3) — sourced ONLY from the runner's own turn_complete events,
    // never from ai_traces (which a critic/judge call would pollute).
    const costAcc = createCostAccumulator()
    const toolNames: string[] = []
    // D6 — set when the runner's event loop signals how it ended (see below);
    // undefined means the loop ended normally.
    let outcome: 'max_turns' | 'tool_budget' | undefined
    // F2 T5 — set when the runner stopped on an escalation. The run is NOT
    // finished: it parks on this approval instead of completing.
    let parkedApprovalId: number | undefined
    // F2 T7 — an aborted run (operator cancel, stuck sweep) ends its loop
    // without throwing, so the critic has to observe it here: a run that was
    // stopped never claimed to be done and must not be judged as if it were.
    let cancelled = false

    // D9: deep orchestration is only real if the model is told about it. Same
    // directive the interactive chat route injects, so a conversation behaves
    // the same whether a human or the scheduler is driving it.
    const orchestrationDirective = buildOrchestrationDirective(conv.orchestration, conv.provider_id)

    // F7 — designs attached to this conversation. Interactive chat has had
    // this since F2; without it here a
    // scheduled run works blind on the very design the brand critic then
    // judges its output against.
    let designBlock: { content: string; designIds: string[] } | null = null
    try {
      const designService = deps.getDesigns?.()
      if (designService) {
        const { buildDesignContext } = await import('@modules/design/design-context.js')
        designBlock = buildDesignContext(designService, conv.id)
      }
    } catch (err: any) {
      // A design reference failing must not cost the run its work.
      logger.warn(`Conversation runner: design context failed for conversation ${conv.id}: ${err?.message ?? err}`)
    }

    // Durable memory, as an INDEX. Same per-turn placement and the same
    // fail-soft contract as the design block above: the runner has `deps.db`,
    // so it builds the index directly rather than through an accessor.
    let memoryBlock: { content: string; paths: string[] } | null = null
    try {
      const { buildMemoryIndex } = await import('@modules/memory/memory-index.js')
      const { effectiveProjectId } = await import('@modules/memory/types.js')
      memoryBlock = buildMemoryIndex(db, { projectId: effectiveProjectId(conv.project_id ?? null) })
    } catch (err: any) {
      logger.warn(`Conversation runner: memory index failed for conversation ${conv.id}: ${err?.message ?? err}`)
    }

    const extraSystem = [orchestrationDirective, designBlock?.content, memoryBlock?.content]
      .filter((s) => s && s.trim())
    const systemString = extraSystem.length
      ? [agent.systemPrompt, ...extraSystem].filter(Boolean).join('\n\n')
      : agent.systemPrompt

    // Assemble the full cache-prefix/suffix prompt when a promptAssembler dep
    // is wired in; fail soft to the bare system string so a wizard outage
    // never blocks a background run.
    let assembledPrompt: import('@modules/prompt-wizard/types').AssembledPrompt | undefined
    if (deps.promptAssembler) {
      try {
        const base = await deps.promptAssembler.buildForPrimary({
          agentId: conv.agent_id,
          agentName: agent.name,
          conversationId: conv.id,
          projectId: conv.project_id ?? null,
          channelContext: null,
        })
        // Reminders are appended after prefix+suffix by the runner — same place
        // the orchestrator puts per-agent constraints.
        assembledPrompt = extraSystem.length
          ? { ...base, reminders: [...base.reminders, ...extraSystem as string[]] }
          : base
      } catch {
        logger.warn('prompt-assembler build failed on background run; using system-string fallback')
        assembledPrompt = undefined // fail soft — keep the system string fallback
      }
    }

    // Task 11 — record what actually reached the model. Assembled sections
    // when the assembler ran; otherwise a single raw-system section, same
    // shape as the unassembled interactive-chat fallback.
    const designSection = designBlock
      ? [{
          zone: 'append' as const, key: DESIGN_SECTION_KEY, content: designBlock.content,
          chars: designBlock.content.length, estimatedTokens: estimateTokens(designBlock.content),
          truncated: false, droppedChars: 0, sourceId: designBlock.designIds.join(','),
        }]
      : []

    const compositionId = deps.contextRecorder?.record({
      sections: assembledPrompt
        ? [...assembledPrompt.sections, ...designSection]
        : (systemString ? [{
            zone: 'append' as const, key: 'raw-system', content: systemString,
            chars: systemString.length, estimatedTokens: estimateTokens(systemString),
            truncated: false, droppedChars: 0,
          }] : []),
      entryPoint: assembledPrompt ? 'background' : 'unassembled',
      conversationId: conv.id,
      agentId: conv.agent_id,
      provider: conv.provider_id,
      model: conv.model_id ?? agent.model,
      prefixHash: assembledPrompt?.prefixHash ?? null,
    }) ?? null

    for await (const event of agentRunner.run({
      // Warm-resume seeds the lossless checkpoint history; a fresh run/retry
      // starts from the goal.
      messages: overrides.messages ?? [{ role: 'user', content: conv.goal_description }],
      tools: toolDefs,
      system: systemString,
      systemPrompt: assembledPrompt,
      maxTurns: agent.maxTurns ?? 20,
      provider: conv.provider_id,
      model: conv.model_id ?? agent.model,
      // R7 — inside a team run the team session IS the messaging session, so
      // team memory and agent-messaging tools resolve the same scope the
      // interactive path gives them.
      toolContext: {
        conversationId: conv.id,
        userId: 'bot',
        agentId: conv.agent_id,
        parentGoal: conv.goal_description,
        teamSessionId: conv.team_session_id ?? undefined,
        sessionId: conv.team_session_id ?? undefined,
        logger,
        ...toolWorkspaceFields(parseWorkingDirectories(conv.working_directories)),
      },
      // F0 R4 — classification metadata for the CLI-provider permission bridge
      // (mirrors the security-gate's own autonomous handling below).
      metadata: { conversationId: conv.id, userId: 'bot', agentId: conv.agent_id, teamSessionId: conv.team_session_id ?? undefined, origin: 'scheduled' as const, autonomous: true, compositionId: compositionId ?? undefined },
      // Thinking + effort follow the conversation's settings — background runs
      // previously always ran thinking-off, silently ignoring the user's choice.
      ...resolveThinkingAndEffort({
        thinking: conv.thinking,
        thinkingBudget: conv.thinking_budget,
        effort: conv.effort,
        orchestration: conv.orchestration,
      }),
      orchestration: conv.orchestration ?? undefined,
      // No human in the loop — sensitive actions are gated by the graduated-
      // autonomy ladder (locked categories fail closed). Same as the original run.
      autonomous: true,
      signal: handle?.signal,
      // Cap 3 keystone — correlate run events + checkpoints to this session.
      sessionId: handle?.sessionId,
      // Warm-resume recap + do-not-repeat ledger, plus the plan rubric (D8).
      reinjection,
      idempotencyLedger: overrides.idempotencyLedger,
    })) {
      if (event.type === 'turn_complete') {
        tokensUsed += event.tokensUsed
        turns++
        costAcc.addTurn((event as any).usage ?? { inputTokens: 0, outputTokens: 0 })
      }
      if (event.type === 'tool_use_start') toolNames.push((event as any).name)
      // D6 — how the loop ended, so complete() can resolve the right terminal
      // status. Both are terminal signals from the runner (max_turns_reached
      // fires after 'done'; tool_budget_exhausted fires before it), so at most
      // one of these can be observed per run.
      if (event.type === 'max_turns_reached') outcome = 'max_turns'
      if (event.type === 'tool_budget_exhausted') outcome = 'tool_budget'
      if (event.type === 'parked_for_approval') parkedApprovalId = (event as any).approvalId
      if (event.type === 'cancelled') cancelled = true
      handle?.progress()
    }

    // F2 T5 (D2) — durable park. The run did NOT finish: it waits on a human
    // decision, so it is neither completed nor failed. handle.complete() must
    // not run (it would finalize the row park has to leave open).
    if (parkedApprovalId !== undefined && handle?.sessionId) {
      // Re-park cap: a lineage that keeps escalating is looping, not
      // progressing. Fail it loudly instead of queueing a sixth approval.
      const approvals = countLineageApprovals(db, handle.sessionId, logger)
      if (approvals >= MAX_APPROVALS_PER_LINEAGE) {
        logger.warn(`Conversation runner: run ${handle.sessionId} hit the approval loop cap (${approvals}) — failing instead of parking`)
        handle.fail('approval_loop', 'approval_loop')
        trackTokens(tokensUsed)
        db.run(sql`UPDATE conversations SET status = 'idle' WHERE id = ${conv.id}`)
        return { ran: true, sessionId: handle.sessionId }
      }

      // park() emits eyas.agent.run.waiting_approval and drops the run from
      // the stuck sweep; the conversation follows it so neither the board's
      // stage automation nor the bot-executor re-arms a card mid-approval.
      // It REFUSES a row that is no longer 'running' — only claim the park (and
      // hold the card) when it actually happened, or the conversation would
      // wait forever on a run nothing can resume.
      if (supervisor?.park?.(handle.sessionId, parkedApprovalId) === true) {
        trackTokens(tokensUsed)
        db.run(sql`UPDATE conversations SET status = 'waiting_approval' WHERE id = ${conv.id}`)
        logger.info(`Conversation runner: conversation ${conv.id} parked on approval ${parkedApprovalId}`)
        return { ran: true, sessionId: handle.sessionId, parked: true }
      }
      logger.warn(`Conversation runner: run ${handle.sessionId} could not be parked on approval ${parkedApprovalId} (no park primitive, or the run was already finalized) — closing it normally`)
    }

    // ── F2 T7 (D7) — verification before done ──────────────────────────
    // Only a run that would finalize as genuinely DONE is judged: a
    // max_turns / tool_budget / cancelled run never claimed to have achieved
    // the goal, and a parked one already returned above. Team-member and
    // executeAgent runs are out of scope in F2 (their column stays NULL).
    let verification: 'passed' | 'failed' | 'unverified' | undefined
    let feedback: { reason: string; missing: string[] } | undefined
    /** Feedback rounds already spent when this run started — the child records round + 1. */
    let round = 0

    // P1 — deterministic verify commands (lint/test) before LLM critic.
    const verifyCwd = parseWorkingDirectories(conv.working_directories)[0]
    if (deps.verify?.commands?.length && verifyCwd && !outcome && !cancelled && handle?.sessionId) {
      try {
        const suite = await runVerifyCommands(
          deps.verify.commands,
          verifyCwd,
        )
        try {
          await deps.eventStore?.append({
            sessionId: handle.sessionId,
            type: 'VerifySuite',
            payload: {
              ok: suite.ok,
              summary: suite.summary,
              results: suite.results.map((r) => ({
                name: r.name,
                ok: r.ok,
                exitCode: r.exitCode,
                durationMs: r.durationMs,
              })),
            },
          })
        } catch {
          // best-effort
        }
        if (!suite.ok) {
          verification = 'failed'
          feedback = { reason: suite.summary, missing: suite.missing }
          logger.warn(`Conversation runner: verify suite failed for run ${handle.sessionId}: ${suite.summary}`)
        }
      } catch (err: any) {
        logger.warn(`Conversation runner: verify suite error for run ${handle.sessionId}: ${err?.message ?? err}`)
        // Do not fail the run hard on harness errors — leave to critic / unverified.
      }
    }

    if (critic && !outcome && !cancelled && handle?.sessionId && !feedback) {
      try {
        round = criticRoundsSpent(db, handle.sessionId)
        // A continuation is judged on everything its lineage produced (oldest
        // first); a fresh run or a restart, on its own output alone.
        const judged = overrides.continuation
          ? runLineage(db, handle.sessionId).reverse()
          : [handle.sessionId]
        const transcript = await buildRunTranscript(deps.eventStore, judged)
        if (!transcript) {
          // No event store, or a run that produced no recorded output: there is
          // nothing to judge, so the run is honestly UNVERIFIED — not failed.
          verification = 'unverified'
        } else {
          // Pass toolCalls so grounding does not rely only on transcript text
          // matching tool names (the event store may omit them).
          const retrievalUsed = toolNames.some((n) => isRetrievalTool(n))
          const citationsFound = Array.from(
            transcript.matchAll(/\[source:([^\]]+)\]/gi),
            (m) => m[1],
          )
          const verdict = await runCritic(
            {
              goal: conv.goal_description,
              planSteps,
              transcript,
              retrievalUsed,
              citationsFound: citationsFound.length > 0 ? citationsFound : undefined,
            },
            {
              gateway: critic.gateway,
              resolveTier: critic.resolveTier,
              logger: { warn: (obj, msg) => logger.warn(`${msg ?? 'completeness critic'}: ${JSON.stringify(obj)}`) },
              metadata: { origin: 'scheduled', conversationId: conv.id, runId: handle.sessionId },
            },
          )
          try {
            await deps.eventStore?.append({
              sessionId: handle.sessionId,
              type: 'CriticVerdict',
              payload: { verdict: verdict.verdict, reason: verdict.reason, missing: verdict.missing, round },
            })
          } catch {
            // Best-effort trace, exactly like the runner's own event capture.
          }
          verification = verdict.verdict === 'complete'
            ? 'passed'
            : verdict.verdict === 'incomplete' ? 'failed' : 'unverified'
          if (verdict.verdict === 'incomplete') feedback = { reason: verdict.reason, missing: verdict.missing }
        }
      } catch (err: any) {
        // The critic itself never throws; this covers the store/db around it —
        // including an unreadable lineage, where the round cap cannot be
        // computed and so no feedback round may be started.
        logger.warn(`Conversation runner: completeness check failed for run ${handle.sessionId}: ${err?.message ?? err}`)
        verification = 'unverified'
        feedback = undefined
      }

      // The cap is per LINEAGE: round 0 is the original run, and a maxRounds of
      // 1 buys exactly one hand-back before the gap becomes the operator's.
      // Shared by BOTH critics on purpose — one hand-back per lineage total.
      const maxRounds = critic.maxRounds ?? DEFAULT_CRITIC_MAX_ROUNDS
      if (feedback && round >= maxRounds) {
        logger.warn(`Conversation runner: run ${handle.sessionId} is still incomplete after ${round} feedback round(s) — leaving it failed for operator attention`)
        feedback = undefined
      }
    }

    // F2 T9 (R3) — resolved off the SAME provider/model the run's requests
    // used, so a turn priced by table estimate (no CLI-authoritative costUsd)
    // uses the model that actually served it.
    const costUsd = costAcc.finalize(conv.provider_id, conv.model_id ?? agent.model, deps.pricingOverrides)
    // What the run wrote is otherwise invisible: a CLI provider writes with its
    // own file tool, so there is no write_file call to intercept and nothing
    // lands in the documents table. Interactive chat has done this since F7;
    // without it here, a scheduled report exists only on disk.
    if (verifyCwd) {
      try {
        const docs = deps.getDocuments?.()
        if (docs) {
          const { collectWorkspaceOutputs, attachWorkspaceOutputs } = await import('@modules/conversations/workspace-outputs.js')
          const outputs = await collectWorkspaceOutputs(verifyCwd, runStartedMs)
          if (outputs.length) {
            await attachWorkspaceOutputs(
              { documents: docs as any, logger: { warn: (o) => logger.warn(o as any), info: (o) => logger.info(o as any) } },
              conv.id,
              outputs,
              conv.agent_id ?? undefined,
            )
          }
        }
      } catch (err: any) {
        logger.warn(`Conversation runner: could not attach workspace outputs for ${conv.id}: ${err?.message ?? err}`)
      }
    }

    handle?.complete({ toolCalls: toolNames, turns, outcome, verification, tokensUsed, costUsd })

    // Durable-memory capture — fire-and-forget, after the run is complete.
    //
    // Stored messages first, so a conversation that WAS interactive hands the
    // extractor the same exchange the interactive path would have. But this
    // runner never writes conversation_messages (see the note under
    // trackTokens below), so an autonomous card has no stored exchange at all:
    // the run's instruction and its last recorded model output ARE the
    // exchange. Reading only the table captured ('', '') — one junk skip row
    // per run and never a note.
    //
    // Only the input gathering is awaited (two local reads); the extraction
    // itself stays detached, because that is the part that costs a model call.
    if (deps.memoryCapture) {
      try {
        const lastOf = (role: string) => ((db as any).all(sql`SELECT content FROM conversation_messages
          WHERE conversation_id = ${conv.id} AND role = ${role} ORDER BY created_at DESC LIMIT 1`) as Array<{ content: string }>)[0]?.content ?? ''
        const userMessage = lastOf('user') || (conv.goal_description ?? '')
        const assistantMessage = lastOf('assistant') || await lastRunOutput(deps.eventStore, handle?.sessionId)
        // Nothing the extractor could read: no call, and no run row either. A
        // skip row per autonomous run would only inflate the diagnostics it
        // exists to keep honest.
        if (assistantMessage) {
          void deps.memoryCapture({
            conversationId: conv.id,
            projectId: conv.project_id ?? null,
            userMessage,
            assistantMessage,
          }).catch(() => {})
        }
      } catch { /* a missing note, never a failed run */ }
    }

    trackTokens(tokensUsed)
    // F2 T9 (R7) — background runs never call conversations.addMessage (no
    // per-turn tokensIn/tokensOut path exists for them), so `tokens` is safe
    // to pass here without double-counting anything the interactive route did.
    addRunCost(db, conv.id, { tokens: tokensUsed, costUsd })
    db.run(sql`UPDATE conversations SET status = 'idle' WHERE id = ${conv.id}`)

    // The feedback resume runs AFTER this run is finalized: the child is a new
    // run in the same lineage (never a board 'waiting' re-arm — S5), seeded
    // from this run's checkpoint plus the reviewer's note. Isolated: a resume
    // that cannot start must not turn this run's honest result into an error.
    if (feedback && handle?.sessionId) {
      const runId = handle.sessionId
      if (!deps.eventStore || !deps.getCheckpoint) {
        logger.warn(`Conversation runner: run ${runId} failed verification but no event store / checkpoint service is wired — cannot hand the gaps back`)
      } else {
        try {
          const child = await resumeRun(runId, { ...deps, eventStore: deps.eventStore, getCheckpoint: deps.getCheckpoint }, {
            seedFromCheckpoint: true,
            extraMessages: [{ role: 'user', content: buildCriticFeedbackMessage(conv.goal_description, feedback.reason, feedback.missing) }],
            criticRounds: round + 1,
          })
          if (!child.ran) {
            logger.warn(`Conversation runner: feedback resume of run ${runId} did not start (${child.reason ?? 'unknown'})`)
          }
        } catch (err: any) {
          logger.warn(`Conversation runner: feedback resume of run ${runId} threw: ${err?.message ?? err}`)
        }
      }
    }

    return { ran: true, sessionId: handle?.sessionId }
  } catch (err: any) {
    // F2 T8 — classify the thrown error (T1's providers-always-throw
    // contract) so the kind lands on the row: run-supervisor's fail() reads
    // it to decide whether/when this BACKGROUND run auto-retries.
    const { kind } = classifyModelError(err)
    const message = String(err?.message ?? err)
    handle?.fail(message, kind)
    logger.error(`Conversation runner: failed on conversation ${conv.id}: ${message}`)
    db.run(sql`UPDATE conversations SET status = 'idle' WHERE id = ${conv.id}`)
    return { ran: false, reason: 'error', error: message }
  }
}

/**
 * Tool names whose re-execution on a resume is HARD-blocked when their exact
 * (toolName, argHash) already ran on the original run (D2: hard-guard
 * destructive). Non-destructive repeats stay advisory (recap only).
 */
// Tools whose re-execution on resume is HARD-blocked when their exact
// (toolName, argHash) already ran. POLICY: a tool belongs here iff it is a
// NON-IDEMPOTENT SIDE EFFECT whose OUTPUT the model does not need to proceed —
// the hard-skip returns a stub, not the original output, so listing a
// data-returning/read tool (research, browser_navigate, search_*, save_memory)
// would starve a goal-reseed retry of the data it needs. Reads are deliberately
// EXCLUDED; only sends / writes / creates / spawns / external actions belong.
export const DESTRUCTIVE_TOOLS = [
  // Actually-registered non-idempotent side-effecting tools (names must match
  // exactly what the runner emits, else the hard-guard never fires).
  'run_command',
  'browser_click', 'browser_fill',
  'create_page', 'move_to_stage', 'create_sub_conversation',
  'send_agent_message', 'write_team_memory', 'save_memory',
  'delegate_to_agent', 'assign_task', 'propose_agent_creation', 'propose_team',
  'forge_propose_soul_change',
  'workspace_append', 'workspace_edit', 'workspace_update_identity',
  'add_internal_contact',
  'a2a_delegate', 'a2a_cancel_task',
  // Forward-compat generics (MCP / future tools) — harmless if unregistered.
  'bash', 'shell', 'write_file', 'delete_file', 'db_exec', 'http_call',
  'send_message', 'send_telegram', 'channel_send', 'list_channels', 'post_to_agent', 'send_email',
]

export interface ResumeRunDeps extends ConversationRunnerDeps {
  /** Optional — absent (event-store disabled) means no idempotency ledger. */
  eventStore?: EventStore
  /** Required here (unlike the base deps): the resume seeds from a checkpoint. */
  getCheckpoint: () => { api: CheckpointAPI }
  /** Override the destructive-tool set (defaults to DESTRUCTIVE_TOOLS). */
  destructiveTools?: string[]
}

/**
 * Warm-resume a TERMINAL run: seed the runner from the run's latest checkpoint
 * (lossless ModelMessage[]), re-ground the model with a do-not-repeat recap
 * built from its recorded ToolCall events, and hard-skip already-executed
 * destructive calls via an idempotency ledger. Falls back to a recap-reseed
 * (goal + recap) when no checkpoint exists. Starts a NEW supervised run; the
 * ledger/recap are derived from the OLD run's recorded history.
 */
export async function resumeRun(
  runId: string,
  deps: ResumeRunDeps,
  opts: {
    seedFromCheckpoint?: boolean
    /**
     * F2 T6 — messages appended AFTER the seed (checkpoint history, or the
     * goal when there is none). The approval resume puts the operator's
     * verdict here: the model has to learn how its blocked call was decided,
     * and the seed alone ends exactly where it walled.
     */
    extraMessages?: ModelMessage[]
    /**
     * F2 T7 — feedback rounds already spent on this lineage, stamped on the new
     * run before it starts (see RunConversationOverrides.criticRounds).
     */
    criticRounds?: number
    /**
     * F2 T8 / D13 — bump the parent's (this run's) attempts by 1 for the
     * child. ONLY the retry sweep passes true; approval resume, critic
     * feedback resume, and the manual retry/refresh routes all leave it
     * undefined so the child inherits attempts unchanged.
     */
    attemptsBump?: boolean
  } = {},
): Promise<RunConversationResult> {
  const { db, eventStore, getCheckpoint } = deps
  // Default: refresh = lossless checkpoint seed. retry passes false = re-plan
  // from the goal — but the destructive ledger + recap are armed EITHER WAY.
  const seedFromCheckpoint = opts.seedFromCheckpoint !== false
  const destructive = new Set(deps.destructiveTools ?? DESTRUCTIVE_TOOLS)

  // The anti-re-fire ledger is built from the run's recorded ToolResult events.
  // Without an event store there is NO ledger source, so resuming could silently
  // re-fire a destructive side effect — refuse (fail safe) rather than re-run.
  if (!eventStore) return { ran: false, reason: 'event_store_required' }

  const row = (db.all(sql`SELECT id, conversation_id FROM agent_sessions WHERE id = ${runId}`) as any[])[0]
  if (!row) return { ran: false, reason: 'not_found' }
  const conversationId = row.conversation_id
  const conv = (db.all(sql`SELECT goal_description FROM conversations WHERE id = ${conversationId}`) as any[])[0]
  const goal = conv?.goal_description ?? ''

  // Lossless seed: the latest checkpoint's full ModelMessage[] (refresh only).
  let messages: ModelMessage[] | undefined
  if (seedFromCheckpoint) {
    try {
      const checkpoints = await getCheckpoint().api.list(runId)
      const mm = (checkpoints[0]?.state as any)?.meta?.modelMessages
      if (Array.isArray(mm) && mm.length > 0) messages = mm as ModelMessage[]
    } catch { /* best-effort — fall back to recap-reseed */ }
  }

  // Walk the resume lineage (runId → parent_run_id → …) so the ledger is
  // transitive across a resume CHAIN — a destructive call done by an ancestor
  // run is still guarded even if an intermediate resume did not re-attempt it.
  const chain: string[] = []
  const seenRuns = new Set<string>()
  let cur: string | null = runId
  while (cur && !seenRuns.has(cur) && chain.length < 50) {
    const id: string = cur
    chain.push(id)
    seenRuns.add(id)
    const rows = db.all(sql`SELECT parent_run_id FROM agent_sessions WHERE id = ${id}`) as Array<{ parent_run_id?: string | null }>
    const next: string | null = rows[0]?.parent_run_id ?? null
    cur = next
  }

  // Recap + idempotency ledger from the chain's SUCCESSFUL ToolResult events
  // (carrying toolName + argHash). Using ToolResult(success) — not ToolCall —
  // means a failed destructive op is NOT blocked (it can be retried). A query
  // FAILURE here must FAIL SAFE (refuse) rather than degrade to an empty ledger.
  const doneToolCalls: DoneToolCall[] = []
  const ledger = new Set<string>()
  const seen = new Set<string>()
  let results: Array<{ payload: unknown }>
  try {
    results = []
    for (const rid of chain) results.push(...await eventStore.getByTypes(rid, ['ToolResult']))
  } catch {
    return { ran: false, reason: 'ledger_unavailable' }
  }
  for (const ev of results) {
    const p = ev.payload as any
    if (p?.success !== true) continue
    const toolName = String(p?.toolName ?? '')
    const h = String(p?.argHash ?? '')
    if (!toolName || !h) continue
    const key = `${toolName}:${h}`
    if (seen.has(key)) continue
    seen.add(key)
    doneToolCalls.push({ tool: toolName, argHash: h, args: p?.argPreview ? String(p.argPreview) : undefined })
    if (destructive.has(toolName)) ledger.add(key)
  }

  const reinjection = buildTaskStateReinjection({ goal, doneToolCalls })

  // The extras land after the seed, whichever seed applied: a checkpoint's
  // lossless history, or (when there is none) the goal message runConversation
  // would otherwise build on its own — spelled out here because appending to
  // an absent seed has to produce the same first message it would have.
  if (opts.extraMessages && opts.extraMessages.length > 0) {
    messages = [...(messages ?? [{ role: 'user', content: goal } as ModelMessage]), ...opts.extraMessages]
  }

  return runConversation(conversationId, deps, {
    messages,
    reinjection: reinjection || undefined,
    idempotencyLedger: ledger.size > 0 ? ledger : undefined,
    parentRunId: runId, // the new run resumes THIS run — record lineage
    criticRounds: opts.criticRounds,
    attemptsBump: opts.attemptsBump,
    // Checkpoint-seeded = this run CONTINUES the parent's work, so the critic
    // judges the lineage's combined output. A retry (seedFromCheckpoint:false)
    // re-plans from the goal and is judged on its own attempt alone.
    continuation: seedFromCheckpoint,
  })
}
