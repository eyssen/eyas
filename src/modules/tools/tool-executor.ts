// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolRegistry } from './tool-registry.js'
import type { ToolAbility, ToolContext, ToolImplementation, ToolResult } from './types.js'
import type { ToolOutputContext } from '@modules/privacy/service.js'
import { formatToolOutput } from './aci-layer.js'
import { argHash } from '@shared/arg-hash.js'
import { workspaceFromContext } from './working-directories.js'
import {
  createDefaultPreToolUseHooks,
  createToolHookRegistry,
  type ToolHookRegistry,
} from './hooks.js'

export interface ExecutionResult {
  success: boolean
  output?: ToolResult
  error?: string
  /**
   * Structured error code for machine-readable handling. APPROVAL_REQUIRED:
   * the call was not run because it waits on a human — an approval row was
   * queued for it (approvalId). DENIED: it was refused outright.
   */
  errorCode?: 'NOT_FOUND' | 'INVALID_INPUT' | 'TIMEOUT' | 'OUTPUT_TOO_LARGE' | 'EXECUTION_ERROR' | 'DENIED' | 'APPROVAL_REQUIRED'
  /** The queued approval row when errorCode is APPROVAL_REQUIRED (absent when the queue did not return one). */
  approvalId?: number
  /** Zod validation issues when errorCode === 'INVALID_INPUT' */
  issues?: Array<{ path: (string | number)[]; message: string; code: string }>
  durationMs: number
}

export interface ExecutionLogEntry {
  toolName: string
  conversationId?: string
  agentId?: string
  /** The supervised run the call belongs to (ToolContext.runId); persisted as tool_executions.run_id. */
  runId?: string
  input: Record<string, unknown>
  output?: ToolResult
  error?: string
  success: boolean
  durationMs: number
  timestamp: string
}

/**
 * A tool call a provider's own runtime executed (a CLI-native tool such as
 * Claude Code's Bash or Grok's file tools): the EYAS executor never ran it,
 * so recordExternal is how it reaches tool_executions. The agent runner
 * reports it (AgentRunnerDeps.recordExternalToolExecution).
 */
export interface ExternalToolExecutionEntry {
  /** Canonical name (Bash → run_command). */
  toolName: string
  /** The input as the provider reported it. */
  input: Record<string, unknown>
  /** The tool's output, or its error text, as the provider reported it. */
  output: string
  success: boolean
  durationMs: number
  conversationId?: string
  agentId?: string
  /** The supervised run (agent_sessions.id); persisted as tool_executions.run_id. */
  runId?: string
  /**
   * Who ran it. Only 'provider' is recorded: a bridged EYAS tool ('eyas') was
   * already logged when the executor ran it, and an unknown executor is left
   * out rather than risk counting a call twice.
   */
  executedBy?: 'eyas' | 'provider'
}

/** The error text a failed external call keeps (the runner's ToolResult event keeps as much). */
const EXTERNAL_ERROR_MAX_CHARS = 2_000

/**
 * Security-gate surface the executor consumes. Structurally satisfied by the
 * object the security-gate module publishes on the context.
 */
export interface ExecutorSecurityGate {
  validateToolCall(
    toolName: string,
    input: Record<string, unknown>,
    callCtx?: { conversationId?: string; agentId?: string; parentGoal?: string; workingDirectories?: readonly string[] },
  ): Promise<{ decision: 'allow' | 'deny' | 'escalate' | 'judge_error'; reason: string; riskTier: 'green' | 'yellow' | 'red' }>
  autonomyPolicy?: {
    categoryForTool(toolName: string, riskTier?: 'green' | 'yellow' | 'red'): string | null
    resolve(category: string): { level: number; locked: boolean }
    createApproval(input: {
      category: string
      toolName?: string
      agentId?: string
      conversationId?: string
      reason?: string
      inputJson?: string
      argHash?: string
      runId?: string
      expiresAt?: string
    }): unknown
    /** D4 grant ledger — see autonomy-policy.ts consumeGrant(). Optional so older gate stubs stay valid. */
    consumeGrant?(input: { conversationId: string; toolName: string; argHash: string; now?: string }): { granted: boolean; approvalId?: number }
    /** D5 — the TTL-stamped expiry a fresh escalation should carry. Optional so older gate stubs stay valid. */
    defaultExpiresAt?(now?: string): string
  }
}

