// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type {
  ModelGateway,
  ModelMessage,
  ModelResponse,
  StreamEvent,
  ToolDefinition,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
  EffortIntent,
  OrchestrationMode,
  ModelRequestMetadata,
  ModelUsage,
  StopReason,
} from '@modules/model/types.js'
import { canonicalToolName, normalizeToolInput } from '@shared/canonical-tool-name.js'
import type { Logger } from 'pino'
import { isAutonomousRequest } from '@modules/model/permission-bridge.js'
import { classifyModelError } from '@shared/classify-model-error.js'
import { toolsetDenial, type createToolExecutor } from '@modules/tools/tool-executor.js'
import type { ToolContext } from '@modules/tools/types.js'
import { folderRefusedNotice, screenToolWorkspaceFields, workspaceFromContext } from '@modules/tools/working-directories.js'
import type { AssembledPrompt } from '@modules/prompt-wizard/types.js'
import { profileMatchesRun, type DeliveryProfile } from '@modules/prompt-wizard/delivery-profile.js'
import { attachTurnContext, stripTurnContext } from '@modules/prompt-wizard/assemble-system.js'
import type { EventStore } from '@modules/event-store/event-store.js'
import { EventTypes, type ReplayMessage } from '@modules/event-store/types.js'
import type { CheckpointAPI, CheckpointState } from '@modules/agent/checkpoint'
import { argHash, toolArgHash, toolLedgerKey } from './arg-hash.js'
import { generateId } from '@shared/crypto.js'
import { isParallelRoutingTool, orderToolUsesForTurn } from './parallel-routing.js'
import { outcomeOfStopReason, type RunOutcome } from './run-outcome.js'
import { runTreeScopeOf, withRunTree } from './run-tree.js'
import type { OrchestrationSink } from '@shared/orchestration-events.js'
import type { PricingTable } from '@shared/model-pricing.js'
import type { RequestOrigin } from '@modules/model/types.js'
import type { CaptureEntryPath } from '@modules/memory/v2/ingest-bridge.js'
import type { RunCapture, RunCaptureStart } from '@modules/memory/v2/run-capture.js'

export type { RunOutcome } from './run-outcome.js'

/** The folders a tool call works in, for the security gate (undefined = unknown). */
function gateWorkingDirectories(toolContext: ToolContext | undefined): string[] | undefined {
  const ws = workspaceFromContext(toolContext)
  return ws.ok ? ws.roots : undefined
}

// ─── Agent Events ─────────────────────────────

/**
 * What the runner yields. Every run ends in EXACTLY ONE terminal: 'done',
 * 'cancelled', 'parked_for_approval' — or a throw (a gateway 'error' frame is
 * turned into that throw, never forwarded).
 */
export type AgentEvent =
  // The stream contract (G1) minus the two the runner owns: 'done' becomes the
  // run's terminal below, and a failure is one throw. tool_result carries its
  // outcome and executedBy — one shape for the runner's own executor and for
  // provider-executed tools; approval_required marks a call waiting on a human.
  | Exclude<StreamEvent, { type: 'done' } | { type: 'error' }>
  // `response` is the run's LAST model response, as the gateway returned it:
  // its effortOutcome (requested vs effective effort of that call) is what a
  // caller records with the reply (conversations/turn-meta.ts turnEffortOf).
  | { type: 'done'; response: ModelResponse; outcome: RunOutcome; stopReason: StopReason }
  // F2 T9 (R2) — `usage` is additive: it carries what the response.usage had
  // (cache tokens / a CLI-authoritative costUsd, when the provider supplies
  // them) so a run's rollup can price the run without re-deriving it from
  // ai_traces (which must never back a rollup — critic/judge calls pollute
  // it). Consumers that only read `tokensUsed` (the pre-existing combined
  // input+output scalar) are unaffected.
  // provider/model: the pair that ANSWERED this model call (its response), so
  // a consumer can attribute what the call produced (the run's L0 capture).
  | { type: 'turn_complete'; turn: number; tokensUsed: number; usage?: ModelUsage; provider?: string; model?: string }
  // A judge malfunction: in 'enforcing' mode the call is then refused (its
  // tool_result says 'denied'); in 'permissive' mode it runs anyway, and this
  // warning is the only trace of that.
  | { type: 'security_gate_error'; toolName: string; mode: 'enforcing' | 'permissive'; reason: string }
  // Cap 3 — the run was cancelled via an AbortSignal (operator cancel, stuck
  // recovery, or shutdown). Terminal: the generator returns after yielding it.
  | { type: 'cancelled'; reason: string }
  // F2 T5 (D2) — durable park. An AUTONOMOUS + SUPERVISED run that needs a
  // human decision stops here instead of denying-and-continuing: the approval
  // is already queued, and the consumer (conversation-runner / executeAgent /
  // orchestrator) parks the run on `approvalId` so Task 6 can resume it.
  // TERMINAL: the generator returns right after yielding it — no 'done'.
  | { type: 'parked_for_approval'; approvalId: number; toolName: string }

/**
 * A tool the provider's own runtime executed (a CLI-native tool such as
 * Claude Code's Bash) — see AgentRunnerDeps.recordExternalToolExecution.
 */
export interface ExternalToolExecution {
  toolUseId: string
  /** Canonical name (Bash → run_command). */
  toolName: string
  /** The provider's own name, when it differs from the canonical one. */
  rawName?: string
  /** The input as the provider reported it, normalized (file_path → path). */
  input: Record<string, unknown>
  /** The tool's output (or error text) as the provider reported it. */
  output: string
  success: boolean
  durationMs: number
  conversationId?: string
  agentId?: string
  /** The supervised run (agent_sessions.id), when there is one. */
  runId?: string
  turnId?: string
}

// ─── Options ──────────────────────────────────

