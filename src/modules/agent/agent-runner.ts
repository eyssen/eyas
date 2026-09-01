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
  ThinkingConfig,
  EffortLevel,
  OrchestrationMode,
  ModelRequestMetadata,
  ModelUsage,
} from '@modules/model/types.js'
import type { Logger } from 'pino'
import { isAutonomousRequest } from '@modules/model/permission-bridge.js'
import { classifyModelError } from '@shared/classify-model-error.js'
import type { createToolExecutor } from '@modules/tools/tool-executor.js'
import type { ToolContext } from '@modules/tools/types.js'
import type { AssembledPrompt } from '@modules/prompt-wizard/types.js'
import type { EventStore } from '@modules/event-store/event-store.js'
import { EventTypes, type ReplayMessage } from '@modules/event-store/types.js'
import type { CheckpointAPI, CheckpointState } from '@modules/agent/checkpoint'
import { argHash } from './arg-hash.js'

// ─── Agent Events ─────────────────────────────

export type AgentEvent =
  | StreamEvent
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean; durationMs: number }
  // F2 T9 (R2) — `usage` is additive: it carries what the response.usage had
  // (cache tokens / a CLI-authoritative costUsd, when the provider supplies
  // them) so a run's rollup can price the run without re-deriving it from
  // ai_traces (which must never back a rollup — critic/judge calls pollute
  // it). Consumers that only read `tokensUsed` (the pre-existing combined
  // input+output scalar) are unaffected.
  | { type: 'turn_complete'; turn: number; tokensUsed: number; usage?: ModelUsage }
  | { type: 'max_turns_reached'; turns: number }
  | { type: 'tool_budget_exhausted'; totalCalls: number; limit: number }
  | { type: 'tool_calls_per_turn_truncated'; turn: number; requested: number; executed: number }
  | { type: 'security_gate_error'; toolName: string; mode: 'enforcing' | 'permissive'; reason: string }
  // Phase 3F — approval-tier events. Emitted only when an approvalPolicy is
  // wired in AgentRunnerDeps. `tool_approval_required` is the signal for
  // human-in-the-loop UIs; `tool_approval_denied` is the terminal result
  // after the callback (or lack thereof) refuses the call.
  | { type: 'tool_approval_required'; toolName: string; riskTier: 'green' | 'yellow' | 'red'; reason: string; requiresPreview: boolean }
  | { type: 'tool_approval_denied'; toolName: string; reason: string }
  // Cap 3 — the run was cancelled via an AbortSignal (operator cancel, stuck
  // recovery, or shutdown). Terminal: the generator returns after yielding it.
  | { type: 'cancelled'; reason: string }
  // F2 T5 (D2) — durable park. An AUTONOMOUS + SUPERVISED run that needs a
  // human decision stops here instead of denying-and-continuing: the approval
  // is already queued, and the consumer (conversation-runner / executeAgent /
  // orchestrator) parks the run on `approvalId` so Task 6 can resume it.
  // TERMINAL: the generator returns right after yielding it — no 'done'.
  | { type: 'parked_for_approval'; approvalId: number; toolName: string }

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
  maxTurns: number
  provider?: string
  model?: string
  thinking?: ThinkingConfig
  effort?: EffortLevel
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
   * Absolute cap on tool calls across the entire run. When reached the loop
   * emits `tool_budget_exhausted` and stops. Default: 200.
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
   * Cap 3 keystone (warm-resume) — idempotency ledger of `${toolName}:${argHash}`
   * entries for DESTRUCTIVE tool calls already executed on the original run.
   * A matching call is hard-skipped (synthetic success result) so a resume can
   * never re-fire a side effect. Non-destructive repeats are not in the ledger
   * (advisory recap only). The security gate still runs for every call.
   */
  idempotencyLedger?: ReadonlySet<string>
}

// ─── Dependencies ─────────────────────────────

interface AgentRunnerDeps {
  gateway: ModelGateway
  toolExecutor: ReturnType<typeof createToolExecutor>
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
      ctx?: { conversationId?: string; agentId?: string; parentGoal?: string },
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
}

// ─── Helpers ──────────────────────────────────

function flattenAssembledPrompt(p: AssembledPrompt): string {
  const parts = [p.prefix, p.suffix, ...p.reminders].filter((s) => s.trim())
  return parts.join('\n\n')
}

// ─── Runner ───────────────────────────────────