/**
 * The privacy mask for a tool result that leaves EYAS past the model gateway
 * (ctx.privacy.redactToolOutput): always the remote-destination mask.
 */
export type ModelOutputRedactor = (toolName: string, output: unknown, ctx: ToolOutputContext) => { value: unknown }

/** The result shape renderForModel serialises: an ExecutionResult, or a failure a bridge produced itself. */
export type RenderableResult = Pick<ExecutionResult, 'success' | 'output' | 'error'>

/** What a model is answered for one tool call on a transport outside the gateway. */
export interface ModelToolText {
  text: string
  isError: boolean
}

/** Sent instead of a memory tool's result when its privacy scan failed (fail closed). */
export const MEMORY_RESULT_WITHHELD = 'Error: memory tool result withheld (privacy scan failed)'

export interface AuthorizationDeps {
  /** Lazy — the security-gate module registers AFTER tools. */
  getSecurityGate: () => ExecutorSecurityGate | undefined
  getAbilityForRole: (role: string) => ToolAbility | undefined
}

interface ExecutorOptions {
  /**
   * Authorization dependencies for the executor's choke point. OMITTING this
   * denies every call (fail-closed) — a caller that forgets to wire it gets
   * an inert executor, not an ungated one. `'disabled'` is the explicit
   * opt-out for tests that exercise validation/timeout/cap mechanics.
   */
  authorization?: AuthorizationDeps | 'disabled'
  logExecution?: (entry: ExecutionLogEntry) => void
  defaultTimeoutMs?: number
  /**
   * Maximum serialised output size in bytes. Output exceeding this is
   * truncated and marked with `__truncated: true`. Default 1 MiB.
   */
  maxOutputBytes?: number
  /**
   * Optional bus to emit `tools:executed` on after a completed run (success
   * or thrown error). This is forge's feedback auto-scrape source
   * (`target: 'tool'`, `useful`, `friction`) — see `forge/index.ts`. Emitting
   * is best-effort and fail-safe: a throwing `bus.emit` must never affect
   * the tool result.
   */
  bus?: { emit(subject: string, data: unknown): void }
  /**
   * Universal Pre/Post tool hooks (P4). When omitted, a registry with the
   * built-in safety PreToolUse hooks is created. Pass an existing registry
   * to share hooks across modules (e.g. tools module publishes it on ctx).
   */
  hooks?: ToolHookRegistry
  /** Skip default safety hooks when providing a custom empty registry. */
  disableDefaultHooks?: boolean
  /**
   * The privacy mask renderForModel applies to memory-bearing output
   * (ctx.privacy.redactToolOutput), resolved per call: the privacy module
   * starts after tools. Absent (or returning undefined) = the privacy module
   * is off, and output goes out raw — exactly as a prompt does when no egress
   * filter is installed.
   */
  getModelOutputRedactor?: () => ModelOutputRedactor | undefined
  /** Where renderForModel reports a failed privacy scan. */
  logger?: { error(obj: unknown, msg?: string): void }
}

/** Default output cap (1 MiB). */
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024

/**
 * Cap the serialised size of a tool output. If the JSON-encoded output
 * exceeds `maxBytes`, replace string fields with truncated versions and mark
 * the result with `__truncated: true`. This is best-effort — a pathological
 * deeply-nested object may still exceed the cap slightly.
 */
