// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { randomBytes } from 'crypto'
import { execFileSync } from 'child_process'
import { z } from 'zod'
import type { AgentRegistry } from './agent-registry.js'
import type { createAgentRunner } from './agent-runner.js'
import { supervisorOutcomeOf } from './run-outcome.js'
import type { AuxiliaryModelService, AuxResult } from '@modules/model/auxiliary.js'
import { loadEffortIntent, type EffortIntentDb } from '@modules/conversations/effort-intent.js'
import type { ConversationService } from '@modules/conversations/conversation-service.js'
import type { createToolExecutor } from '@modules/tools/tool-executor.js'
import type { ToolRegistry } from '@modules/tools/tool-registry.js'
import { createRePlanner, type PhaseResult, type PlanTask, type RePlanResult } from './re-planner.js'
import type { TeamMemberResult, TeamPhaseStatus } from './team-session-service.js'
import { generateId } from '@shared/crypto.js'
import type { RunSupervisor } from './run-supervisor.js'
import { createCostAccumulator, type PricingTable } from '@shared/model-pricing.js'
import { isGitRepo, toolWorkspaceFields } from '@modules/tools/working-directories.js'
import { estimateMessagesTokens, estimateTokens } from '@modules/prompt-wizard/token-budget.js'
import { deliveryRecordFields } from '@modules/prompt-wizard/assemble-system.js'
import { observeRunEvents, type ContextRecorder } from '@modules/observability/context-recorder.js'
import { resolveToolScope, scopedToolDefinitions } from './tool-scope.js'
import { captureRunEnd, type MemoryCaptureFn } from '@modules/memory/capture/run-end.js'
import {
  agentModelPreference,
  conversationBindingInput,
  resolveRunBindingStatic,
  runConversationRow,
  type BindingResolver,
  type ModelPair,
} from '@modules/model/binding.js'

// ─── Git Worktree Helpers ─────────────────────

interface WorktreeInfo {
  path: string
  branch: string
}

interface TrackedWorktree extends WorktreeInfo {
  basePath: string
}

// Module-scope tracker: every live worktree is registered here so that a
// SIGTERM/SIGINT handler can clean up synchronously before the process dies.
// Without this, a hard kill leaves `agent/*` branches and their directories
// behind, permanently cluttering the repo and eventually breaking `git worktree add`.
const liveWorktrees = new Set<TrackedWorktree>()
let signalHandlersRegistered = false

function syncCleanupAll(): void {
  for (const wt of liveWorktrees) {
    try {
      execFileSync('git', ['worktree', 'remove', wt.path, '--force'], { cwd: wt.basePath, stdio: 'pipe' })
    } catch { /* already gone */ }
    try {
      execFileSync('git', ['branch', '-D', wt.branch], { cwd: wt.basePath, stdio: 'pipe' })
    } catch { /* already gone */ }
  }
  liveWorktrees.clear()
}

function registerSignalHandlers(): void {
  if (signalHandlersRegistered) return
  signalHandlersRegistered = true

  // Registering a signal listener suppresses Node's default behavior of exiting
  // with the conventional signal code, so we re-assert it explicitly.
  process.on('SIGTERM', () => { syncCleanupAll(); process.exit(143) })
  process.on('SIGINT', () => { syncCleanupAll(); process.exit(130) })
  // `exit` is best-effort: runs on graceful exit, NOT on SIGKILL/crash, but
  // catches anything Node would have otherwise let through silently.
  process.on('exit', syncCleanupAll)
}

export function createWorktree(basePath: string, agentId: string): WorktreeInfo {
  const suffix = randomBytes(4).toString('hex')
  const branch = `agent/${agentId}-${suffix}`
  const wtPath = `${basePath}/.eyas-worktrees/${branch.replace(/\//g, '-')}`

  // Create worktree with new branch from current HEAD
  execFileSync('git', ['worktree', 'add', '-b', branch, wtPath, 'HEAD'], { cwd: basePath, stdio: 'pipe' })
  const tracked: TrackedWorktree = { basePath, path: wtPath, branch }
  liveWorktrees.add(tracked)
  registerSignalHandlers()
  return tracked
}

/**
 * F2 T5 — keep a worktree on disk but stop tracking it for cleanup. Used when a
 * team member PARKS: its uncommitted edits are the state a resume (Task 6)
 * continues from, and every tracked worktree is force-removed by the
 * SIGTERM/SIGINT/exit handler above — so retention that survives a restart
 * REQUIRES dropping it from the tracker, not just skipping removeWorktree().
 *
 * The cost is deliberate and bounded: a retained worktree outlives the process,
 * and nothing reclaims it until the parked run is resumed or its approval is
 * rejected/expired (Task 6). The boot GC leaves it alone — `git worktree prune`
 * only clears records whose directory is gone, and the `agent/*` branch sweep
 * skips branches still referenced by a live worktree.
 */
function retainWorktree(wt: WorktreeInfo): void {
  for (const tracked of liveWorktrees) {
    if (tracked.path === wt.path) {
      liveWorktrees.delete(tracked)
      break
    }
  }
}

/**
 * Remove a worktree and its branch. Exported for F2 T6: a RETAINED worktree
 * (see retainWorktree) is reclaimed from the approval-resume path once the
 * parked run it belonged to is resumed, rejected, expired or cancelled — the
 * only thing that stops a retained worktree leaking forever.
 */
export function removeWorktree(basePath: string, wt: WorktreeInfo): void {
  try {
    execFileSync('git', ['worktree', 'remove', wt.path, '--force'], { cwd: basePath, stdio: 'pipe' })
  } catch { /* worktree may already be gone */ }
  try {
    execFileSync('git', ['branch', '-D', wt.branch], { cwd: basePath, stdio: 'pipe' })
  } catch { /* branch may already be gone */ }

  // Find the matching tracker entry (by path) and remove it. The interface type
  // accepted here may not have basePath, so we look up by path.
  for (const tracked of liveWorktrees) {
    if (tracked.path === wt.path) {
      liveWorktrees.delete(tracked)
      break
    }
  }
}

/**
 * Startup garbage collection for worktrees left behind by a previous EYAS run
 * that terminated abnormally (SIGKILL, OOM, host crash). Safe to call multiple
 * times and safe on non-repositories.
 *
 * Returns counts so the caller can log GC activity — this is the only feedback
 * we get from a silent cleanup, and makes abnormal-termination rates visible.
 */