export function createAgentRunner(deps: AgentRunnerDeps) {
  const { gateway, toolExecutor } = deps

  return {
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
        thinking,
        effort,
        orchestration,
        toolContext,
        conversationId,
        metadata,
        maxToolCallsPerTurn = 10,
        maxTotalToolCalls = 200,
        securityGateMode = 'enforcing',
      } = options
      // Copy messages to avoid mutating the caller's array
      const messages: ModelMessage[] = [...options.messages]
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

      let lastResponse: ModelResponse | null = null

      // Cap 3 keystone — fail-open run-event capture. Persistence must NEVER
      // abort a live run, so every append is wrapped and its error swallowed.
      // No-ops unless both an event-store dep and a sessionId are present.
      const sessionId = options.sessionId
      const eventStore = deps.eventStore
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
      const captureCheckpoint = async (turnNo: number): Promise<void> => {
        const cp = deps.checkpoint
        if (!cp || !sessionId) return
        try {
          if (!cp.shouldAutoCheckpoint(sessionId, turnNo)) return
          const eventSeq = eventStore ? Math.max(0, await eventStore.latestSeq(sessionId)) : 0
          const state: CheckpointState = {
            sessionId,
            lastSeq: eventSeq,
            eventCount: 0,
            currentState: 'working',
            messages: toReplayMessages(messages),
            toolCalls: [],
            pendingApprovals: [],
            grantedApprovals: [],
            tokensUsed: { input: 0, output: 0 },
            lastCheckpointSeq: null,
            lastCheckpointRef: null,
            turn: turnNo,
            // Lossless: preserves ContentBlock[] (tool_use / tool_result pairing)
            // so cold-resume restores the exact provider-valid history.
            meta: { modelMessages: [...messages] },
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
      const workspaceMeta = toolContext?.workingDirectory
        ? { workingDirectory: toolContext.workingDirectory }
        : {}
      const effectiveMetadata: ModelRequestMetadata | undefined =
        classificationMetadata !== undefined || Object.keys(metadataWiring).length > 0 || toolContext?.workingDirectory
          ? { ...classificationMetadata, ...metadataWiring, ...workspaceMeta }
          : undefined

      /**
       * Park the run on an already-queued approval. Terminal: the caller MUST
       * `return` right after yielding this — the run row goes to
       * 'waiting_approval' and only Task 6's resume path may continue it.
       */
      const parkEvent = (approvalId: number, toolName: string): AgentEvent => {
        deps.logger?.info?.({ sessionId, approvalId, toolName }, 'run parked for approval')
        return { type: 'parked_for_approval', approvalId, toolName }
      }

      while (turn < maxTurns) {
        // Cancellation checkpoint (turn boundary).
        if (options.signal?.aborted) {
          yield { type: 'cancelled', reason: 'run aborted' }
          return
        }

        // Send to model with tools. Forward the cancellation signal so
        // providers with an internal agentic loop (Claude Code SDK) can honor
        // it via interrupt — not just at EYAS turn/tool boundaries.
        const request = { messages, tools, system: enrichedSystem || undefined, provider, model, thinking, effort, orchestration, metadata: effectiveMetadata, signal: options.signal, maxTurns: options.maxTurns }
        let response: ModelResponse | null = null

        // Stream events from model — yield text/tool events but NOT 'done'.
        // The 'done' event is deferred until the tool-use loop ends so the
        // routes handler saves exactly one assistant message per user turn.
        //
        // The failure is held rather than propagated (F2 T5): a CLI provider
        // whose bridge denied-with-interrupt reports the abort as a throw, and
        // that abort is OUR doing — it must resolve to a park, not a failed
        // run. A throw with no reported approval still propagates untouched.
        let streamFailure: unknown = null
        try {
          for await (const event of gateway.stream(request)) {
            if (event.type === 'done') {
              response = event.response
            } else {
              yield event as AgentEvent
            }
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
            yield parkEvent(first!.approvalId, first!.toolName)
            return
          }
          deps.logger?.warn?.(
            { sessionId, queuedApprovals: escalatedApprovals.map((a) => a.approvalId), err: String((streamFailure as Error)?.message ?? streamFailure) },
            'park skipped: the provider failed for an unrelated reason after an escalation — failing the run',
          )
        }
        if (streamFailure) throw streamFailure

        if (!response) break
        lastResponse = response

        turn++
        const tokensUsed = response.usage.inputTokens + response.usage.outputTokens
        yield { type: 'turn_complete', turn, tokensUsed, usage: response.usage }
        options.onTurnComplete?.(turn, response)

        // Capture the model's reply into the replayable trace (text projection;
        // the lossless ModelMessage[] lives in the checkpoint meta below).
        await emitEvent(EventTypes.LlmResponse, {
          response: {
            content: response.content.map((b) => (b.type === 'text' ? (b as { text: string }).text : '')).filter(Boolean).join('\n'),
            stopReason: response.stopReason,
            usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
          },
        })

        // If model didn't request tools, we're done
        if (response.stopReason !== 'tool_use') break

        // Extract tool_use blocks from response
        const allToolUseBlocks = response.content.filter(
          (b): b is ToolUseBlock => b.type === 'tool_use',
        )

        if (allToolUseBlocks.length === 0) break

        // Enforce per-turn cap: truncate excess tool_use blocks with a synthetic result
        const toolUseBlocks = allToolUseBlocks.slice(0, maxToolCallsPerTurn)
        const truncatedBlocks = allToolUseBlocks.slice(maxToolCallsPerTurn)
        if (truncatedBlocks.length > 0) {
          yield {
            type: 'tool_calls_per_turn_truncated',
            turn,
            requested: allToolUseBlocks.length,
            executed: toolUseBlocks.length,
          }
        }

        // Add assistant message with the FULL original response (so the model sees
        // its own tool_use blocks, including the truncated ones).
        messages.push({ role: 'assistant', content: response.content })

        // Execute each tool and collect results
        const toolResults: ToolResultBlock[] = []

        for (const toolUse of toolUseBlocks) {
          // Enforce absolute cap on tool calls
          if (totalToolCalls >= maxTotalToolCalls) {
            toolBudgetExhausted = true
            const toolResult: ToolResultBlock = {
              type: 'tool_result',
              toolUseId: toolUse.id,
              content: `Tool budget exhausted: limit of ${maxTotalToolCalls} reached for this run`,
              isError: true,
            }
            toolResults.push(toolResult)
            yield {
              type: 'tool_result',
              toolUseId: toolUse.id,
              content: toolResult.content,
              isError: true,
              durationMs: 0,
            }
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
          yield {
            type: 'tool_use_start',
            id: toolUse.id,
            name: toolUse.name,
            input: (toolUse.input ?? {}) as Record<string, unknown>,
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
                const toolResult: ToolResultBlock = {
                  type: 'tool_result',
                  toolUseId: toolUse.id,
                  content: `Security gate unavailable (fail-closed): ${reason}`,
                  isError: true,
                }
                toolResults.push(toolResult)
                yield {
                  type: 'tool_result',
                  toolUseId: toolUse.id,
                  content: toolResult.content,
                  isError: true,
                  durationMs: 0,
                }
                continue
              }
              // permissive mode: fall through to tool execution (with warn event emitted)
            } else if (check?.decision === 'deny') {
              const toolResult: ToolResultBlock = {
                type: 'tool_result',
                toolUseId: toolUse.id,
                content: `Security gate denied: ${check.reason}`,
                isError: true,
              }
              toolResults.push(toolResult)
              yield {
                type: 'tool_result',
                toolUseId: toolUse.id,
                content: toolResult.content,
                isError: true,
                durationMs: 0,
              }
              continue
            } else if (check?.decision === 'escalate') {
              gateEscalation = check.reason
            } else if (check && check.decision !== 'allow') {
              // Neither deny/judge_error/escalate/allow — an unrecognized
              // verdict must fail closed exactly like an explicit deny, not
              // silently fall through to execution.
              const toolResult: ToolResultBlock = {
                type: 'tool_result',
                toolUseId: toolUse.id,
                content: `Security gate denied: unknown gate verdict '${check.decision}' (fail-closed)`,
                isError: true,
              }
              toolResults.push(toolResult)
              yield {
                type: 'tool_result',
                toolUseId: toolUse.id,
                content: toolResult.content,
                isError: true,
                durationMs: 0,
              }
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

                yield {
                  type: 'tool_approval_required',
                  toolName: toolUse.name,
                  riskTier: toolRiskTier,
                  reason: approvalReason,
                  requiresPreview,
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
                  // F2 T5 (D2) — durable park instead of deny-and-continue.
                  // Only reachable for an approval that produced a REAL queue
                  // row: parking on nothing would strand the run forever. A
                  // deterministic gate 'deny' never gets here (it `continue`d
                  // far above), so a park can never mask a hard denial.
                  if (queuedApprovalId !== undefined) {
                    // Same rule as the CLI path: a cancel wins over a park.
                    if (canPark && !options.signal?.aborted) {
                      yield parkEvent(queuedApprovalId, toolUse.name)
                      return
                    }
                    if (autonomous && sessionId) {
                      deps.logger?.warn?.(
                        { sessionId, toolName: toolUse.name, approvalId: queuedApprovalId },
                        'park skipped: no event store',
                      )
                    }
                  }

                  const denyReason = callbackFailure
                    ? `approval callback threw: ${callbackFailure}`
                    : deps.onApprovalRequired
                      ? `human reviewer denied: ${approvalReason}`
                      : `approval required but no reviewer configured: ${approvalReason}`
                  yield { type: 'tool_approval_denied', toolName: toolUse.name, reason: denyReason }
                  const toolResult: ToolResultBlock = {
                    type: 'tool_result',
                    toolUseId: toolUse.id,
                    content: `Approval denied: ${denyReason}`,
                    isError: true,
                  }
                  toolResults.push(toolResult)
                  yield {
                    type: 'tool_result',
                    toolUseId: toolUse.id,
                    content: toolResult.content,
                    isError: true,
                    durationMs: 0,
                  }
                  continue
                }
              }
            }
          }

          // Warm-resume idempotency guard (post-gate): hard-skip a destructive
          // tool call already executed on the original run so a resume cannot
          // re-fire its side effect. Sits AFTER the gate (gate still authorizes)
          // and BEFORE the ToolCall append (a skipped call is not re-recorded).
          if (options.idempotencyLedger?.has(`${toolUse.name}:${argHash(toolUse.input)}`)) {
            const skipResult: ToolResultBlock = {
              type: 'tool_result',
              toolUseId: toolUse.id,
              content: 'Skipped: this tool call was already executed on the original run (resumed run — duplicate side effect prevented).',
              isError: false,
            }
            toolResults.push(skipResult)
            yield {
              type: 'tool_result',
              toolUseId: toolUse.id,
              content: skipResult.content,
              isError: false,
              durationMs: 0,
            }
            // NOTE: no ToolResult event is emitted for a skip. Ledger
            // transitivity across a resume chain is handled by resumeRun walking
            // the parent_run_id lineage, so re-recording here is unnecessary (and
            // would emit a ToolResult with no preceding ToolCall).
            continue
          }

          // Capture the authorized tool call (post-gate/post-approval, pre-exec)
          // so resume can derive an idempotency ledger (do-not-repeat).
          await emitEvent(EventTypes.ToolCall, {
            toolName: toolUse.name,
            input: toolUse.input as Record<string, unknown>,
            toolUseId: toolUse.id,
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
              }
            : undefined
          const result = await toolExecutor.execute(
            toolUse.name,
            toolUse.input,
            execContext,
          )

          // If the tool returned a teamSessionId (e.g. propose_team), propagate
          // it into the shared toolContext so subsequent write_team_memory /
          // read_team_memory calls in this run can resolve it without the user
          // having to pass it manually. Set sessionId alongside it — inside a
          // team run the team session IS the messaging session, and the
          // agent-messaging tools key on ctx.sessionId, not teamSessionId.
          if (toolContext && result.success && result.output && typeof result.output === 'object') {
            const maybeId = (result.output as any).teamSessionId
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

          // Capture the result so a resumed run can replay/audit it. Carry
          // toolName + argHash + a bounded preview so the resume idempotency
          // ledger can be rebuilt from SUCCESSFUL results (see resumeRun).
          await emitEvent(EventTypes.ToolResult, {
            toolUseId: toolUse.id,
            toolName: toolUse.name,
            argHash: argHash(toolUse.input),
            argPreview: (() => { try { return JSON.stringify(toolUse.input).slice(0, 200) } catch { return '' } })(),
            output: result.output,
            durationMs: result.durationMs ?? 0,
            success: result.success,
            ...(result.error ? { error: String(result.error) } : {}),
          })

          // Yield tool result event for real-time UI updates
          yield {
            type: 'tool_result',
            toolUseId: toolUse.id,
            content,
            isError: !result.success,
            durationMs: result.durationMs,
          }
        }

        // Synthetic results for per-turn-truncated tool_use blocks: the assistant
        // message carries the FULL response.content (all tool_use, including the
        // truncated ones), so EVERY tool_use needs a matching tool_result or the
        // assistant+tool_result pair is provider-invalid (Anthropic 400) — both
        // for the live continuation and for a cold-resume from the captured state.
        for (const tb of truncatedBlocks) {
          toolResults.push({
            type: 'tool_result',
            toolUseId: tb.id,
            content: `Skipped: per-turn tool-call limit (${maxToolCallsPerTurn}) reached; this call was not executed.`,
            isError: true,
          })
        }

        // Add tool results as user message (Anthropic convention: tool_result in user role)
        messages.push({ role: 'user', content: toolResults as ContentBlock[] })

        // Clean boundary (assistant + tool_result pair complete) — capture a
        // resumable checkpoint if the policy fires.
        await captureCheckpoint(turn)

        // Terminate early if we hit the absolute tool-call budget
        if (toolBudgetExhausted) {
          yield { type: 'tool_budget_exhausted', totalCalls: totalToolCalls, limit: maxTotalToolCalls }
          break
        }
      }

      // Yield the single 'done' event AFTER the loop ends — the routes handler
      // uses this to save exactly one assistant message and set status to idle.
      if (lastResponse) {
        yield { type: 'done', response: lastResponse } as AgentEvent
      }

      if (turn >= maxTurns) {
        yield { type: 'max_turns_reached', turns: turn }
      }
    },
  }
}