function capOutput(output: ToolResult, maxBytes: number): { output: ToolResult; truncated: boolean } {
  let json: string
  try {
    json = JSON.stringify(output)
  } catch {
    return { output: { __truncated: true, reason: 'unserialisable' }, truncated: true }
  }
  if (json.length <= maxBytes) {
    return { output, truncated: false }
  }

  // Walk the object and truncate any string fields that blow the budget.
  const budget = Math.floor(maxBytes / 2) // leave headroom for structure
  const truncateString = (s: string) => {
    if (s.length <= budget) return s
    return s.slice(0, budget) + `\n... [truncated: original length ${s.length} chars]`
  }

  const walk = (val: unknown): unknown => {
    if (typeof val === 'string') return truncateString(val)
    if (Array.isArray(val)) return val.map(walk)
    if (val && typeof val === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(val)) out[k] = walk(v)
      return out
    }
    return val
  }

  const capped = walk(output) as ToolResult
  capped.__truncated = true
  return { output: capped, truncated: true }
}

/**
 * The toolset rule: a run calls only a tool it was offered
 * (ToolContext.allowedTools). Null when `toolName` is in `allowed`, or when
 * no toolset applies; otherwise the reason for the refusal. The executor
 * enforces it; the agent runner asks it before its own gate, so a tool the
 * run was never offered does not raise an approval first.
 */
export function toolsetDenial(allowed: ReadonlySet<string> | undefined, toolName: string): string | null {
  if (!allowed || allowed.has(toolName)) return null
  return `'${toolName}' is not in this agent's toolset`
}

/**
 * The single authorization choke point for tool execution. Returns `null`
 * when the call is authorized, or a ready-to-return denial otherwise.
 *
 * Every step fails closed: a missing wiring, a missing actor, an absent
 * security gate, or a throwing gate all deny. The only bypasses are explicit
 * — `authorization: 'disabled'` at construction, and `securityPipelineHandled`
 * for in-process callers that already ran the gate (CASL still applies).
 */