export function gcOrphanedWorktrees(basePath: string): { pruned: boolean; branchesDeleted: number } {
  let pruned = false
  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: basePath, stdio: 'pipe' })
    pruned = true
  } catch { /* not a git repo — nothing to prune */ }

  // An abandoned `agent/*` branch whose worktree has been pruned is a zombie:
  // it occupies namespace and can collide with future worktree creation. Remove
  // any agent/* branch that is no longer referenced by a live worktree.
  let branchesDeleted = 0
  try {
    const branchOutput = execFileSync('git', ['branch', '--list', 'agent/*'], {
      cwd: basePath,
      encoding: 'utf-8',
    })
    const agentBranches = branchOutput
      .split('\n')
      .map(l => l.replace(/^\*?\s+/, '').trim())
      .filter(Boolean)

    if (agentBranches.length === 0) return { pruned, branchesDeleted }

    const wtList = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: basePath,
      encoding: 'utf-8',
    })

    for (const branch of agentBranches) {
      if (!wtList.includes(`branch refs/heads/${branch}`)) {
        try {
          execFileSync('git', ['branch', '-D', branch], { cwd: basePath, stdio: 'pipe' })
          branchesDeleted++
        } catch { /* branch may already be gone */ }
      }
    }
  } catch { /* git not available or repo in unusual state */ }

  return { pruned, branchesDeleted }
}

// Test hook — exposes tracker size without leaking the Set itself.
export function __getLiveWorktreeCountForTest(): number {
  return liveWorktrees.size
}

function mergeWorktree(basePath: string, wt: WorktreeInfo): { success: boolean; conflicts?: string } {
  try {
    // Check if worktree branch has any new commits
    const diff = execFileSync('git', ['log', `HEAD..${wt.branch}`, '--oneline'], { cwd: basePath, encoding: 'utf-8' }).trim()
    if (!diff) return { success: true } // No changes

    // Try to merge
    execFileSync('git', ['merge', wt.branch, '--no-edit'], { cwd: basePath, stdio: 'pipe' })
    return { success: true }
  } catch (err: any) {
    // Merge conflict
    try { execFileSync('git', ['merge', '--abort'], { cwd: basePath, stdio: 'pipe' }) } catch {}
    return { success: false, conflicts: err.message }
  }
}

// ─── Types ────────────────────────────────────

export interface TeamConfig {
  phases: TeamPhase[]
  maxParallelAgents: number
  conflictStrategy: 'first-wins' | 'merge' | 'human-review'
  replanAfterPhase: boolean
  useWorktrees: boolean           // Isolate agents in git worktrees
  worktreeBasePath?: string       // Base path for worktrees (default: process.cwd())
}

export interface TeamPhase {
  name: string
  agents: string[] // Agent IDs
  parallel: boolean
  checkpoint: boolean
  replanOnComplete: boolean
}

export interface AgentGap {
  suggestedName: string
  suggestedRole: string
  capabilities: string[]
  reason: string
  canProceedWithout: boolean
  proposedAgentType: string
}

export interface TeamProposal {
  config: TeamConfig
  reasoning: string
  estimatedTokens: number
  estimatedCostUsd: number
  agentGaps: AgentGap[]
}

/**
 * F2 T10 — where a re-driven run picks the phase loop back up. Produced by
 * `teamSessions.getResumeState()` from the persisted cursor + phase results.
 */
export interface ExecuteTeamResumeOptions {
  /** Phases below this index are skipped (already finished in an earlier process). */
  startAtPhase?: number
  /** Index-aligned with `config.phases`: element i holds phase i's prior member results. */
  preloadedResults?: PhaseResult[]
}

export type OrchestratorEvent =
  | { type: 'team_proposed'; proposal: TeamProposal }
  | { type: 'phase_started'; phase: string; agents: string[] }
  | { type: 'agent_started'; agentId: string; conversationId: string; phase: string }
  | { type: 'agent_completed'; agentId: string; conversationId: string; status: 'completed' | 'failed' }
  | { type: 'phase_completed'; phase: string; results: PhaseResult }
  | { type: 'replan_result'; result: RePlanResult }
  | { type: 'checkpoint'; phase: string; message: string }
  | { type: 'team_completed'; totalTokens: number; totalCostUsd: number }
  | { type: 'team_failed'; error: string }

// ─── Live per-subagent progress ───────────────

/**
 * Fine-grained progress emitted by a single subagent run so the frontend can
 * render a live `/workflows`-style tree. The child conversationId is the stable
 * node key (known here, unlike the generator's agent_started which yields '').
 * Tool activity is not part of it: the agent runner emits tool_started /
 * tool_result on the same node itself, for every provider.
 */
export type RunAgentProgress =
  | { kind: 'node_started'; conversationId: string; agentId: string; phase: string }
  | { kind: 'node_progress'; conversationId: string; turn: number; tokens: number; phase: string }

// ─── Dependencies ─────────────────────────────