export interface AgentRunOptions {
  messages: ModelMessage[]
  tools: ToolDefinition[]
  system?: string
  /**
   * v2 prompt entry point. When provided, the runner flattens it to a string
   * (prefix + suffix + reminders, joined with blank lines) and passes the
   * resulting string to the v1 gateway as `system`. Takes precedence over
   * `system?: string` if both are set. Wired in Task 29 bootstrap.
   */
  systemPrompt?: AssembledPrompt
  /**
   * What the answering model can take (prompt-wizard/delivery-profile.ts).
   * Defaults to systemPrompt.delivery.profile. Honoured only when it describes
   * this run's provider/model: supportsTools false → no tools are sent and a
   * returned tool_use is not executed; a resolved window goes out as
   * request.contextWindow.
   */
  delivery?: DeliveryProfile
  /**
   * The per-message turn block (prompt-wizard assembler: the clock and what
   * EYAS recalled for this message). Defaults to systemPrompt.turn. Attached
   * once, before the loop, to the current user message of the copy the
   * provider is sent (attachTurnContext) — never to the caller's messages, so
   * the stored conversation is unchanged. Checkpoints keep the history
   * without it; a resumed run gets a fresh one.
   */
  turn?: string
  maxTurns: number
  provider?: string
  model?: string
  /**
   * The effort intent for every model call of this run (reasoning/intent.ts
   * pickEffortIntent). Forwarded unchanged; the gateway resolves it per
   * attempt against the model that answers.
   */
  effort?: EffortIntent
  orchestration?: OrchestrationMode
  toolContext?: ToolContext
  conversationId?: string
  /** Metadata passed through to provider (e.g. MCP bridge context) */
  metadata?: ModelRequestMetadata
  onTurnComplete?: (turn: number, response: ModelResponse) => void
  /**
   * Max tool_use blocks executed per assistant turn. Excess blocks are skipped
   * with a synthetic tool_result explaining the truncation. Default: 10.
   */
  maxToolCallsPerTurn?: number
  /**
   * Absolute cap on tool calls across the entire run. When reached, the
   * remaining calls are skipped and the run ends with outcome 'tool_budget'.
   * Default: 200.
   */
  maxTotalToolCalls?: number
  /**
   * Controls how judge_error decisions are treated:
   * - 'enforcing' (default): treat as deny, block the tool call.
   * - 'permissive': allow the tool call, emit a WARN event. Not recommended in production.
   */
  securityGateMode?: 'enforcing' | 'permissive'
  /**
   * Marks this as an AUTONOMOUS run (proactive/scheduled), with no human in the
   * loop directing it. Only autonomous runs are gated by the graduated-autonomy
   * ladder; interactive runs (default) are governed by the security gate +
   * approval-mode, with the user themselves as the approver.
   */
  autonomous?: boolean
  /**
   * Cancellation signal. Checked at turn and tool boundaries; when aborted the
   * runner yields a terminal 'cancelled' event and stops. Wired by the
   * RunSupervisor (operator cancel / stuck recovery / shutdown).
   */
  signal?: AbortSignal
  /**
   * Cap 3 keystone — correlation id for run-event capture + checkpointing.
   * This is the supervisor / event-store session id (== agent_sessions.id),
   * NOT the Claude Code SDK provider session. When absent, all persistence is
   * skipped (the runner stays a pure tool-use loop). Persistence is fail-open:
   * an event-store / checkpoint error never aborts a run.
   */
  sessionId?: string
  /**
   * Cap 3 keystone (warm-resume) — a bounded do-not-repeat / do-not-resend
   * recap (from buildTaskStateReinjection) appended to the system prompt so a
   * resumed model is re-grounded in what it already did.
   */
  reinjection?: string
  /**
   * Cap 3 keystone (warm-resume) — idempotency ledger of toolLedgerKey entries
   * (canonical name + normalized argHash) for DESTRUCTIVE tool calls already
   * executed on the original run. A matching call is hard-skipped (synthetic
   * result, outcome 'skipped') so a resume can never re-fire a side effect.
   * It also goes out as metadata.idempotencyLedger: a CLI provider runs its
   * tools itself, and its permission bridge refuses the repeat there.
   * Non-destructive repeats are not in the ledger (advisory recap only). The
   * security gate still runs for every call.
   */
  idempotencyLedger?: ReadonlySet<string>
  /**
   * How this run entered EYAS — memory provenance only (L0 meta, the
   * LlmResponse event). Absent: derived from metadata.origin.
   */
  entryPath?: CaptureEntryPath
}

// ─── Dependencies ─────────────────────────────

interface AgentRunnerDeps {
  gateway: ModelGateway
  /**
   * Runs each tool call. Only execute(): the native loop's tool_result goes
   * back through the gateway, whose egress filter masks memory-bearing
   * results per destination — renderForModel is for transports outside it.
   */
  toolExecutor: Pick<ReturnType<typeof createToolExecutor>, 'execute'>
  /**
   * Cap 3 keystone — optional append-only run-event log. When supplied together
   * with options.sessionId, the runner records a replayable trace (ToolCall /
   * ToolResult / LlmResponse) for resume + audit. All writes are best-effort
   * (fail-open): a store error is swallowed so it never aborts a live run.
   */
  eventStore?: EventStore
  /**
   * Cap 3 keystone — optional checkpoint API. When supplied with
   * options.sessionId, the runner captures a checkpoint at each clean turn
   * boundary whose policy fires, stashing the FULL ModelMessage[] in
   * CheckpointState.meta.modelMessages for lossless resume. Fail-open.
   */
  checkpoint?: CheckpointAPI
  securityGate?: {
    validateToolCall(
      toolName: string,
      input: Record<string, unknown>,
      ctx?: { conversationId?: string; agentId?: string; parentGoal?: string; workingDirectories?: readonly string[] },
    ): Promise<{ decision: string; reason: string; riskTier: string }>
  }
  /**
   * Optional Phase-3F approval-tier policy. When supplied, every security-gate
   * approved tool call is additionally routed through `approvalPolicy.decide()`.
   * If the decision is 'approve', the runner pauses the call until
   * `onApprovalRequired` resolves true; absent a callback we fail closed.
   *
   * Default (unset): behaves as autopilot — no extra checks, current runner
   * behaviour unchanged.
   */
  approvalPolicy?: {
    decide(
      toolName: string,
      riskTier: 'green' | 'yellow' | 'red',
      ctx?: { userId?: string; modeOverride?: 'paranoid' | 'balanced' | 'autopilot' },
    ): { action: 'auto' | 'approve'; reason: string; requiresPreview?: boolean }
  }
  onApprovalRequired?: (req: {
    toolName: string
    input: Record<string, unknown>
    riskTier: 'green' | 'yellow' | 'red'
    reason: string
    requiresPreview: boolean
    conversationId?: string
    agentId?: string
  }) => Promise<boolean>
  /**
   * Optional graduated-autonomy policy. When supplied, a tool that maps to an
   * autonomy category at level < 3 (L1 notice / L2 propose) requires human
   * approval (same fail-closed flow as approvalPolicy); level 3 runs
   * autonomously. Tools that map to no category are not autonomy-gated.
   * Default (unset): no autonomy gating — runner behaviour unchanged.
   */
  autonomyPolicy?: {
    categoryForTool(toolName: string, riskTier?: 'green' | 'yellow' | 'red'): string | null
    resolve(category: string): { level: 1 | 2 | 3; locked: boolean; maxLevel: 1 | 2 | 3 }
    createApproval(input: {
      category: string
      toolName?: string
      agentId?: string
      conversationId?: string
      reason?: string
      preview?: string
      inputJson?: string
      argHash?: string
      runId?: string
      expiresAt?: string
    }): number
    /** D4 grant ledger — see autonomy-policy.ts consumeGrant(). Optional so older gate stubs stay valid. */
    consumeGrant?(input: { conversationId: string; toolName: string; argHash: string; now?: string }): { granted: boolean; approvalId?: number }
    /** D5 — the TTL-stamped expiry a fresh escalation should carry. Optional so older gate stubs stay valid. */
    defaultExpiresAt?(now?: string): string
  }
  /**
   * Optional — logs 'gate:grant_consumed' when a prior approval authorizes a
   * repeat call, and (F2 T5) why a park was skipped / what a park left behind.
   */
  logger?: Pick<Logger, 'info' | 'warn' | 'debug'>
  /**
   * A tool the provider's runtime executed itself (tool_result executedBy
   * 'provider', seen inside gateway.stream): the EYAS executor never ran it,
   * so this is how it reaches tool_executions (G12 wires the executor's
   * recordExternal). Bridged EYAS tools (executedBy 'eyas') are not passed —
   * the executor already logged them. Best-effort: a failure is logged only.
   */
  recordExternalToolExecution?: (entry: ExternalToolExecution) => void | Promise<void>
  /**
   * G6 — the run tree's sink (ctx.orchestration), read once per run. A run
   * with a conversation emits its tree there, for every provider: see
   * run-tree.ts. Absent: no tree. Sink errors are swallowed.
   */
  getOrchestrationSink?: () => OrchestrationSink | undefined
  /** config.model.pricing — prices the run's cost on its run_completed frame. */
  pricingOverrides?: PricingTable
  /**
   * The L0 capture of a run with a conversation (memory/v2/run-capture.ts):
   * fed every event the run yields, whatever the provider, and ended however
   * the run ends. The memory switches decide what it keeps. Absent: none.
   */
  startRunCapture?: (run: RunCaptureStart) => RunCapture | null | undefined
}