async function authorize(
  auth: AuthorizationDeps | undefined,
  tool: ToolImplementation,
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext | undefined,
  start: number,
): Promise<ExecutionResult | null> {
  const deny = (reason: string): ExecutionResult => ({
    success: false,
    error: `Tool call denied: ${reason}`,
    errorCode: 'DENIED',
    durationMs: Date.now() - start,
  })

  if (!auth) return deny('tool authorization is not wired (fail-closed)')

  // 1. CASL — who is asking, and may they execute tools at all?
  const actor = ctx?.actor
  if (!actor) return deny('no actor identity on tool context (fail-closed)')
  const ability = actor.ability ?? auth.getAbilityForRole(actor.role)
  if (!ability) return deny(`no ability available for role "${actor.role}" (fail-closed)`)
  if (!ability.can('execute', 'Tool')) return deny(`role "${actor.role}" is not allowed to execute tools`)

  // 1b. The run's toolset: only a tool the run was offered. Before the
  //     trusted-pipeline shortcut below, so it binds those pipelines too.
  const outsideToolset = toolsetDenial(ctx?.allowedTools, toolName)
  if (outsideToolset) return deny(outsideToolset)

  // 2. Trusted in-process pipelines (agent-runner, the shared permission
  //    bridge behind Claude Code's canUseTool and the Grok/Kimi CLI-MCP
  //    bridge) already ran gate + approval for THIS call — don't double-judge.
  if (ctx?.securityPipelineHandled) return null

  // 3. Security gate — fail-closed when the module is absent or throws.
  const gate = auth.getSecurityGate()
  if (!gate) return deny('security gate unavailable (fail-closed)')
  let check: Awaited<ReturnType<ExecutorSecurityGate['validateToolCall']>>
  try {
    const workspace = workspaceFromContext(ctx)
    check = await gate.validateToolCall(toolName, input, {
      conversationId: ctx?.conversationId,
      agentId: ctx?.agentId,
      parentGoal: ctx?.parentGoal,
      // The memory-path policy's cross-workspace refinement.
      workingDirectories: workspace.ok ? workspace.roots : undefined,
    })
  } catch (err) {
    return deny(`security gate error (fail-closed): ${err instanceof Error ? err.message : String(err)}`)
  }
  if (check.decision === 'deny') return deny(`security gate: ${check.reason}`)
  if (check.decision === 'judge_error') return deny(`security gate judge error (fail-closed): ${check.reason}`)
  if (check.decision !== 'allow' && check.decision !== 'escalate') {
    return deny(`unknown gate verdict '${check.decision}' (fail-closed)`)
  }

  // 4. Approval-requiring calls have no human in the loop on this path — the
  //    autonomy ladder is the only authority. A green gate-allow is already
  //    the authority (dedicated read-only tools, and Bash/run_command argv
  //    that matches them) — requiresApproval must not re-impose a click.
  if (check.decision === 'allow' && check.riskTier === 'green') return null

  const needsApproval = tool.requiresApproval === true || check.decision === 'escalate'
  if (needsApproval) {
    const autonomy = gate.autonomyPolicy
    if (!autonomy) return deny(`approval required but no reviewer available on this path: ${check.reason}`)

    const category = autonomy.categoryForTool(toolName, check.riskTier)
    if (category) {
      const { level, locked } = autonomy.resolve(category)
      if (level >= 3 && !locked) return null
    }

    // F2 T3 — grant check BEFORE the deny-for-approval branch below: a prior
    // human approval for this EXACT call (same conversation + tool + args)
    // authorizes it exactly once. Never consulted for a deterministic gate
    // 'deny' — that verdict returns above, long before this point, so a grant
    // can never override it.
    const callArgHash = argHash(input)
    if (autonomy.consumeGrant && ctx?.conversationId) {
      let grant: { granted: boolean; approvalId?: number } | null = null
      try {
        grant = autonomy.consumeGrant({ conversationId: ctx.conversationId, toolName, argHash: callArgHash })
      } catch {
        // Fail closed to the normal enqueue+deny flow below.
      }
      if (grant?.granted) {
        ctx?.logger?.info?.({ toolName, approvalId: grant.approvalId }, 'gate:grant_consumed')
        return null
      }
    }

    // I3 — a row with no conversation_id can never be granted (consumeGrant
    // requires a conversationId), so it would just be a dead row that grows
    // on every retry. Skip the enqueue and say so explicitly instead of
    // silently creating a queue entry no one can ever act on productively.
    if (!ctx?.conversationId) {
      return deny(`approval required (${category ?? 'uncategorized'}) but this execution path cannot receive grants (no conversation scope): ${check.reason}`)
    }

    // Enqueue-everywhere (F2 T3): every approval-requiring call gets a row,
    // even an uncategorized one — a category-less escalation used to be
    // denied with NO row at all, leaving the operator nothing to approve.
    let approvalId: number | undefined
    try {
      const id = autonomy.createApproval({
        category: category ?? 'uncategorized',
        toolName,
        agentId: ctx?.agentId,
        conversationId: ctx.conversationId,
        inputJson: JSON.stringify(input),
        argHash: callArgHash,
        expiresAt: autonomy.defaultExpiresAt?.(),
        reason: check.reason,
        // The supervised run this call belongs to: without it an approval
        // raised through the CLI-MCP bridge could never wake its run.
        ...(ctx.runId ? { runId: ctx.runId } : {}),
      })
      if (typeof id === 'number' && Number.isFinite(id)) approvalId = id
    } catch {
      // Approval-queue visibility is best-effort — the refusal stands either way.
    }
    // Waiting on a human, not refused: a caller that shows the call can
    // tell the two apart.
    return {
      success: false,
      error: `Tool call denied: approval required (${category ?? 'uncategorized'}): ${check.reason}`,
      errorCode: 'APPROVAL_REQUIRED',
      ...(approvalId !== undefined ? { approvalId } : {}),
      durationMs: Date.now() - start,
    }
  }

  return null
}