interface OrchestratorDeps {
  agentRegistry: AgentRegistry
  agentRunner: ReturnType<typeof createAgentRunner>
  /**
   * The model binding resolver (ctx.modelBinding), read per member run: a
   * member runs on its own provider+model, else on the lead's current model
   * (the parent conversation's effective binding), else the install default.
   * Absent (unit tests): the member's own model, else the gateway's default.
   */
  readonly modelBinding?: Pick<BindingResolver, 'resolveStatic'>
  /**
   * The background model service (ctx.auxiliaryModel) for the team proposal
   * and the re-planner. Read through a lazy getter on every call: module
   * registration order is not guaranteed, so a by-value read could stay
   * undefined. Absent means no eligible background model.
   */
  readonly aux?: Pick<AuxiliaryModelService, 'complete'>
  conversations: ConversationService
  /**
   * The database, for a member's effort intent (effort-intent.ts): a member
   * without its own effort inherits the lead conversation's. Absent (unit
   * tests): only the member agent's own effort applies.
   */
  db?: EffortIntentDb
  toolRegistry: ToolRegistry
  toolExecutor: ReturnType<typeof createToolExecutor>
  bus?: { emit(subject: string, data: unknown): void }
  teamSessions?: {
    pause(id: string): Promise<void>
    /** Renders the session's shared team memory as a `<team-context>` block for prompt injection. */
    injectTeamMemory?(teamSessionId: string, agentRole?: string): string
    /**
     * F2 T10 — durability sinks. Optional: an orchestrator built without them
     * (unit tests, tools) simply runs without a restartable cursor, exactly as
     * before this task. Both are fail-soft on the service side.
     */
    setPhaseCursor?(id: string, currentPhase: number, phaseStatus: TeamPhaseStatus): void
    recordPhaseResult?(id: string, phaseIndex: number, result: TeamMemberResult): void
  }
  promptAssembler?: import('@modules/prompt-wizard/assembler').PromptAssembler
  /**
   * F2 T4 — supervises every team member run: an agent_sessions row (kind
   * 'team'), checkpoint + event-store capture (activated by the sessionId
   * threaded into agentRunner.run), and an AbortSignal an operator cancel
   * (Mission Control) can trip. Optional so existing unit tests that build an
   * orchestrator without one keep working — the member run is then simply
   * unsupervised, exactly like before this task.
   *
   * F2 T5 — `park` joins it: a member whose run stopped on an escalation is
   * parked (not completed) so Task 6 can resume that exact session.
   */
  supervisor?: Pick<RunSupervisor, 'beginRun'> & Partial<Pick<RunSupervisor, 'park' | 'recordRetainedWorktree'>>
  /**
   * F2 T8 — routes token tracking through the budget engine (threshold-band
   * alerts) when wired; absent falls back to the bare `agentRegistry.addTokenUsage`
   * write, so every existing call site/test keeps working unchanged.
   */
  budgetEngine?: { trackUsage(agentId: string, tokens: number): void }
  /** F2 T9 — config `model.pricing` override, merged over the shared default table. */
  pricingOverrides?: PricingTable
  /** Task 11 — records what actually reached the model for each team member run. */
  contextRecorder?: ContextRecorder
  /**
   * The durable-fact pass (ctx.memoryCapture), read per member run through a
   * lazy getter: the memory module publishes it, in whatever order modules
   * start. Absent: a member run captures nothing and never fails for it.
   */
  readonly memoryCapture?: MemoryCaptureFn
}

// ─── Orchestrator ─────────────────────────────

