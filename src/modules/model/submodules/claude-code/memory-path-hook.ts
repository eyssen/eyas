// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Claude Code's memory-policy PreToolUse hook — the one place Claude Code's
// own tools meet EYAS's memory-sovereignty path policy BEFORE they run.
//
// canUseTool (the permission bridge) only sees the calls the CLI asks about.
// Reads the CLI allows on its own (Read, Glob, Grep inside the working
// directory and similar) never reach it, so without this hook a Glob of
// ~/.grok/** or a Read of an Obsidian vault note could run ungated. A
// PreToolUse hook runs for every tool call, asked-about or not, including the
// bridged mcp__eyas__* tools. Grep, Glob and recursive Bash searches are
// judged by what they can reach below their folder: the CLI's own search
// cannot be told to leave a protected place out, so one rooted above it is
// refused with the policy's coded "search too broad" reason.
//
// The hook is deterministic: the policy's path check only, never the LLM
// judge (canUseTool already judges once per call). A violation answers
// permissionDecision 'deny' with the policy's reason; a clean path answers
// `continue` and never 'allow' — an allow here would skip canUseTool and the
// gate. Anything that goes wrong inside the hook is a deny: a hook that
// throws or times out is not a refusal to the CLI, so failing open here would
// let the call through.

import type { HookCallbackMatcher, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import { getPathPolicy } from '@shared/memory-sovereignty/path-policy.js'
import { memoryPathFailClosedReason, memoryPathReason } from '@shared/memory-sovereignty/deny-reason.js'

const EYAS_MCP_PREFIX = 'mcp__eyas__'

/** Who the checked call acts for and where the turn works (built server-side, never from the CLI's report). */
export interface MemoryPathHookContext {
  /** The turn's folders (cwd included), from cli-runtime resolveCliRoots. */
  workingDirectories?: readonly string[]
  conversationId?: string
  agentId?: string
}

/**
 * A memory-path check: null / undefined / an explicit allow means the paths
 * are fine; anything else is a deny, its `reason` shown to the model.
 * The security gate's checkMemoryPath has this shape (and writes one
 * security_events row per deny).
 */
export type MemoryPathHookCheck = (
  toolName: string,
  input: Record<string, unknown>,
  ctx: MemoryPathHookContext,
) => unknown

/** One call the hook refused (see MemoryPathHookOptions.onDeny). */
export interface MemoryPathHookDenial {
  /** The runtime's id for the call ('' when the runtime gave none). */
  toolUseId: string
  /** The tool name as the policy saw it (the mcp__eyas__ prefix stripped). */
  toolName: string
  reason: string
}

export interface MemoryPathHookOptions {
  check: MemoryPathHookCheck
  ctx: MemoryPathHookContext
  logger?: { warn(obj: unknown, msg?: string): void }
  /**
   * Observer for every deny, called before the deny is returned — how the
   * provider settles the call's tool row as 'denied' rather than as a plain
   * tool error. A throwing observer never changes the verdict.
   */
  onDeny?: (denial: MemoryPathHookDenial) => void
}

/**
 * The process-wide path policy as a check, for a query with no security gate
 * wired (same verdict and wording as the gate, no audit row).
 */
export const policyMemoryPathHookCheck: MemoryPathHookCheck = (toolName, input, ctx) => {
  const violation = getPathPolicy().evaluateToolInput(toolName, input, { workingDirectories: ctx.workingDirectories })
  return violation ? { decision: 'deny', reason: memoryPathReason(violation) } : null
}

/** The gate's audited check when one is wired, else the process-wide policy. */
export function memoryPathHookCheckFor(gateCheck?: MemoryPathHookCheck): MemoryPathHookCheck {
  return gateCheck ?? policyMemoryPathHookCheck
}

function deny(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Build the memory-policy matcher. No `matcher` pattern: it runs for every
 * tool. Registered only through mergeHooks' `sovereignty` slot, so it is the
 * first PreToolUse matcher of the query.
 */
export function buildMemoryPathHook(options: MemoryPathHookOptions): HookCallbackMatcher {
  const { check, ctx, logger, onDeny } = options
  const hook = async (input: HookInput): Promise<HookJSONOutput> => {
    let toolUseId = ''
    let toolName = ''
    const refuse = (reason: string): HookJSONOutput => {
      if (onDeny) {
        try {
          onDeny({ toolUseId, toolName, reason })
        } catch {
          // An observer never changes the verdict.
        }
      }
      return deny(reason)
    }
    try {
      if (input.hook_event_name !== 'PreToolUse') return { continue: true }
      toolUseId = typeof input.tool_use_id === 'string' ? input.tool_use_id : ''
      const rawName = typeof input.tool_name === 'string' ? input.tool_name : ''
      if (!rawName) return refuse('Memory-path policy: tool call without a tool name (fail-closed)')
      toolName = rawName.startsWith(EYAS_MCP_PREFIX) ? rawName.slice(EYAS_MCP_PREFIX.length) : rawName
      const raw = input.tool_input
      if (raw !== undefined && raw !== null && !isRecord(raw)) {
        return refuse(`Memory-path policy: unreadable input for ${toolName} (fail-closed)`)
      }
      const toolInput = isRecord(raw) ? raw : {}
      const verdict = (await check(toolName, toolInput, ctx)) as { decision?: unknown; reason?: unknown } | null | undefined
      if (verdict === null || verdict === undefined || verdict.decision === 'allow') return { continue: true }
      const reason = typeof verdict.reason === 'string' && verdict.reason ? verdict.reason : 'Memory-path policy'
      logger?.warn({ toolName, conversationId: ctx.conversationId, agentId: ctx.agentId, reason }, 'claude-code: memory-policy hook denied a tool call')
      return refuse(reason)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger?.warn({ err: message, conversationId: ctx.conversationId }, 'claude-code: memory-policy hook failed — call denied (fail-closed)')
      return refuse(memoryPathFailClosedReason(err))
    }
  }
  return { hooks: [hook] }
}