export function createToolExecutor(registry: ToolRegistry, options: ExecutorOptions = {}) {
  const defaultTimeout = options.defaultTimeoutMs ?? 30_000
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  const authorization = options.authorization
  const hooks =
    options.hooks ??
    createToolHookRegistry(options.disableDefaultHooks ? [] : createDefaultPreToolUseHooks())

  // Fire-and-forget signal for forge's feedback auto-scrape. Guarded so a
  // misbehaving listener can never surface as a tool-execution failure.
  const emitExecuted = (toolName: string, success: boolean, ctx: ToolContext | undefined, error?: string) => {
    try {
      options.bus?.emit('tools:executed', {
        toolName,
        success,
        error,
        conversationId: ctx?.conversationId,
        agentId: ctx?.agentId,
      })
    } catch {
      // Never let feedback collection affect the tool result.
    }
  }

  return {
    /** Shared hook registry — modules can add Pre/Post hooks at runtime. */
    hooks,

    /**
     * The single model-facing serialisation of one tool call on a transport
     * outside the model gateway: Claude Code's MCP bridge, the Grok/Kimi ACP
     * bridge and external MCP clients. A failure is 'Error: <reason>'
     * (isError); a success is the output as compact JSON ('{}' when empty).
     * Nothing on these transports passes the gateway's egress filter, so a
     * memory-bearing tool's text — its error text too — is masked here first,
     * for a remote destination, by the same function; any other tool's text is
     * exactly JSON.stringify of its output. A scan that throws withholds the
     * memory result (fail closed).
     */
    renderForModel(toolName: string, result: RenderableResult, ctx: ToolOutputContext): ModelToolText {
      const isError = !result.success
      let value: unknown = isError ? `Error: ${result.error}` : (result.output ?? {})
      if (registry.get(toolName)?.memoryBearing === true) {
        try {
          const redact = options.getModelOutputRedactor?.()
          if (redact) value = redact(toolName, value, ctx).value
        } catch (err) {
          options.logger?.error(
            {
              err: err instanceof Error ? err.message : String(err),
              tool: toolName,
              transport: ctx.transport,
              conversationId: ctx.conversationId,
            },
            'Privacy scan of a memory tool result failed — result withheld',
          )
          return { text: MEMORY_RESULT_WITHHELD, isError: true }
        }
      }
      return { text: isError ? String(value) : JSON.stringify(value), isError }
    },

    /**
     * Record a tool call the provider's runtime executed itself, as one
     * tool_executions row carrying its run. Nothing is executed, authorized,
     * hooked or announced: the call already ran, under the provider's own
     * permission bridge. Tool output reaches memory from the agent run that
     * saw it (memory/v2/run-capture.ts), never from here. Returns whether a
     * row was written; a failed write is swallowed (observability only).
     */
    recordExternal(entry: ExternalToolExecutionEntry): boolean {
      if (entry.executedBy !== 'provider' || !entry.toolName || !options.logExecution) return false
      const text = typeof entry.output === 'string' ? entry.output : ''
      const durationMs = Number.isFinite(entry.durationMs) ? Math.max(0, Math.round(entry.durationMs)) : 0
      const input = entry.input && typeof entry.input === 'object' && !Array.isArray(entry.input) ? entry.input : {}
      try {
        options.logExecution({
          toolName: entry.toolName,
          input,
          ...(entry.success
            ? { output: capOutput({ text }, maxOutputBytes).output }
            : { error: text.slice(0, EXTERNAL_ERROR_MAX_CHARS) || 'failed' }),
          success: entry.success === true,
          durationMs,
          timestamp: new Date().toISOString(),
          conversationId: entry.conversationId,
          agentId: entry.agentId,
          runId: entry.runId,
        })
        return true
      } catch {
        return false
      }
    },

    async execute(
      toolName: string,
      input: Record<string, unknown>,
      ctx?: ToolContext,
    ): Promise<ExecutionResult> {
      const start = Date.now()
      const tool: ToolImplementation | undefined = registry.get(toolName)

      if (!tool) {
        const result: ExecutionResult = {
          success: false,
          error: `Tool not found: ${toolName}`,
          errorCode: 'NOT_FOUND',
          durationMs: Date.now() - start,
        }
        options.logExecution?.({
          toolName,
          input,
          success: result.success,
          error: result.error,
          durationMs: result.durationMs,
          timestamp: new Date().toISOString(),
          conversationId: ctx?.conversationId,
          agentId: ctx?.agentId,
          runId: ctx?.runId,
        })
        return result
      }

      // --- 0. Authorization choke point ------------------------------------
      // Runs before validation so an unauthorized caller learns nothing about
      // the tool's schema. Every path into the executor lands here.
      if (authorization !== 'disabled') {
        // execute() never throws — a blowing-up authorization dependency (the
        // autonomy policy reads the DB) must surface as a denial, not as a
        // rejected promise that would break the caller's agentic loop.
        let denial: ExecutionResult | null
        try {
          denial = await authorize(authorization, tool, toolName, input, ctx, start)
        } catch (err) {
          denial = {
            success: false,
            error: `Tool call denied: authorization error (fail-closed): ${err instanceof Error ? err.message : String(err)}`,
            errorCode: 'DENIED',
            durationMs: Date.now() - start,
          }
        }
        if (denial) {
          options.logExecution?.({
            toolName,
            input,
            success: false,
            error: denial.error,
            durationMs: denial.durationMs,
            timestamp: new Date().toISOString(),
            conversationId: ctx?.conversationId,
            agentId: ctx?.agentId,
            runId: ctx?.runId,
          })
          emitExecuted(toolName, false, ctx, denial.error)
          return denial
        }
      }

      // --- 0b. Universal PreToolUse hooks (P4) -----------------------------
      let effectiveInput = input
      try {
        const pre = await hooks.runPreToolUse({ toolName, input, tool, ctx })
        if (pre.decision === 'deny') {
          const result: ExecutionResult = {
            success: false,
            error: `Tool call denied: PreToolUse hook: ${pre.reason ?? 'blocked'}`,
            errorCode: 'DENIED',
            durationMs: Date.now() - start,
          }
          options.logExecution?.({
            toolName,
            input,
            success: false,
            error: result.error,
            durationMs: result.durationMs,
            timestamp: new Date().toISOString(),
            conversationId: ctx?.conversationId,
            agentId: ctx?.agentId,
            runId: ctx?.runId,
          })
          emitExecuted(toolName, false, ctx, result.error)
          return result
        }
        if (pre.input) effectiveInput = pre.input
      } catch (err) {
        const result: ExecutionResult = {
          success: false,
          error: `Tool call denied: PreToolUse hook error (fail-closed): ${err instanceof Error ? err.message : String(err)}`,
          errorCode: 'DENIED',
          durationMs: Date.now() - start,
        }
        emitExecuted(toolName, false, ctx, result.error)
        return result
      }

      // --- 1. Runtime input validation (Zod) -------------------------------
      let validatedInput: Record<string, unknown> = effectiveInput
      if (tool.validator) {
        const parsed = tool.validator.safeParse(effectiveInput)
        if (!parsed.success) {
          const issues = parsed.error.issues.map(i => ({
            path: i.path,
            message: i.message,
            code: i.code,
          }))
          const result: ExecutionResult = {
            success: false,
            error: `Invalid input for tool '${toolName}': ${issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
            errorCode: 'INVALID_INPUT',
            issues,
            durationMs: Date.now() - start,
          }
          options.logExecution?.({
            toolName,
            input: effectiveInput,
            success: false,
            error: result.error,
            durationMs: result.durationMs,
            timestamp: new Date().toISOString(),
            conversationId: ctx?.conversationId,
            agentId: ctx?.agentId,
            runId: ctx?.runId,
          })
          return result
        }
        validatedInput = parsed.data as Record<string, unknown>
      } else {
        // No Zod validator — do a minimal sanity check and warn.
        if (effectiveInput === null || typeof effectiveInput !== 'object' || Array.isArray(effectiveInput)) {
          const result: ExecutionResult = {
            success: false,
            error: `Invalid input for tool '${toolName}': expected an object`,
            errorCode: 'INVALID_INPUT',
            durationMs: Date.now() - start,
          }
          options.logExecution?.({
            toolName,
            input: {},
            success: false,
            error: result.error,
            durationMs: result.durationMs,
            timestamp: new Date().toISOString(),
            conversationId: ctx?.conversationId,
            agentId: ctx?.agentId,
            runId: ctx?.runId,
          })
          return result
        }
        ctx?.logger?.warn({ toolName }, 'Tool has no Zod validator — input is not runtime-checked. Add a `validator` field.')
      }

      // --- 2. Timeout race ------------------------------------------------
      const timeout = tool.timeoutMs ?? defaultTimeout

      try {
        const output = await Promise.race([
          tool.execute(validatedInput, ctx),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(Object.assign(new Error(`Tool '${toolName}' timed out after ${timeout}ms`), { __timeout: true })), timeout)
          ),
        ])

        // --- 3. Output size cap -------------------------------------------
        const { output: capped, truncated } = capOutput(output, maxOutputBytes)
        let finalOutput: ToolResult = capped
        // --- 3a. ACI formatting (Phase-3M, opt-in per tool) ---------------
        // When the tool opts in, pick a display-field (default 'text') and
        // replace it with the ACI-formatted string. Raw output is preserved
        // under `_raw` so audit and replay can still see everything. Skipped
        // if the byte-cap already emitted the truncation placeholder.
        if (tool.aci?.enabled && !truncated) {
          const field = tool.aci.field ?? 'text'
          const rawValue = capped[field]
          if (typeof rawValue === 'string') {
            const formatted = formatToolOutput(rawValue, {
              maxChars: tool.aci.maxChars,
              headLines: tool.aci.headLines,
              tailLines: tool.aci.tailLines,
              followUpHint: tool.aci.followUpHint,
              structured: tool.aci.structured,
            })
            if (formatted.truncated) {
              finalOutput = {
                ...capped,
                [field]: formatted.text,
                _raw: rawValue,
                _aci: {
                  strategy: formatted.strategy,
                  originalChars: formatted.originalChars,
                  originalLines: formatted.originalLines,
                },
              }
            }
          }
        }
        const result: ExecutionResult = {
          success: true,
          output: finalOutput,
          durationMs: Date.now() - start,
        }
        if (truncated) {
          // Surface a soft warning via the error field in the log (but not
          // in the returned result, since this is still a successful call).
          ctx?.logger?.warn({ toolName, bytes: JSON.stringify(output).length }, 'Tool output truncated: exceeded max size')
        }
        options.logExecution?.({
          toolName,
          input: validatedInput,
          output: finalOutput,
          success: true,
          durationMs: result.durationMs,
          timestamp: new Date().toISOString(),
          conversationId: ctx?.conversationId,
          agentId: ctx?.agentId,
          runId: ctx?.runId,
        })
        emitExecuted(toolName, true, ctx)
        await hooks.runPostToolUse({
          toolName,
          input: validatedInput,
          tool,
          ctx,
          success: true,
          durationMs: result.durationMs,
          output: finalOutput as Record<string, unknown>,
        })
        return result
      } catch (err) {
        const isTimeout = Boolean(err && typeof err === 'object' && '__timeout' in err)
        const error = err instanceof Error ? err.message : String(err)
        const result: ExecutionResult = {
          success: false,
          error,
          errorCode: isTimeout ? 'TIMEOUT' : 'EXECUTION_ERROR',
          durationMs: Date.now() - start,
        }
        options.logExecution?.({
          toolName,
          input: validatedInput,
          success: false,
          error,
          durationMs: result.durationMs,
          timestamp: new Date().toISOString(),
          conversationId: ctx?.conversationId,
          agentId: ctx?.agentId,
          runId: ctx?.runId,
        })
        emitExecuted(toolName, false, ctx, error)
        await hooks.runPostToolUse({
          toolName,
          input: validatedInput,
          tool,
          ctx,
          success: false,
          durationMs: result.durationMs,
          error,
        })
        return result
      }
    },
  }
}