export function createOrchestrator(deps: OrchestratorDeps) {
  const { agentRegistry, agentRunner, conversations, toolRegistry, budgetEngine } = deps
  const rePlanner = createRePlanner(() => deps.aux)

  /**
   * The lead's current model: the parent conversation's effective binding
   * (no triage — an Auto conversation gives its Standard tier). Null when it
   * cannot be resolved; the member then falls back to the install default.
   */
  function leadBinding(parentConv: any): ModelPair | null {
    const resolver = deps.modelBinding
    if (!resolver || !parentConv) return null
    try {
      const leadAgent = parentConv.agentId ? agentRegistry.get(parentConv.agentId) : undefined
      const row = runConversationRow(parentConv, parentConv.agentId ?? null, parentConv.id)
      const binding = resolver.resolveStatic(conversationBindingInput(row, { agent: agentModelPreference(leadAgent) }))
      return { providerId: binding.providerId, modelId: binding.modelId }
    } catch {
      return null
    }
  }

  return {
    /**
     * Analyze a complex task via LLM and propose an optimal team configuration.
     * Identifies agent gaps — specialists not yet in the registry.
     */
    async analyzeAndPropose(
      goalDescription: string,
      complexity: string,
      attribution?: { conversationId?: string },
    ): Promise<TeamProposal> {
      const enabledAgents = agentRegistry.list({ enabled: true })

      const agentList = enabledAgents.map((a: any) => {
        const caps = (() => {
          try {
            const raw = a.capabilities
            const arr: string[] = Array.isArray(raw) ? raw : JSON.parse(raw ?? '[]')
            return arr.join(', ')
          } catch { return '' }
        })()
        return `- ID: ${a.id}, Name: ${a.name}, Type: ${a.agentType}, Capabilities: ${caps}`
      }).join('\n')

      const systemPrompt = `You are a team orchestration planner. Given a task and available agents, propose the optimal team. Output ONLY valid JSON, no markdown.

JSON schema:
{
  "phases": [{"name":"string","agentIds":["string"],"parallel":boolean,"checkpoint":boolean,"replanOnComplete":boolean,"reasoning":"string"}],
  "agentGaps": [{"suggestedName":"string","suggestedRole":"string","capabilities":["string"],"reason":"string","canProceedWithout":boolean,"proposedAgentType":"string"}],
  "reasoning": "string",
  "estimatedTokensPerAgent": number
}`

      const userMessage = `## Task\n${goalDescription}\n\n## Complexity\n${complexity}\n\n## Available Agents\n${agentList || '(none)'}\n\nPropose a team using only the listed agent IDs. If a specialist is clearly missing for this task, add it to agentGaps.`

      const proposalSchema = z.object({
        phases: z.array(z.object({
          name: z.string(),
          agentIds: z.array(z.string()),
          parallel: z.boolean().default(false),
          checkpoint: z.boolean().default(false),
          replanOnComplete: z.boolean().default(false),
          reasoning: z.string().default(''),
        })).default([]),
        agentGaps: z.array(z.object({
          suggestedName: z.string(),
          suggestedRole: z.string(),
          capabilities: z.array(z.string()).default([]),
          reason: z.string(),
          canProceedWithout: z.boolean().default(true),
          proposedAgentType: z.string().default('assistant'),
        })).default([]),
        reasoning: z.string().default(''),
        estimatedTokensPerAgent: z.number().min(0).max(1_000_000).default(10_000),
      })

      const fallback = (reason: string): TeamProposal => {
        const agent = enabledAgents[0] as any | undefined
        return {
          config: {
            phases: agent ? [{ name: 'execute', agents: [agent.id], parallel: false, checkpoint: false, replanOnComplete: false }] : [],
            maxParallelAgents: 1, conflictStrategy: 'first-wins',
            replanAfterPhase: false, useWorktrees: false,
          },
          reasoning: `Fallback to single-agent (${reason})`,
          estimatedTokens: 10000,
          estimatedCostUsd: 0.03,
          agentGaps: [],
        }
      }

      // One isolated, tool-less call on the planning tiers through the
      // background model service — never a gateway-chosen provider. No
      // eligible model (e.g. a CLI that cannot run isolated calls yet) means
      // a single-agent proposal, with zero model calls.
      let result: AuxResult
      try {
        const aux = deps.aux
        result = aux
          ? await aux.complete({
            purpose: 'team_proposal',
            system: systemPrompt,
            user: userMessage,
            temperature: 0.2,
            ...(attribution?.conversationId ? { conversationId: attribution.conversationId } : {}),
          })
          : { ok: false, reason: 'no_eligible_provider' }
      } catch (err) {
        // The service never throws; an injected stand-in might.
        result = { ok: false, reason: 'error', error: { kind: 'other', message: String((err as Error)?.message ?? err) } }
      }

      if (!result.ok) {
        switch (result.reason) {
          case 'budget_stop':
            deps.bus?.emit('orchestrator.proposal_fallback', { reason: 'budget-stop' })
            return fallback('model budget exhausted')
          case 'error':
            deps.bus?.emit('orchestrator.proposal_fallback', { reason: 'model-error', message: result.error?.message ?? 'unknown' })
            return fallback(`model error: ${result.error?.message ?? 'unknown'}`)
          case 'empty':
            deps.bus?.emit('orchestrator.proposal_fallback', { reason: 'empty-response' })
            return fallback('planner returned no answer')
          default:
            deps.bus?.emit('orchestrator.proposal_fallback', { reason: 'no-eligible-model' })
            return fallback('no eligible background model')
        }
      }

      const text = result.text
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        deps.bus?.emit('orchestrator.proposal_fallback', { reason: 'no-json-in-response', textPreview: text.slice(0, 200) })
        return fallback('planner returned no JSON object')
      }

      let rawParsed: unknown
      try {
        rawParsed = JSON.parse(jsonMatch[0])
      } catch (err) {
        deps.bus?.emit('orchestrator.proposal_fallback', { reason: 'invalid-json', message: String((err as Error)?.message ?? err) })
        return fallback('planner produced invalid JSON')
      }

      const parsed = proposalSchema.safeParse(rawParsed)
      if (!parsed.success) {
        deps.bus?.emit('orchestrator.proposal_fallback', { reason: 'schema-mismatch', issues: parsed.error.issues })
        return fallback('planner JSON did not match schema')
      }

      const enabledIds = new Set(enabledAgents.map((a: any) => a.id))
      const phases: TeamPhase[] = parsed.data.phases.map(p => ({
        name: p.name,
        agents: p.agentIds.filter((id: string) => enabledIds.has(id)),
        parallel: p.parallel,
        checkpoint: p.checkpoint,
        replanOnComplete: p.replanOnComplete,
      }))

      const totalAgentSlots = phases.reduce((sum, p) => sum + p.agents.length, 0)
      const estimatedTokens = totalAgentSlots * parsed.data.estimatedTokensPerAgent
      const isComplex = complexity === 'complex' || complexity === 'epic'

      return {
        config: {
          phases,
          maxParallelAgents: 3,
          conflictStrategy: 'human-review',
          replanAfterPhase: isComplex,
          // Isolate parallel agents on complex+ work (not only epic).
          useWorktrees: complexity === 'complex' || complexity === 'epic',
        },
        reasoning: parsed.data.reasoning,
        estimatedTokens,
        estimatedCostUsd: estimatedTokens * 0.000003,
        agentGaps: parsed.data.agentGaps,
      }
    },

    /**
     * Execute a team configuration against a parent conversation.
     * Yields orchestrator events for real-time monitoring.
     *
     * `resumeFrom` (F2 T10) makes the loop re-drivable: phases before
     * `startAtPhase` are skipped entirely and members that already completed
     * inside the phase being re-entered are not re-run — both rejoin the
     * running totals and this phase's results from `preloadedResults`, so a
     * re-driven run reports the same totals a single-process run would.
     * Omitted, every path below behaves exactly as it did before.
     */
    async *executeTeam(
      config: TeamConfig,
      parentConversationId: string,
      goalDescription: string,
      teamSessionId: string,
      onProgress?: (e: RunAgentProgress) => void,
      resumeFrom?: ExecuteTeamResumeOptions,
    ): AsyncGenerator<OrchestratorEvent> {
      // Helper: emit a bus event scoped to this team session
      const emit = (event: string, data: unknown) =>
        deps.bus?.emit(`team:${teamSessionId}:${event}`, data)

      // Durability sinks — no-ops when the caller wired no team-session service
      // (or an older one), which is why every call site below is unconditional.
      const setCursor = (phaseIndex: number, phaseStatus: TeamPhaseStatus) =>
        deps.teamSessions?.setPhaseCursor?.(teamSessionId, phaseIndex, phaseStatus)
      const recordResult = (phaseIndex: number, result: TeamMemberResult) =>
        deps.teamSessions?.recordPhaseResult?.(teamSessionId, phaseIndex, result)

      const startAtPhase = Math.max(0, resumeFrom?.startAtPhase ?? 0)
      const preloadedResults = resumeFrom?.preloadedResults ?? []

      let totalTokens = 0
      let totalCostUsd = 0
      const planTasks: PlanTask[] = []

      // Build initial task list from phases
      for (const phase of config.phases) {
        for (const agentId of phase.agents) {
          planTasks.push({
            id: generateId(),
            title: `${phase.name}: ${agentId}`,
            agentId,
            phase: phase.name,
            status: 'pending',
          })
        }
      }

      for (let phaseIndex = 0; phaseIndex < config.phases.length; phaseIndex++) {
        const phase = config.phases[phaseIndex]
        const priorResults = preloadedResults[phaseIndex]?.agentResults ?? []

        // Already finished in an earlier process: its members are not re-run
        // and its events are not re-emitted (they are persisted already) —
        // only its spend rejoins the totals, keeping the final figure whole.
        if (phaseIndex < startAtPhase) {
          for (const prior of priorResults) {
            totalTokens += prior.tokensUsed
            totalCostUsd += prior.costUsd
          }
          continue
        }

        // Cursor first, event second: a consumer acting on the event (or a
        // crash right after it) must already find the cursor where it says.
        setCursor(phaseIndex, 'running')
        yield { type: 'phase_started', phase: phase.name, agents: phase.agents }

        const phaseResults: PhaseResult = { phaseName: phase.name, agentResults: [] }

        // EVERY prior attempt's spend rejoins the totals, whatever it ended as
        // — a member that burned tokens and then failed cost exactly what it
        // cost. This must match the skipped-phase branch above: when only the
        // carried members were counted here, each re-drive cycle silently
        // shrank the session's reported tokens and cost.
        for (const prior of priorResults) {
          totalTokens += prior.tokensUsed
          totalCostUsd += prior.costUsd
        }

        // Carried, i.e. NOT re-run: a member that completed (its work is done)
        // or one parked on an approval (externally owned — see the `parked`
        // note in runAgentInConversation). Everything else is retried.
        const carriedMembers = new Map<string, TeamMemberResult>()
        for (const prior of priorResults) {
          if (prior.status === 'completed' || prior.parked) carriedMembers.set(prior.agentId, prior)
        }
        for (const carried of carriedMembers.values()) {
          phaseResults.agentResults.push(carried)
        }
        const agentsToRun = phase.agents.filter(agentId => !carriedMembers.has(agentId))

        const worktreeOpts = config.useWorktrees
          ? { useWorktree: true, worktreeBasePath: config.worktreeBasePath }
          : undefined

        if (phase.parallel) {
          // Stream started/completed events as they arrive, bounded to
          // config.maxParallelAgents concurrent runs (a sliding window).
          // The exact member-result shape, not a hand-copied one: a local
          // duplicate silently drops fields the pool has to carry through
          // (it already lagged behind `costUsd`, and `parked` decides whether
          // a re-drive may re-run this member).
          type AgentResult = TeamMemberResult
          type PoolEvent =
            | { kind: 'started'; agentId: string }
            | { kind: 'completed'; agentId: string; result: AgentResult | null; error: Error | null }
          const queue: PoolEvent[] = []

          // Count-based signal so no wake-ups are lost if events land between
          // consecutive consumer iterations.
          let signalled = 0
          let drained = 0
          let wakeConsumer: (() => void) | null = null
          const push = (e: PoolEvent) => { queue.push(e); signalled++; wakeConsumer?.(); wakeConsumer = null }
          const waitForNext = () => (signalled > drained ? Promise.resolve() : new Promise<void>(resolve => { wakeConsumer = resolve }))

          // eslint-disable-next-line @typescript-eslint/no-this-alias
          const orchestratorSelf = this
          const cap = Math.max(1, config.maxParallelAgents ?? agentsToRun.length)
          const running: Promise<void>[] = []
          let launched = 0
          let finished = 0

          const launchMore = () => {
            while (launched < agentsToRun.length && launched - finished < cap) {
              const agentId = agentsToRun[launched++]
              push({ kind: 'started', agentId })
              running.push(
                orchestratorSelf.runAgentInConversation(
                  agentId,
                  parentConversationId,
                  goalDescription,
                  { ...worktreeOpts, teamSessionId, phase: phase.name, onProgress },
                ).then(
                  result => { finished++; push({ kind: 'completed', agentId, result, error: null }); launchMore() },
                  err => { finished++; push({ kind: 'completed', agentId, result: null, error: err as Error }); launchMore() },
                ),
              )
            }
          }
          launchMore()

          let completedCount = 0
          while (completedCount < agentsToRun.length) {
            if (queue.length > drained) {
              const ev = queue[drained++]
              if (ev.kind === 'started') {
                yield { type: 'agent_started', agentId: ev.agentId, conversationId: '', phase: phase.name }
              } else if (ev.result) {
                completedCount++
                phaseResults.agentResults.push(ev.result)
                recordResult(phaseIndex, ev.result)
                totalTokens += ev.result.tokensUsed
                totalCostUsd += ev.result.costUsd
                yield { type: 'agent_completed', agentId: ev.agentId, conversationId: ev.result.conversationId, status: ev.result.status }
                emit('agent_completed', { agentId: ev.agentId, status: ev.result.status, conversationId: ev.result.conversationId })
              } else {
                completedCount++
                const failure: TeamMemberResult = {
                  agentId: ev.agentId, conversationId: '', status: 'failed',
                  summary: ev.error?.message ?? 'Unknown error', tokensUsed: 0, costUsd: 0,
                }
                phaseResults.agentResults.push(failure)
                recordResult(phaseIndex, failure)
                yield { type: 'agent_completed', agentId: ev.agentId, conversationId: '', status: 'failed' }
                emit('agent_completed', { agentId: ev.agentId, status: 'failed', conversationId: '' })
              }
            } else {
              await waitForNext()
            }
          }
          await Promise.all(running)
        } else {
          // Run agents sequentially
          for (const agentId of agentsToRun) {
            yield { type: 'agent_started', agentId, conversationId: '', phase: phase.name }
            emit('agent_started', { agentId, phase: phase.name })
            try {
              const result = await this.runAgentInConversation(
                agentId,
                parentConversationId,
                goalDescription,
                { ...worktreeOpts, teamSessionId, phase: phase.name, onProgress },
              )
              phaseResults.agentResults.push(result)
              recordResult(phaseIndex, result)
              totalTokens += result.tokensUsed
              totalCostUsd += result.costUsd
              yield {
                type: 'agent_completed',
                agentId,
                conversationId: result.conversationId,
                status: result.status,
              }
              emit('agent_completed', { agentId, status: result.status, conversationId: result.conversationId })
            } catch (err: any) {
              const failure: TeamMemberResult = {
                agentId,
                conversationId: '',
                status: 'failed',
                summary: err.message ?? 'Unknown error',
                tokensUsed: 0,
                costUsd: 0,
              }
              phaseResults.agentResults.push(failure)
              recordResult(phaseIndex, failure)
              yield { type: 'agent_completed', agentId, conversationId: '', status: 'failed' }
              emit('agent_completed', { agentId, status: 'failed', conversationId: '' })
            }
          }
        }

        yield { type: 'phase_completed', phase: phase.name, results: phaseResults }

        // Adaptive re-planning
        if (phase.replanOnComplete && config.replanAfterPhase) {
          const remaining = planTasks.filter(t => t.status === 'pending')
          const replanResult = await rePlanner.replan(goalDescription, phaseResults, remaining, { conversationId: parentConversationId })
          yield { type: 'replan_result', result: replanResult }

          if (!replanResult.shouldContinue) {
            yield { type: 'team_failed', error: 'Re-planner decided to stop execution' }
            return
          }

          // Apply plan mutations
          for (const removed of replanResult.tasksRemoved) {
            const task = planTasks.find(t => t.id === removed)
            if (task) task.status = 'removed'
          }
          for (const added of replanResult.tasksAdded) {
            planTasks.push({ ...added, status: 'pending' })
          }
        }

        // Checkpoint: pause for human approval via TeamSessionService
        if (phase.checkpoint && deps.teamSessions) {
          // Recorded BEFORE the event so a process that dies at the gate is
          // found waiting at it — the boot scan parks such a session for the
          // operator rather than driving past an unanswered approval.
          setCursor(phaseIndex, 'awaiting_checkpoint')
          yield {
            type: 'checkpoint',
            phase: phase.name,
            message: `Phase "${phase.name}" completed. Approve to continue?`,
          }
          await deps.teamSessions.pause(teamSessionId)
        }

        // The phase (and its gate, if any) is behind us: a re-drive from here
        // starts at the NEXT phase. See resumePhaseIndex.
        setCursor(phaseIndex, 'done')
      }

      yield { type: 'team_completed', totalTokens, totalCostUsd }
    },

    /**
     * Run a single agent in a child conversation.
     */
    async runAgentInConversation(
      agentId: string,
      parentConversationId: string,
      goalDescription: string,
      options?: {
        useWorktree?: boolean
        worktreeBasePath?: string
        teamSessionId?: string
        phase?: string
        onProgress?: (e: RunAgentProgress) => void
      },
    ) {
      const agent = agentRegistry.get(agentId)
      if (!agent) throw new Error(`Agent not found: ${agentId}`)

      const parentConv = typeof conversations.get === 'function'
        ? conversations.get(parentConversationId)
        : null
      // Create the member's child conversation. It follows the member's own
      // model; the lead's current model is stored as its pair (H4).
      const lead = leadBinding(parentConv)
      const childConv = conversations.create({
        userId: 'system',
        title: `${agent.name}: ${goalDescription.slice(0, 50)}`,
        modelBinding: 'inherit',
        ...(lead ? { providerId: lead.providerId, modelId: lead.modelId } : {}),
      })
      const parentDirs = parentConv?.workingDirectories ?? []
      conversations.update(childConv.id, {
        parentConversationId,
        agentId,
        mode: 'managed',
        goalDescription,
        workingDirectories: parentDirs.length ? [...parentDirs] : null,
        // F0 — plain create() leaves project_id NULL, so team members were
        // invisible to every project-scoped resolver. createSubConversation
        // inherits it; this path does not, so set it explicitly.
        // `?? undefined`, not `?? null`: ConversationUpdate.projectId is
        // `string | undefined` and the field map has no presence:'in' entry,
        // so undefined means "not supplied" and the column keeps its NULL.
        projectId: parentConv?.projectId ?? undefined,
        ...(options?.teamSessionId != null ? { teamSessionId: options.teamSessionId } : {}),
      })

      // The child conversation now exists — announce the node with its REAL id.
      const nodePhase = options?.phase ?? ''
      options?.onProgress?.({ kind: 'node_started', conversationId: childConv.id, agentId, phase: nodePhase })

      // The member's model (H4, model/binding.ts): its own provider+model,
      // else the lead's (stored on its conversation above), else the install
      // default, fixed on the conversation. Provider and model come from one
      // binding; no provider is ever preferred by name. A binding nothing can
      // serve throws: the member fails like any other run failure.
      // A member's conversation is never Auto-routed: no triage, no await.
      const run = resolveRunBindingStatic({
        resolver: deps.modelBinding,
        conversation: {
          id: childConv.id,
          modelBinding: 'inherit',
          providerId: lead?.providerId ?? null,
          modelId: lead?.modelId ?? null,
          agentId,
          parentConversationId,
        },
        agent,
        text: goalDescription,
        materialize: (id, pair) => conversations.materializeBinding?.(id, pair.providerId, pair.modelId) ?? null,
      })
      const provider = run.providerId
      const model = run.modelId

      // Get tools for this agent. The member runs in its own child
      // conversation, which is created without an orchestration mode (auto).
      const toolDefs = scopedToolDefinitions(toolRegistry, resolveToolScope({ agentTools: agent.tools }))

      // F1 Task 5 (R7): revive team-memory injection for team-orchestrated
      // subagent runs. Entries are agent-authored, forgeable data (writable
      // via the team-memory POST route / write_team_memory tool) —
      // injectTeamMemory wraps them in a framed, tag-escaped <team-context>
      // block so a hostile entry can neither pose as an instruction nor
      // forge its own closing tag.
      const teamContext = options?.teamSessionId
        ? (deps.teamSessions?.injectTeamMemory?.(options.teamSessionId, agent.role) ?? '')
        : ''

      // Legacy string (fallback when no assembler): identity+constraints+team-context inline.
      const systemPrompt = [
        agent.systemPrompt,
        agent.constraints.length > 0
          ? `\nConstraints:\n${agent.constraints.map(c => `- ${c}`).join('\n')}`
          : '',
        teamContext,
      ].join('\n')

      // v2: assemble the full prompt; preserve per-agent constraints (and any
      // team context) by adding them as reminders (reminders are appended
      // after prefix+suffix by the runner).
      let assembledPrompt: import('@modules/prompt-wizard/types').AssembledPrompt | undefined
      // The turn block when the prompt could not be assembled (string
      // fallback): the member still gets the clock and its recall.
      let turnOnly: import('@modules/prompt-wizard/assembler').TurnOnly | undefined
      if (deps.promptAssembler) {
        try {
          const parentProjectId = conversations.get(parentConversationId)?.projectId ?? null
          const base = await deps.promptAssembler.buildForPrimary({
            agentId,
            agentName: agent.name,
            conversationId: childConv.id,
            projectId: parentProjectId,
            channelContext: null,
            // I7: sized for the model this member calls. The runner reads
            // base.turn (clock + recall) and base.delivery from systemPrompt.
            target: { providerId: provider ?? null, modelId: model ?? null },
            // The member's message is its goal; recall's query starts there.
            turnText: goalDescription,
          })
          const constraintReminder =
            agent.constraints.length > 0
              ? `Constraints:\n${agent.constraints.map(c => `- ${c}`).join('\n')}`
              : null
          const extraReminders = [constraintReminder, teamContext || null].filter(
            (r): r is string => r != null,
          )
          assembledPrompt = extraReminders.length > 0
            ? { ...base, reminders: [...base.reminders, ...extraReminders] }
            : base
        } catch {
          console.warn('prompt-assembler build failed on team run; using system-string fallback')
          assembledPrompt = undefined // fail soft — string fallback still applies
          turnOnly = await deps.promptAssembler.buildTurnOnly?.({
            conversationId: childConv.id,
            target: { providerId: provider ?? null, modelId: model ?? null },
            turnText: goalDescription,
          }).catch(() => undefined)
        }
      }

      // Create git worktree for isolation if requested — only when the
      // primary working directory is a git repo. Never fall back to process.cwd().
      let worktree: WorktreeInfo | undefined
      const basePath = options?.worktreeBasePath ?? parentDirs[0]
      if (options?.useWorktree && basePath && isGitRepo(basePath)) {
        worktree = createWorktree(basePath, agentId)
      }
      const writeRoots = worktree
        ? [worktree.path, ...parentDirs.slice(1)]
        : parentDirs

      // Supervise this member run (F2 T4 / D1): an agent_sessions row (kind
      // 'team'), whose sessionId activates the runner's checkpoint + event-
      // store capture, and whose AbortSignal is threaded into the runner call
      // below so an operator cancel (Mission Control) aborts THIS member —
      // mirrors runConversation's supervision (conversation-runner.ts).
      const handle = deps.supervisor?.beginRun({
        sessionId: generateId(),
        conversationId: childConv.id,
        agentId,
        kind: 'team',
      })

      // The member's brief is only a message in the model call, never a
      // stored row: remember it (once per brief) as the orchestrating
      // agent's text.
      conversations.captureInstruction?.({
        conversationId: childConv.id,
        text: goalDescription,
        author: 'agent',
        entryPath: 'team',
        sessionId: handle?.sessionId ?? null,
      })

      // Run agent
      let tokensUsed = 0
      let turns = 0
      // F2 T9 (R2/R3) — sourced ONLY from this member's own turn_complete
      // events, mirroring conversation-runner's rollup (never from ai_traces).
      const costAcc = createCostAccumulator()
      let costUsd = 0
      let lastMessage = ''
      const toolNames: string[] = []
      // D6 — how the loop ended, mirrored from runConversation so complete()
      // resolves the right terminal status.
      let outcome: 'max_turns' | 'tool_budget' | undefined
      let cancelled = false
      // F2 T5 — the member run stopped on an escalation and is parked on this
      // approval. It is not finished, so the phase result must not read as one.
      let parkedApprovalId: number | undefined
      // Whether the supervisor ACTUALLY parked the run. park() refuses a row
      // that is no longer 'running', and there may be no supervisor at all —
      // the card status and the worktree retention below must key on the real
      // outcome, not on the mere intent to park.
      let parked = false
      const messages = [{ role: 'user' as const, content: goalDescription }]

      // Task 11 — record what actually reached the model for this member.
      // Assembled sections when the assembler ran; otherwise a single
      // raw-system section, same shape as executeAgent's unassembled path.
      const compositionId = deps.contextRecorder?.record({
        sections: assembledPrompt
          ? assembledPrompt.sections
          : [
              ...(systemPrompt ? [{
                zone: 'append' as const, key: 'raw-system', content: systemPrompt,
                chars: systemPrompt.length, estimatedTokens: estimateTokens(systemPrompt),
                truncated: false, droppedChars: 0,
              }] : []),
              ...(turnOnly?.sections ?? []),
            ],
        entryPoint: assembledPrompt ? 'orchestrator-member' : 'unassembled',
        conversationId: childConv.id,
        agentId,
        provider,
        model,
        prefixHash: assembledPrompt?.prefixHash ?? null,
        // An unassembled member still records what its turn block delivered.
        ...deliveryRecordFields(assembledPrompt?.delivery ?? turnOnly?.delivery),
        historyEstimatedTokens: estimateMessagesTokens(messages),
      }) ?? null

      try {
        // What the provider measures on the member's last model call goes to
        // its composition (context occupancy), however the run ends.
        for await (const event of observeRunEvents(agentRunner.run({
          messages,
          tools: toolDefs,
          system: systemPrompt,
          systemPrompt: assembledPrompt,
          ...(turnOnly?.turn ? { turn: turnOnly.turn } : {}),
          maxTurns: agent.maxTurns ?? 20,
          provider,
          model,
          // The member's effort (effort-intent.ts): the member agent's own,
          // else the lead conversation's (inherited up the parent chain).
          // Read from the child's stored row, the same way runConversation
          // reads it on a resume, so a first run and its resume send the
          // same intent. A corrupted value (not a ladder rung) is skipped,
          // never guessed into a level; the gateway resolves it per model.
          effort: loadEffortIntent(
            { db: deps.db, getAgent: (id) => agentRegistry.get(id) },
            childConv.id,
            { agentId },
          ),
          toolContext: {
            conversationId: childConv.id,
            userId: 'system',
            agentId,
            parentGoal: goalDescription,
            logger: console as any,
            ...toolWorkspaceFields(writeRoots),
            // Inside a team run the team session IS the messaging session —
            // the agent-messaging tools (post_to_agent, read_team_memory, ...)
            // key on ctx.sessionId / ctx.teamSessionId.
            teamSessionId: options?.teamSessionId,
            sessionId: options?.teamSessionId,
            agentRole: agent.role,
          },
          // F0 R4 — team-orchestrated subagent runs are unattended.
          autonomous: true,
          metadata: {
            conversationId: childConv.id,
            userId: 'system',
            agentId,
            teamSessionId: options?.teamSessionId,
            origin: 'team' as const,
            autonomous: true,
            compositionId: compositionId ?? undefined,
          },
          signal: handle?.signal,
          sessionId: handle?.sessionId,
        }), deps.contextRecorder, compositionId)) {
          if (event.type === 'turn_complete') {
            tokensUsed += event.tokensUsed
            turns++
            costAcc.addTurn((event as any).usage ?? { inputTokens: 0, outputTokens: 0 })
            options?.onProgress?.({ kind: 'node_progress', conversationId: childConv.id, turn: event.turn, tokens: event.tokensUsed, phase: nodePhase })
          }
          if (event.type === 'tool_use_start') toolNames.push((event as any).name)
          if (event.type === 'done') {
            const text = (event.response.content.find((b) => b.type === 'text') as { text?: string } | undefined)?.text
            if (text) lastMessage = text
            // D6 — how the member's loop ended: the runner's single terminal.
            outcome = supervisorOutcomeOf(event.outcome)
          }
          if (event.type === 'cancelled') cancelled = true
          if (event.type === 'parked_for_approval') parkedApprovalId = (event as any).approvalId
          handle?.progress()
        }

        // F2 T5 — a parked member waits on an operator, so its run row must
        // stay open ('waiting_approval', no completed_at) for Task 6 to resume;
        // complete() here would finalize it. The worktree is also left unmerged
        // (same reasoning as the cancelled case below): the member's edits are
        // mid-flight, not finished work. A park the supervisor refuses (row no
        // longer 'running') still closes the run normally — the member result
        // below reports it unfinished either way.
        parked = parkedApprovalId !== undefined && handle?.sessionId
          ? deps.supervisor?.park?.(handle.sessionId, parkedApprovalId) === true
          : false
        // F2 T9 (R3) — resolved off the member's own provider/model selection.
        // Computed regardless of parked status: the team total (below) counts
        // a parked member's partial spend exactly as it already does for
        // tokensUsed; only the WRITE to this run's own row/conversation is
        // gated on `!parked` (same scoping turns_used already had).
        costUsd = costAcc.finalize(provider, model, deps.pricingOverrides)
        if (!parked) {
          handle?.complete({ toolCalls: toolNames, turns, outcome, tokensUsed, costUsd })
          conversations.addRunCost?.(childConv.id, { tokens: tokensUsed, costUsd })
        }

        // After execution: merge worktree changes back. Fix round 1 /
        // Important 2 — a cancelled run (operator cancel or the stuck sweep)
        // reaches this same post-loop path, since handle.complete() precedes
        // it unconditionally; merging here would land the cancelled member's
        // partial (possibly mid-edit) commits on the base branch. Skip it —
        // the worktree (and its branch) is still removed in the finally
        // block below, so nothing is left dangling, it's just never merged.
        // A parked member is in exactly that position: its work is paused
        // mid-flight pending an approval, so it must not merge either.
        if (worktree && !cancelled && parkedApprovalId === undefined) {
          const mergeResult = mergeWorktree(basePath, worktree)
          if (!mergeResult.success) {
            conversations.addMessage(childConv.id, {
              role: 'assistant',
              content: `Merge conflict when integrating worktree changes: ${mergeResult.conflicts}`,
              entryPath: 'team',
            })
          }
        }
      } catch (err: any) {
        handle?.fail(String(err?.message ?? err))
        throw err
      } finally {
        // Cleanup worktree — EXCEPT for a parked member: its uncommitted edits
        // are exactly what the resume (Task 6) continues from, so destroying
        // them here would make the approval pointless. Retained worktrees are
        // also untracked, or the shutdown handler would delete them anyway.
        if (worktree) {
          if (parked) {
            retainWorktree(worktree)
            // F2 T6 (R6) — untracking it removes the LAST in-process pointer to
            // it, so the run row has to carry one: the resume/cancel paths read
            // this marker to reclaim the worktree instead of leaking it.
            if (handle?.sessionId) {
              deps.supervisor?.recordRetainedWorktree?.(handle.sessionId, { path: worktree.path, branch: worktree.branch, basePath })
            }
          } else {
            removeWorktree(basePath, worktree)
          }
        }
      }

      // Update child conversation status. A parked member's card follows its
      // run into 'waiting_approval' (D6) — 'idle' would invite the board's
      // stage automation to re-arm a card whose run is mid-approval. Keyed on
      // the REAL park: a refused park leaves a finished run, and marking its
      // card unarmable would wedge it with nothing to wake it.
      conversations.update(childConv.id, { status: parked ? 'waiting_approval' : 'idle' })

      // The durable-fact pass (F1) on the brief and the member's answer,
      // through the entry every run path shares (memory/capture/run-end.ts):
      // the same gate, cap and run row as an interactive turn. The brief is
      // the orchestrating agent's text, never the owner's (as its L0 row above).
      captureRunEnd(deps.memoryCapture, {
        conversationId: childConv.id,
        projectId: parentConv?.projectId ?? null,
        userMessage: goalDescription,
        assistantMessage: lastMessage,
        author: 'agent',
        entryPath: 'team',
      })

      // Track token usage — routed through the budget engine (when wired) so
      // crossing a threshold band emits eyas.agent.budget.alert; falls back
      // to the bare registry write so tests/tools that don't wire one work.
      if (budgetEngine) budgetEngine.trackUsage(agentId, tokensUsed)
      else agentRegistry.addTokenUsage(agentId, tokensUsed)

      // Member status is now REAL (D1): a max_turns outcome or a cancelled
      // member did NOT deliver a finished result, so phase-result consumers
      // must see 'failed' even though the DB row's own terminal status (D6)
      // stays the distinct 'max_turns'/'cancelled'/'waiting_approval' state.
      // F2 T5 — a parked member is likewise NOT finished, so the re-planner
      // sees an unfinished member. F2 T10 draws the one distinction that
      // matters for a restart: an unfinished member is normally RETRIED by a
      // re-drive, but a parked one must not be — it is externally owned (its
      // continuation belongs to the approval-resume flow, and its child run,
      // approval and retained worktree are all still live). The `parked` flag
      // below carries exactly that, and is persisted as its own row status.
      const memberFailed = cancelled || outcome === 'max_turns' || parkedApprovalId !== undefined
      const summary = parkedApprovalId !== undefined
        ? `[parked for approval #${parkedApprovalId}] ${lastMessage}`.slice(0, 200)
        : outcome === 'max_turns'
          ? `[max_turns reached] ${lastMessage}`.slice(0, 200)
          : cancelled
            ? `[cancelled] ${lastMessage}`.slice(0, 200)
            : lastMessage.slice(0, 200)

      return {
        agentId,
        conversationId: childConv.id,
        status: memberFailed ? 'failed' as const : 'completed' as const,
        summary,
        tokensUsed,
        costUsd,
        // Keyed on the escalation itself, NOT on whether the supervisor
        // accepted the park (`parked` above): the approval exists either way,
        // so re-running the member would orphan it either way. This keeps the
        // marker in lockstep with the '[parked for approval #N]' summary.
        ...(parkedApprovalId !== undefined ? { parked: true } : {}),
      }
    },
  }
}