// ─── Helpers ──────────────────────────────────

function flattenAssembledPrompt(p: AssembledPrompt): string {
  const parts = [p.prefix, p.suffix, ...p.reminders].filter((s) => s.trim())
  return parts.join('\n\n')
}

/** The text of a response, joined — what a CLI turn's checkpoint keeps of the answer. */
function textOf(content: readonly ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

function previewOf(input: unknown): string {
  try { return (JSON.stringify(input) ?? '').slice(0, 200) } catch { return '' }
}

/** A provider-reported tool call opened by tool_use_start and not yet settled. */
interface OpenProviderTool {
  name: string
  rawName?: string
  input: Record<string, unknown>
}

/** The entry path a request origin stands for, when the caller named none. */
const ENTRY_PATH_OF_ORIGIN: Record<RequestOrigin, CaptureEntryPath> = {
  interactive: 'interactive',
  scheduled: 'background',
  channel: 'channel',
  pipeline: 'pipeline',
  team: 'team',
  delegation: 'delegation',
}

function entryPathOf(options: Pick<AgentRunOptions, 'entryPath' | 'metadata'>): CaptureEntryPath | null {
  const origin = options.metadata?.origin
  return options.entryPath ?? (origin ? ENTRY_PATH_OF_ORIGIN[origin] : undefined) ?? null
}

/** Feed every event of a run to its L0 capture, and end it however the run ends. */
async function* withRunCapture(events: AsyncGenerator<AgentEvent>, capture: RunCapture): AsyncGenerator<AgentEvent> {
  try {
    for await (const event of events) {
      capture.observe(event)
      yield event
    }
  } finally {
    capture.end()
  }
}

// ─── Runner ───────────────────────────────────

export function createAgentRunner(deps: AgentRunnerDeps) {
  const { gateway, toolExecutor } = deps

  const loop = {
    /**
     * Core tool-use loop: send → get tool_use → execute → send result → repeat.
     * Yields events for real-time streaming to the UI.
     */
    async *run(options: AgentRunOptions): AsyncGenerator<AgentEvent> {
      const {
        tools,
        system,
        maxTurns,
        provider,
        model,
        effort,
        orchestration,
        toolContext,
        conversationId,
        metadata,
        maxToolCallsPerTurn = 10,
        maxTotalToolCalls = 200,
        securityGateMode = 'enforcing',
      } = options
      // A copy, never the caller's array: the turn block (clock + recall) is
      // attached here, once, and the tool loop appends to this copy.
      const turnBlock = options.turn ?? options.systemPrompt?.turn
      const messages: ModelMessage[] = attachTurnContext(options.messages, turnBlock)
      let turn = 0
      let totalToolCalls = 0
      let toolBudgetExhausted = false

      // System prompt is fully assembled by PromptAssembler before reaching the runner.
      // The runner only handles the tool-use loop.
      // v2 path: if systemPrompt is provided, flatten it; otherwise fall back to the
      // legacy `system` string. Task 29 will switch real callers to the v2 path.
      const baseSystem = options.systemPrompt
        ? flattenAssembledPrompt(options.systemPrompt)
        : (system ?? '')
      // Warm-resume: append the do-not-repeat / do-not-resend recap so the
      // model is re-grounded in what the original run already did.
      const enrichedSystem = options.reinjection
        ? [baseSystem, options.reinjection].filter((s) => s.trim()).join('\n\n')
        : baseSystem

      // Capability-aware delivery. A profile sized for another model (the
      // assembler fell back to the install default) says nothing about this
      // run, so it is ignored rather than trusted.
      const offeredProfile = options.delivery ?? options.systemPrompt?.delivery?.profile
      const delivery = offeredProfile && profileMatchesRun(offeredProfile, { provider, model })
        ? offeredProfile
        : undefined
      if (offeredProfile && !delivery) {
        deps.logger?.debug?.(
          { provider, model, profileProvider: offeredProfile.providerId, profileModel: offeredProfile.modelId },
          'delivery profile describes another model; ignored for this run',
        )
      }
      const toolsAllowed = delivery?.supportsTools !== false
      const requestTools = toolsAllowed ? tools : []
      // The run's toolset: what the caller scoped for it (agent/tool-scope.ts)
      // and so offered the model. A tool_use naming anything else is refused
      // here, before the gate and any approval, and again by the executor.
      const allowedTools: ReadonlySet<string> = toolContext?.allowedTools
        ?? new Set((tools ?? []).map((t) => t.name))
      const contextWindowMeta = delivery?.resolved ? { contextWindow: delivery.contextWindow } : {}

      let lastResponse: ModelResponse | null = null

      // Cap 3 keystone — fail-open run-event capture. Persistence must NEVER
      // abort a live run, so every append is wrapped and its error swallowed.
      // No-ops unless both an event-store dep and a sessionId are present.
      const sessionId = options.sessionId
      const eventStore = deps.eventStore
      const runEntryPath = entryPathOf(options)
      const emitEvent = async (type: string, payload: Record<string, unknown>): Promise<void> => {
        if (!eventStore || !sessionId) return
        try {
          await eventStore.append({ sessionId, type, payload })
        } catch {
          /* fail-open: run-event persistence is best-effort */
        }
      }

      // Lossy textual projection for the AgentState.messages field (the warm-
      // replay path). The lossless ContentBlock-preserving copy is stashed in
      // CheckpointState.meta.modelMessages and is the authoritative resume source.
      const toReplayMessages = (msgs: ModelMessage[]): ReplayMessage[] =>
        msgs.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          ts: Date.now(),
        }))

      // Fail-open checkpoint capture at a clean message boundary. No-ops unless
      // a checkpoint dep + sessionId are present and the policy fires.
      //
      // G5(e) — a provider that ran tools inside its own loop (a CLI) leaves
      // EYAS's history with no tool_use/tool_result pair for them, and a CLI
      // turn is one runner turn, so the every-N-turns policy would never
      // fire. Such a turn (and a CLI park) is checkpointed unconditionally
      // (`force`), as the history plus the answer text — never the provider's
      // tool blocks, which would replay unpaired and be rejected.
      const captureCheckpoint = async (
        turnNo: number,
        opts: { force?: boolean; assistantText?: string; providerExecuted?: boolean } = {},
      ): Promise<void> => {
        const cp = deps.checkpoint
        if (!cp || !sessionId) return
        try {
          if (!opts.force && !cp.shouldAutoCheckpoint(sessionId, turnNo)) return
          // Without the turn block: its clock and recall are this run's, and
          // a resume attaches fresh ones. Exactly the block this run attached
          // is removed — a look-alike frame in the sender's text stays.
          const history = stripTurnContext(messages, turnBlock)
          const snapshot: ModelMessage[] = opts.assistantText?.trim()
            ? [...history, { role: 'assistant', content: opts.assistantText }]
            : [...history]
          const eventSeq = eventStore ? Math.max(0, await eventStore.latestSeq(sessionId)) : 0
          const state: CheckpointState = {
            sessionId,
            lastSeq: eventSeq,
            eventCount: 0,
            currentState: 'working',
            messages: toReplayMessages(snapshot),
            toolCalls: [],
            pendingApprovals: [],
            grantedApprovals: [],
            tokensUsed: { input: 0, output: 0 },
            lastCheckpointSeq: null,
            lastCheckpointRef: null,
            turn: turnNo,
            // Lossless: preserves ContentBlock[] (tool_use / tool_result pairing)
            // so cold-resume restores the exact provider-valid history.
            meta: { modelMessages: snapshot, ...(opts.providerExecuted ? { providerExecuted: true } : {}) },
          }
          await cp.createCheckpoint({
            sessionId,
            eventSeq,
            label: `turn ${turnNo}`,
            kind: 'auto',
            reason: `auto checkpoint at turn ${turnNo}`,
            state,
            actor: metadata?.agentId ?? 'agent',
          })
        } catch {
          /* fail-open: checkpoint capture is best-effort */
        }
      }

      // F0 — single identity/classification contract. The legacy options.autonomous
      // flag is folded into the metadata so providers with an internal agentic
      // loop (Claude Code SDK / Grok ACP) enforce the same classification the
      // native loop does. Absence of any signal → autonomous (fail-closed).
      const classificationMetadata: ModelRequestMetadata | undefined =
        metadata !== undefined || options.autonomous !== undefined
          ? { ...metadata, autonomous: options.autonomous ?? metadata?.autonomous }
          : undefined
      const autonomous = isAutonomousRequest(classificationMetadata)

      // F2 T5 (D2) — durable park. Only an AUTONOMOUS run has nobody to answer
      // an escalation in-session, and only a SUPERVISED one has a row to park.
      // The event store + checkpoint API are what a resume (Task 6) restores
      // from: without them a parked run could never be continued, so such a run
      // keeps the old deny-and-continue behaviour instead of stranding itself.
      const canPark = autonomous && Boolean(sessionId) && Boolean(eventStore) && Boolean(deps.checkpoint)

      // Approvals the CLI-provider permission bridge enqueued during a turn.
      // For claude-code / grok-cli the agentic loop lives inside the provider,
      // so escalations never reach the approval block below — this sink is the
      // only way the runner learns the turn ended on a wall.
      const escalatedApprovals: Array<{ approvalId: number; toolName: string }> = []
      // Per-request wiring the providers need: `runId` is what makes a
      // CLI-path approval resumable (it is stamped onto the row), so it goes
      // out for every SUPERVISED run — not just the parkable ones.
      const metadataWiring = {
        ...(sessionId ? { runId: sessionId } : {}),
        ...(canPark
          ? {
              onEscalatedApproval: (approvalId: number, toolName?: string) => {
                escalatedApprovals.push({ approvalId, toolName: toolName ?? 'unknown' })
              },
            }
          : {}),
      }
      // K2 — a stored folder a protection rule now refuses (saved before the
      // rule, inherited from a project, or a vault created in it since) is
      // left out of this run for every channel — EYAS tools, the gate and the
      // CLI metadata below — and said once, under the turn.
      if (toolContext && (toolContext.workingDirectory || toolContext.workingDirectories?.length)) {
        const screened = screenToolWorkspaceFields(toolContext)
        if (screened.refused.length > 0) {
          delete toolContext.workingDirectory
          delete toolContext.workingDirectories
          Object.assign(toolContext, screened.fields)
          for (const refused of screened.refused) {
            deps.logger?.warn({ conversationId: toolContext.conversationId, folder: refused.path, code: refused.code }, 'agent runner: stored folder refused — left out of this run')
            yield folderRefusedNotice(refused)
          }
        }
      }

      // Every conversation folder goes out, not only the primary: CLI
      // providers take their cwd and file-request jail from them, and their
      // permission bridge hands them to the gate's memory-path policy.
      const workspaceMeta = {
        ...(toolContext?.workingDirectory ? { workingDirectory: toolContext.workingDirectory } : {}),
        ...(toolContext?.workingDirectories?.length ? { workingDirectories: [...toolContext.workingDirectories] } : {}),
      }
      // I2 — one id per answer turn: the context composition when one was
      // recorded, otherwise a fresh one. It keys the per-turn memory drill
      // budget on every path (executor calls below, and the CLI-MCP bridge
      // binding through the request metadata), and the project goes along so
      // a bridge never has to trust the CLI for it.
      const turnId = metadata?.compositionId ?? generateId()
      const projectMeta = toolContext?.projectId !== undefined ? { projectId: toolContext.projectId } : {}
      // The do-not-repeat ledger also reaches providers with their own loop:
      // their permission bridge refuses a repeat the runner never sees.
      const ledgerMeta = options.idempotencyLedger?.size ? { idempotencyLedger: options.idempotencyLedger } : {}
      // The turn's effective provider+model (H4): every tool call of this run
      // carries it — here in the executor's context, and through the request
      // metadata into a CLI provider's bridge — so a sub-conversation a tool
      // creates stores the delegating turn's model. The caller's own binding
      // wins; otherwise the pair this run calls.
      const turnBinding = toolContext?.modelBinding ?? (provider && model ? { providerId: provider, modelId: model } : undefined)
      const bindingMeta = turnBinding ? { modelBinding: { ...turnBinding } } : {}
      const effectiveMetadata: ModelRequestMetadata = {
        ...classificationMetadata,
        ...metadataWiring,
        ...workspaceMeta,
        ...projectMeta,
        ...ledgerMeta,
        ...bindingMeta,
        turnId,
      }

      /**
       * G5(d) — record a tool the provider executed inside its own loop as
       * the same ToolCall/ToolResult pair the runner writes for its own calls
       * (canonical name, normalized argHash): resume's recap and do-not-repeat
       * ledger are built from these. Only a call that actually ran is
       * recorded — a refused one (denied / approval_required / skipped)
       * executed nothing. A CLI-native tool (executedBy 'provider') also goes
       * to tool_executions; a bridged EYAS tool was logged by the executor.
       */
      const recordProviderTool = async (
        toolUseId: string,
        opened: OpenProviderTool,
        result: Extract<StreamEvent, { type: 'tool_result' }>,
      ): Promise<boolean> => {
        const ran = result.outcome === undefined || result.outcome === 'success' || result.outcome === 'error'
        if (!ran) return false
        const success = result.outcome ? result.outcome === 'success' : !result.isError
        const input = normalizeToolInput(opened.input)
        const durationMs = Number.isFinite(result.durationMs) ? Math.max(0, Math.round(result.durationMs)) : 0
        const executedBy = result.executedBy
        await emitEvent(EventTypes.ToolCall, {
          toolName: opened.name,
          input,
          toolUseId,
          ...(opened.rawName ? { rawName: opened.rawName } : {}),
          ...(executedBy ? { executedBy } : {}),
        })
        await emitEvent(EventTypes.ToolResult, {
          toolUseId,
          toolName: opened.name,
          argHash: toolArgHash(opened.input),
          argPreview: previewOf(input),
          output: result.content,
          durationMs,
          success,
          ...(success ? {} : { error: result.content.slice(0, 2000) }),
          ...(executedBy ? { executedBy } : {}),
        })
        if (executedBy === 'provider' && deps.recordExternalToolExecution) {
          try {
            await deps.recordExternalToolExecution({
              toolUseId,
              toolName: opened.name,
              ...(opened.rawName ? { rawName: opened.rawName } : {}),
              input,
              output: result.content,
              success,
              durationMs,
              conversationId: toolContext?.conversationId ?? metadata?.conversationId,
              agentId: toolContext?.agentId ?? metadata?.agentId,
              ...(sessionId ? { runId: sessionId } : {}),
              turnId,
            })
          } catch (err) {
            deps.logger?.warn?.({ toolName: opened.name, err: String(err) }, 'recording a provider-executed tool failed (ignored)')
          }
        }
        return true
      }

      /**
       * Park the run on an already-queued approval. Terminal: the caller MUST
       * `return` right after yielding this — the run row goes to
       * 'waiting_approval' and only Task 6's resume path may continue it.
       */
      const parkEvent = (approvalId: number, toolName: string): AgentEvent => {
        deps.logger?.info?.({ sessionId, approvalId, toolName }, 'run parked for approval')
        return { type: 'parked_for_approval', approvalId, toolName }
      }

      // How the run ended. Stays null only when the loop cap stops it.
      let outcome: RunOutcome | null = null

      while (turn < maxTurns) {
        // Cancellation checkpoint (turn boundary).
        if (options.signal?.aborted) {
          yield { type: 'cancelled', reason: 'run aborted' }
          return
        }

        // Send to model with tools. Forward the cancellation signal so
        // providers with an internal agentic loop (Claude Code SDK) can honor
        // it via interrupt — not just at EYAS turn/tool boundaries.
        const request = { messages, tools: requestTools, system: enrichedSystem || undefined, provider, model, effort, orchestration, metadata: effectiveMetadata, signal: options.signal, maxTurns: options.maxTurns, ...contextWindowMeta }
        let response: ModelResponse | null = null

        // Stream events from model — yield text/tool events but NOT 'done'.
        // The 'done' event is deferred until the tool-use loop ends so the
        // routes handler saves exactly one assistant message per user turn.
        //
        // The failure is held rather than propagated (F2 T5): a CLI provider
        // whose bridge denied-with-interrupt reports the abort as a throw, and
        // that abort is OUR doing — it must resolve to a park, not a failed
        // run. A throw with no reported approval still propagates untouched.
        // A gateway 'error' frame is the same failure: held, never yielded, so
        // a consumer sees it exactly once, as the throw below.
        let streamFailure: unknown = null
        // The answer text this call streamed — what a CLI park keeps when the
        // provider never got to its 'done'.
        let streamedText = ''
        // G5(d) — tool rows the provider opened in this call. One that the
        // provider also settles here ran inside its own loop; an API
        // provider's never settles here — the runner executes it below.
        const openProviderTools = new Map<string, OpenProviderTool>()
        let providerToolsRan = 0
        try {
          for await (const event of gateway.stream(request)) {
            if (event.type === 'done') {
              response = event.response
              continue
            }
            if (event.type === 'error') {
              streamFailure = event.error ?? new Error('provider stream failed')
              break
            }
            if (event.type === 'text') {
              streamedText += event.text
            } else if (event.type === 'tool_use_start') {
              const name = canonicalToolName(event.name)
              const rawName = event.rawName ?? (event.name !== name ? event.name : undefined)
              const prev = openProviderTools.get(event.id)
              const input = event.input && Object.keys(event.input).length > 0 ? event.input : (prev?.input ?? {})
              openProviderTools.set(event.id, { name, ...(rawName ? { rawName } : {}), input })
            } else if (event.type === 'tool_result') {
              const opened = openProviderTools.get(event.toolUseId)
              if (opened) {
                openProviderTools.delete(event.toolUseId)
                if (await recordProviderTool(event.toolUseId, opened, event)) providerToolsRan++
              }
            }
            yield event
          }
        } catch (err) {
          streamFailure = err
        }

        // CLI-provider park: the provider's own loop hit an escalation and the
        // bridge queued an approval. The first one parks the run; the rest are
        // already queued rows an operator can action independently.
        //
        // A cancel WINS over a park: an operator who stopped this run must not
        // get it back as a run waiting for their approval. The abort falls
        // through to the existing cancellation paths (rethrow / turn-boundary).
        //
        // How the turn ENDED decides whether an escalation parks — the two CLI
        // providers end differently and both endings are honest signals:
        //   - grok/ACP has no interrupt: reject_once denies in-session and the
        //     turn runs on to a CLEAN end, so `!streamFailure` is the signal.
        //   - claude-code honours our interrupting deny by aborting the SDK,
        //     which surfaces as an abort-kind throw.
        // Any OTHER failure is a real crash that merely happened to land after
        // an escalation (a network drop following a reject_once): it must fail
        // the run. The approval row stays queued for the operator either way,
        // but reporting a crash as "waiting for approval" would hide it forever.
        if (escalatedApprovals.length > 0 && !options.signal?.aborted) {
          const endedOnTheEscalation = !streamFailure || classifyModelError(streamFailure).kind === 'aborted'
          if (endedOnTheEscalation) {
            const [first, ...rest] = escalatedApprovals
            if (rest.length > 0) {
              deps.logger?.debug?.(
                { sessionId, parkedOn: first!.approvalId, alsoQueued: rest.map((a) => a.approvalId) },
                'park: additional approvals were queued during the same provider turn',
              )
            }
            // G5(e) — the resume seeds from this: the history plus what the
            // provider answered before it hit the wall (its tools are in the
            // recorded ToolResult events, which feed the recap and ledger).
            await captureCheckpoint(turn + 1, {
              force: true,
              assistantText: (response ? textOf(response.content) : '') || streamedText,
              providerExecuted: true,
            })
            yield parkEvent(first!.approvalId, first!.toolName)
            return
          }
          deps.logger?.warn?.(
            { sessionId, queuedApprovals: escalatedApprovals.map((a) => a.approvalId), err: String((streamFailure as Error)?.message ?? streamFailure) },
            'park skipped: the provider failed for an unrelated reason after an escalation — failing the run',
          )
        }
        if (streamFailure) throw streamFailure

        if (!response) {
          // A provider that stops without its 'done' was either cancelled —
          // then the cancel is the run's ending — or broke the stream contract.
          if (options.signal?.aborted) {
            yield { type: 'cancelled', reason: 'run aborted' }
            return
          }
          throw new Error(`model stream ended without a response${provider ? ` (provider ${provider})` : ''}`)
        }
        lastResponse = response

        turn++
        const tokensUsed = response.usage.inputTokens + response.usage.outputTokens
        yield { type: 'turn_complete', turn, tokensUsed, usage: response.usage, provider: response.provider, model: response.model }
        options.onTurnComplete?.(turn, response)

        // Capture the model's reply into the replayable trace (text projection;
        // the lossless ModelMessage[] lives in the checkpoint meta below).
        // Provenance: the pair that answered (never the requested one) and
        // how the run entered EYAS — the L0 row of this reply carries both.
        await emitEvent(EventTypes.LlmResponse, {
          response: {
            content: response.content.map((b) => (b.type === 'text' ? (b as { text: string }).text : '')).filter(Boolean).join('\n'),
            stopReason: response.stopReason,
            usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
            provider: response.provider,
            model: response.model,
          },
          ...(runEntryPath ? { entryPath: runEntryPath } : {}),
        })

        // G5(e) — the provider ran tools inside its own loop: checkpoint the
        // turn so a resume/retry continues from it instead of the goal.
        if (providerToolsRan > 0) {
          await captureCheckpoint(turn, {
            force: true,
            assistantText: textOf(response.content) || streamedText,
            providerExecuted: true,
          })
        }

        // If model didn't request tools, we're done
        if (response.stopReason !== 'tool_use') {
          outcome = outcomeOfStopReason(response.stopReason)
          break
        }

        // A model without tool support was sent none: a tool_use it returns
        // anyway is not executed, and the turn ends on its text.
        if (!toolsAllowed) {
          deps.logger?.warn?.({ provider, model }, 'tool-less model returned tool_use; not executed')
          outcome = 'completed'
          break
        }

        // Extract tool_use blocks from response
        const allToolUseBlocks = response.content.filter(
          (b): b is ToolUseBlock => b.type === 'tool_use',
        )

        if (allToolUseBlocks.length === 0) {
          outcome = 'completed'
          break
        }

        // Enforce per-turn cap: truncate excess tool_use blocks with a synthetic result
        const toolUseBlocks = orderToolUsesForTurn(allToolUseBlocks.slice(0, maxToolCallsPerTurn))
        const truncatedBlocks = allToolUseBlocks.slice(maxToolCallsPerTurn)
        const routingInTurn = toolUseBlocks.filter((b) => isParallelRoutingTool(b.name))
        if (routingInTurn.length >= 2 && toolContext) {
          toolContext.isolateSpecialists = true
          toolContext.pendingSpecialistIds = routingInTurn
            .map((b) => {
              const id = (b.input as { agentId?: unknown } | undefined)?.agentId
              return typeof id === 'string' ? id : ''
            })
            .filter(Boolean)
        }
        const parallelExecQueue: Array<{
          toolUse: ToolUseBlock
          execContext: ToolContext | undefined
        }> = []

        // Add assistant message with the FULL original response (so the model sees
        // its own tool_use blocks, including the truncated ones).
        messages.push({ role: 'assistant', content: response.content })

        // Execute each tool and collect results
        const toolResults: ToolResultBlock[] = []

        /**
         * Settle a call the runner did NOT execute: the model reads `content`
         * as the call's result, the UI settles the row with `outcome`.
         */
        const settleUnexecuted = (
          toolUse: ToolUseBlock,
          content: string,
          outcome: 'denied' | 'approval_required' | 'skipped',
          isError = true,
        ): AgentEvent => {
          toolResults.push({ type: 'tool_result', toolUseId: toolUse.id, content, isError })
          return { type: 'tool_result', toolUseId: toolUse.id, content, isError, durationMs: 0, outcome, executedBy: 'eyas' }
        }

        /** Open (or refresh) the call's row with its complete input. */
        const openRow = (toolUse: ToolUseBlock): AgentEvent => ({
          type: 'tool_use_start',
          id: toolUse.id,
          name: toolUse.name,
          input: (toolUse.input ?? {}) as Record<string, unknown>,
        })

        async function* finishExecutedTool(
          toolUse: ToolUseBlock,
          result: { success: boolean; output?: unknown; error?: string; errorCode?: string; durationMs?: number },
        ): AsyncGenerator<AgentEvent> {
          if (toolContext && result.success && result.output && typeof result.output === 'object') {
            const maybeId = (result.output as { teamSessionId?: unknown }).teamSessionId
            if (typeof maybeId === 'string' && maybeId && !toolContext.teamSessionId) {
              toolContext.teamSessionId = maybeId
              toolContext.sessionId = maybeId
            }
          }
          const content = result.success
            ? JSON.stringify(result.output)
            : `Error: ${result.error}`
          const toolResult: ToolResultBlock = {
            type: 'tool_result',
            toolUseId: toolUse.id,
            content,
            isError: !result.success,
          }
          toolResults.push(toolResult)
          await emitEvent(EventTypes.ToolResult, {
            toolUseId: toolUse.id,
            toolName: canonicalToolName(toolUse.name),
            argHash: toolArgHash(toolUse.input),
            argPreview: previewOf(toolUse.input),
            output: result.output,
            durationMs: result.durationMs ?? 0,
            success: result.success,
            ...(result.error ? { error: String(result.error) } : {}),
            executedBy: 'eyas',
          })
          yield {
            type: 'tool_result',
            toolUseId: toolUse.id,
            content,
            isError: !result.success,
            durationMs: result.durationMs ?? 0,
            // The executor authorizes every call itself (CASL): its refusal
            // is a denial (or a wait on a human), not a tool failure.
            outcome: result.success
              ? 'success'
              : result.errorCode === 'DENIED' ? 'denied' : result.errorCode === 'APPROVAL_REQUIRED' ? 'approval_required' : 'error',
            executedBy: 'eyas',
          }
        }

        for (const toolUse of toolUseBlocks) {
          // Enforce absolute cap on tool calls
          if (totalToolCalls >= maxTotalToolCalls) {
            toolBudgetExhausted = true
            yield openRow(toolUse)
            yield settleUnexecuted(toolUse, `Tool budget exhausted: limit of ${maxTotalToolCalls} reached for this run`, 'skipped')
            continue
          }
          totalToolCalls++

          // Cancellation checkpoint (tool boundary).
          if (options.signal?.aborted) {
            yield { type: 'cancelled', reason: 'run aborted' }
            return
          }

          // Re-emit with args now that the block is complete. Provider
          // tool_use_start frames often carry only the name; the chat UI
          // upserts this onto the existing row.
          yield openRow(toolUse)

          // A tool the run was not offered (a hallucinated or out-of-scope
          // name) is denied outright: no gate verdict, no approval to wait on.
          const outsideToolset = toolsetDenial(allowedTools, toolUse.name)
          if (outsideToolset) {
            yield settleUnexecuted(toolUse, `Tool call denied: ${outsideToolset}`, 'denied')
            continue
          }

          // Real risk tier for this call — inherited from the security gate
          // when it runs, otherwise 'green'. Threaded into the approval +
          // autonomy decisions below (replaces the old hardcoded 'green').
          let toolRiskTier: 'green' | 'yellow' | 'red' = 'green'

          // Set when the gate returns 'escalate' (e.g. no judge-capable model
          // configured) — routes the call into the approval flow below.
          let gateEscalation: string | null = null

          // Security gate validation (fail-closed by default)
          if (deps.securityGate) {
            let check: { decision: string; reason: string; riskTier: string } | null = null
            let gateError: Error | null = null
            try {
              check = await deps.securityGate.validateToolCall(
                toolUse.name,
                toolUse.input as Record<string, unknown>,
                {
                  conversationId: toolContext?.conversationId,
                  agentId: toolContext?.agentId,
                  parentGoal: toolContext?.parentGoal,
                  // The memory-path policy's cross-workspace refinement.
                  workingDirectories: gateWorkingDirectories(toolContext),
                },
              )
            } catch (err: any) {
              gateError = err instanceof Error ? err : new Error(String(err))
            }

            // Handle either a thrown exception or an explicit judge_error decision
            if (gateError || check?.decision === 'judge_error') {
              const reason = gateError?.message ?? check?.reason ?? 'judge_error'
              yield {
                type: 'security_gate_error',
                toolName: toolUse.name,
                mode: securityGateMode,
                reason,
              }
              if (securityGateMode === 'enforcing') {
                yield settleUnexecuted(toolUse, `Security gate unavailable (fail-closed): ${reason}`, 'denied')
                continue
              }
              // permissive mode: fall through to tool execution (with warn event emitted)
            } else if (check?.decision === 'deny') {
              yield settleUnexecuted(toolUse, `Security gate denied: ${check.reason}`, 'denied')
              continue
            } else if (check?.decision === 'escalate') {
              gateEscalation = check.reason
            } else if (check && check.decision !== 'allow') {
              // Neither deny/judge_error/escalate/allow — an unrecognized
              // verdict must fail closed exactly like an explicit deny, not
              // silently fall through to execution.
              yield settleUnexecuted(toolUse, `Security gate denied: unknown gate verdict '${check.decision}' (fail-closed)`, 'denied')
              continue
            }

            if (check?.riskTier) toolRiskTier = check.riskTier as 'green' | 'yellow' | 'red'
          }

          // Approval gate. Sits OUTSIDE the security-gate block so it runs even
          // when no security gate is wired. Two inputs combine (strictest wins):
          //   (1) the graduated-autonomy ladder (per action category), and
          //   (2) the Phase-3F approval-tier policy (paranoid/balanced/autopilot).
          // Autopilot + no autonomy match → no approval, matching prior behaviour.
          {
            let needsApproval = gateEscalation !== null
            let approvalReason = gateEscalation ?? ''
            let requiresPreview = false
            let autonomyCategory: string | null = null

            if (autonomous && deps.autonomyPolicy) {
              autonomyCategory = deps.autonomyPolicy.categoryForTool(toolUse.name, toolRiskTier)
              if (autonomyCategory) {
                const resolved = deps.autonomyPolicy.resolve(autonomyCategory)
                if (resolved.level < 3) {
                  // L1 (notice) / L2 (propose) → require human approval.
                  needsApproval = true
                  approvalReason = `autonomy level ${resolved.level} for "${autonomyCategory}" requires approval`
                }
              }
            }

            if (deps.approvalPolicy) {
              const decision = deps.approvalPolicy.decide(toolUse.name, toolRiskTier, {})
              if (decision.action === 'approve') {
                needsApproval = true
                approvalReason = approvalReason || decision.reason
                requiresPreview = decision.requiresPreview ?? false
              }
            }

            if (needsApproval) {
              // F2 T3 — grant check BEFORE the deny-for-approval branch below:
              // a prior human approval for this EXACT call (same conversation
              // + tool + args) authorizes it exactly once, so a resumed / retried
              // run doesn't have to wait on a fresh approval. Never reachable
              // from a deterministic gate 'deny' — that verdict already
              // `continue`d the loop above, long before this point, so a grant
              // can never override a hard deny.
              const callArgHash = argHash(toolUse.input)
              let granted = false
              let grantApprovalId: number | undefined
              if (deps.autonomyPolicy?.consumeGrant && toolContext?.conversationId) {
                try {
                  const grant = deps.autonomyPolicy.consumeGrant({
                    conversationId: toolContext.conversationId,
                    toolName: toolUse.name,
                    argHash: callArgHash,
                  })
                  granted = grant.granted
                  grantApprovalId = grant.approvalId
                } catch {
                  // Fail closed to the normal enqueue+deny flow below.
                }
              }

              if (granted) {
                deps.logger?.info?.({ toolName: toolUse.name, approvalId: grantApprovalId }, 'gate:grant_consumed')
              } else {
                // Enqueue-everywhere (F2 T3): every approval-requiring call
                // gets a row, even an interactive escalation or an
                // uncategorized tool — those used to be denied with NO row at
                // all, leaving the operator nothing to approve.
                //
                // I3 — EXCEPT when there's no conversation scope: such a row
                // can never be granted (consumeGrant requires a
                // conversationId), so it would just be a dead row that grows
                // on every retry. Skip the enqueue and say so explicitly.
                let queuedApprovalId: number | undefined
                if (deps.autonomyPolicy?.createApproval) {
                  if (toolContext?.conversationId) {
                    try {
                      queuedApprovalId = deps.autonomyPolicy.createApproval({
                        category: autonomyCategory ?? 'uncategorized',
                        toolName: toolUse.name,
                        agentId: toolContext?.agentId,
                        conversationId: toolContext.conversationId,
                        inputJson: JSON.stringify(toolUse.input),
                        argHash: callArgHash,
                        runId: sessionId,
                        expiresAt: deps.autonomyPolicy.defaultExpiresAt?.(),
                        reason: approvalReason,
                      })
                    } catch { /* queue insert is best-effort visibility */ }
                  } else {
                    approvalReason = `${approvalReason} (approval required but this execution path cannot receive grants — no conversation scope)`
                  }
                }

                // Fail-closed when no callback: an operator who opted into a
                // stricter mode (or a locked autonomy category) but didn't wire a
                // human-in-the-loop handler must NOT get a silent auto-run.
                let approved = false
                let callbackFailure: string | null = null
                if (deps.onApprovalRequired) {
                  try {
                    approved = await deps.onApprovalRequired({
                      toolName: toolUse.name,
                      input: toolUse.input as Record<string, unknown>,
                      riskTier: toolRiskTier,
                      reason: approvalReason,
                      requiresPreview,
                      conversationId: toolContext?.conversationId,
                      agentId: toolContext?.agentId,
                    })
                  } catch (err: any) {
                    approved = false
                    callbackFailure = err?.message ?? String(err)
                  }
                }

                if (!approved) {
                  // A reviewer that answered "no" decided the call; anything
                  // else (no reviewer, a failed callback) leaves it waiting on
                  // a human — the queued row, when one exists.
                  const reviewerDenied = Boolean(deps.onApprovalRequired) && callbackFailure === null
                  // F2 T5 (D2) — durable park instead of deny-and-continue.
                  // Only reachable for an approval that produced a REAL queue
                  // row: parking on nothing would strand the run forever. A
                  // deterministic gate 'deny' never gets here (it `continue`d
                  // far above), so a park can never mask a hard denial.
                  // Same rule as the CLI path: a cancel wins over a park.
                  const parks = queuedApprovalId !== undefined && canPark && !options.signal?.aborted
                  if (!reviewerDenied || parks) {
                    yield {
                      type: 'approval_required',
                      toolUseId: toolUse.id,
                      toolName: toolUse.name,
                      reason: approvalReason,
                      ...(queuedApprovalId !== undefined ? { approvalId: queuedApprovalId } : {}),
                      riskTier: toolRiskTier,
                    }
                  }
                  if (parks) {
                    yield parkEvent(queuedApprovalId!, toolUse.name)
                    return
                  }
                  if (queuedApprovalId !== undefined && autonomous && sessionId) {
                    deps.logger?.warn?.(
                      { sessionId, toolName: toolUse.name, approvalId: queuedApprovalId },
                      'park skipped: no event store',
                    )
                  }

                  const denyReason = callbackFailure
                    ? `approval callback threw: ${callbackFailure}`
                    : deps.onApprovalRequired
                      ? `human reviewer denied: ${approvalReason}`
                      : `approval required but no reviewer configured: ${approvalReason}`
                  yield settleUnexecuted(toolUse, `Approval denied: ${denyReason}`, reviewerDenied ? 'denied' : 'approval_required')
                  continue
                }
              }
            }
          }

          // Warm-resume idempotency guard (post-gate): hard-skip a destructive
          // tool call already executed on the original run so a resume cannot
          // re-fire its side effect. Sits AFTER the gate (gate still authorizes)
          // and BEFORE the ToolCall append (a skipped call is not re-recorded).
          if (options.idempotencyLedger?.has(toolLedgerKey(toolUse.name, toolUse.input))) {
            yield settleUnexecuted(
              toolUse,
              'Skipped: this tool call was already executed on the original run (resumed run — duplicate side effect prevented).',
              'skipped',
              false,
            )
            // NOTE: no ToolResult event is emitted for a skip. Ledger
            // transitivity across a resume chain is handled by resumeRun walking
            // the parent_run_id lineage, so re-recording here is unnecessary (and
            // would emit a ToolResult with no preceding ToolCall).
            continue
          }

          // Capture the authorized tool call (post-gate/post-approval, pre-exec)
          // so resume can derive an idempotency ledger (do-not-repeat).
          await emitEvent(EventTypes.ToolCall, {
            toolName: canonicalToolName(toolUse.name),
            input: toolUse.input as Record<string, unknown>,
            toolUseId: toolUse.id,
            executedBy: 'eyas',
          })

          // The executor authorizes every call itself (F0 R2). Tell it who is
          // asking, and that this run already put the call through the gate +
          // approval flow above — so it enforces CASL without re-judging.
          // Built per call (not hoisted) so the teamSessionId propagation
          // below, which mutates the shared toolContext, is picked up next
          // iteration.
          const execContext = toolContext
            ? {
                ...toolContext,
                actor: toolContext.actor ?? { kind: 'agent' as const, role: 'agent' as const },
                securityPipelineHandled: Boolean(deps.securityGate),
                allowedTools,
                turnId,
                ...(sessionId ? { runId: sessionId } : {}),
                ...bindingMeta,
              }
            : undefined
          if (routingInTurn.length >= 2 && isParallelRoutingTool(toolUse.name)) {
            parallelExecQueue.push({ toolUse, execContext })
            continue
          }

          if (parallelExecQueue.length > 0) {
            const queued = parallelExecQueue.splice(0, parallelExecQueue.length)
            const executed = await Promise.all(
              queued.map(async (job) => ({
                job,
                result: await toolExecutor.execute(job.toolUse.name, job.toolUse.input, job.execContext),
              })),
            )
            for (const { job, result } of executed) {
              yield* finishExecutedTool(job.toolUse, result)
            }
          }

          const result = await toolExecutor.execute(
            toolUse.name,
            toolUse.input,
            execContext,
          )
          yield* finishExecutedTool(toolUse, result)
        }

        if (parallelExecQueue.length > 0) {
          const executed = await Promise.all(
            parallelExecQueue.map(async (job) => ({
              job,
              result: await toolExecutor.execute(job.toolUse.name, job.toolUse.input, job.execContext),
            })),
          )
          for (const { job, result } of executed) {
            yield* finishExecutedTool(job.toolUse, result)
          }
        }

        // Per-turn-truncated tool_use blocks: the assistant message carries the
        // FULL response.content (all tool_use, including the truncated ones),
        // so EVERY tool_use needs a matching tool_result or the
        // assistant+tool_result pair is provider-invalid (Anthropic 400) — both
        // for the live continuation and for a cold-resume from the captured
        // state. Each one also settles its row as 'skipped'.
        for (const tb of truncatedBlocks) {
          yield openRow(tb)
          yield settleUnexecuted(tb, `Skipped: per-turn tool-call limit (${maxToolCallsPerTurn}) reached; this call was not executed.`, 'skipped')
        }

        // Add tool results as user message (Anthropic convention: tool_result in user role)
        messages.push({ role: 'user', content: toolResults as ContentBlock[] })

        // Clean boundary (assistant + tool_result pair complete) — capture a
        // resumable checkpoint if the policy fires.
        await captureCheckpoint(turn)

        // Terminate early if we hit the absolute tool-call budget
        if (toolBudgetExhausted) {
          outcome = 'tool_budget'
          break
        }
      }

      // The run's single terminal: the routes handler uses it to save exactly
      // one assistant message. Only the loop cap leaves `outcome` unset.
      if (!lastResponse) {
        // maxTurns < 1: no model call was allowed at all.
        throw new Error(`agent run made no model call (maxTurns ${maxTurns})`)
      }
      yield {
        type: 'done',
        response: lastResponse,
        outcome: outcome ?? 'max_turns',
        stopReason: lastResponse.stopReason,
      }
    },
  }

  return {
    /**
     * One agent run: the tool-use loop above, with its run tree emitted to
     * the orchestration sink (run-tree.ts) and its tool I/O and reasoning
     * offered to the L0 capture (memory/v2/run-capture.ts), when the run has
     * a conversation.
     */
    run(options: AgentRunOptions): AsyncGenerator<AgentEvent> {
      const conversationId = options.conversationId ?? options.toolContext?.conversationId ?? options.metadata?.conversationId
      let capture: RunCapture | null = null
      if (conversationId && deps.startRunCapture) {
        try {
          capture = deps.startRunCapture({
            conversationId,
            agentId: options.toolContext?.agentId ?? options.metadata?.agentId ?? null,
            sessionId: options.sessionId ?? null,
            entryPath: entryPathOf(options),
            provider: options.provider ?? null,
            model: options.model ?? null,
          }) ?? null
        } catch (err) {
          deps.logger?.debug?.({ conversationId, err: String(err) }, 'run capture unavailable (ignored)')
        }
      }
      let sink: OrchestrationSink | undefined
      try { sink = deps.getOrchestrationSink?.() } catch { sink = undefined }
      const scope = sink
        ? runTreeScopeOf({
            conversationId: options.conversationId,
            toolContext: options.toolContext,
            metadata: options.metadata,
            maxTurns: options.maxTurns,
            provider: options.provider,
            model: options.model,
          })
        : null
      const events = capture ? withRunCapture(loop.run(options), capture) : loop.run(options)
      if (!sink || !scope) return events
      return withRunTree(events, { sink, scope, pricingOverrides: deps.pricingOverrides, logger: deps.logger })
    },
  }
}
