// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// OpenCode ↔ EYAS memory, in process. OpenCode cannot import EYAS (separate
// process): the EYAS memory plugin inside it (plugin-source.ts) offers the
// model the same memory_search / memory_expand tools every EYAS run has and
// posts each call back to EYAS with a one-time proof for its own OpenCode
// session, made with its process's key (plugin-tokens.ts). This file holds
// two things:
//
//  - Session bindings. When EYAS itself creates an OpenCode session
//    (developer-agent.ts) it records, in this process only, which
//    conversation and user the session acts for and which key its server
//    holds. A plugin call is locked to that conversation's project only when
//    its proof names that session and was made with that key; an unknown
//    session, one bound under another key, or a signed-in caller who is not
//    the bound user reads global memory only (routes.ts). Nothing in a
//    request can create or widen a binding.
//
//  - Capture. No model decides what EYAS remembers: the plugin has no save
//    tool. A task's tool output and the terminal panel's output are recorded
//    like every other run's tool output — only with
//    memory.l0.captureToolResults on (capturePolicy), as 'tool_result' rows
//    with trust 'ingested', scoped to the conversation's project.
//
// A task's memory hydration is not here: it is the one recall block
// (ctx.memoryRecall), sent as the prompt's `system` (developer-agent.ts).

import { z } from 'zod'
import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto.js'
import { captureUnit, capturePolicy, type CapturePolicy } from '@modules/memory/v2/ingest-bridge.js'
import { clippedInput, EMPTY_OUTPUTS } from '@modules/memory/v2/run-capture.js'
import { findConversationScope, resolveConversationScope } from '@modules/memory/v2/scope.js'
import type {
  OpencodeEvent,
  OpencodeSessionBinding,
  OpencodeSessionCaller,
  OpencodeSessionScope,
  PtyKind,
} from './types.js'

/** A binding nobody used for this long is dropped (a crashed task never unbinds). */
export const SESSION_BINDING_TTL_MS = 30 * 60_000

export interface OpencodeSessionBindings {
  /** In process only: EYAS created `sessionId` on the server holding key `tokenId`. */
  bind(tokenId: string, sessionId: string, scope: OpencodeSessionScope): OpencodeSessionBinding
  /**
   * The binding a call may act for, or null. A plugin's proof must have been
   * made with the key the session was bound under; a signed-in user must be
   * the bound user. A live lookup is a use: it starts the binding's TTL over.
   */
  lookup(sessionId: string | null | undefined, caller: OpencodeSessionCaller): OpencodeSessionBinding | null
  unbind(sessionId: string): void
  size(): number
}

export function createSessionBindings(opts: { ttlMs?: number; now?: () => number } = {}): OpencodeSessionBindings {
  const ttlMs = opts.ttlMs ?? SESSION_BINDING_TTL_MS
  const now = opts.now ?? Date.now
  const bindings = new Map<string, { binding: OpencodeSessionBinding; lastUsedAt: number }>()

  const sweep = (t: number): void => {
    for (const [sessionId, entry] of bindings) {
      if (t - entry.lastUsedAt > ttlMs) bindings.delete(sessionId)
    }
  }

  return {
    bind(tokenId, sessionId, scope) {
      const t = now()
      sweep(t)
      const binding: OpencodeSessionBinding = { ...scope, tokenId, sessionId, captured: new Set<string>() }
      bindings.set(sessionId, { binding, lastUsedAt: t })
      return binding
    },

    lookup(sessionId, caller) {
      if (!sessionId) return null
      const t = now()
      sweep(t)
      const entry = bindings.get(sessionId)
      if (!entry) return null
      const { binding } = entry
      const matches = caller.kind === 'plugin'
        ? caller.tokenId.length > 0 && binding.tokenId === caller.tokenId
        : caller.userId.length > 0 && binding.userId === caller.userId
      if (!matches) return null
      entry.lastUsedAt = t
      return binding
    },

    unbind(sessionId) {
      bindings.delete(sessionId)
    },

    size() {
      return bindings.size
    },
  }
}

// ─── Capture ────────────────────────────────────────────────────────────────

export interface OpencodeCaptureDeps {
  db: EyasDb
  /** The opt-in switches. Defaults to the bridge's (memory.l0.*). */
  policy?: () => CapturePolicy
  now?: () => number
}

const ToolInputSchema = z.record(z.string(), z.unknown()).catch({}).default({})
const ToolTimeSchema = z.object({ end: z.number().finite().optional() }).optional().catch(undefined)

/**
 * A settled tool part (`message.part.updated`, 1.18.29): the part is sent
 * again on every state change. A 'completed' one carries what the tool
 * returned (`output`), an 'error' one what went wrong (`error`). Parsed
 * tolerantly; anything else (pending, running, not a tool) is not a result.
 */
const SettledToolPartSchema = z.object({
  part: z.object({
    type: z.literal('tool'),
    sessionID: z.string().min(1).max(200),
    callID: z.string().min(1).max(200),
    tool: z.string().min(1).max(200),
    state: z.discriminatedUnion('status', [
      z.object({ status: z.literal('completed'), input: ToolInputSchema, output: z.string().catch(''), time: ToolTimeSchema }),
      z.object({ status: z.literal('error'), input: ToolInputSchema, error: z.string().catch(''), time: ToolTimeSchema }),
    ]),
  }),
})

/**
 * The error texts of an OpenCode tool call that never ran (1.18.29): the
 * permission was refused (by the EYAS gate or a rule) or a question was
 * dismissed. Like a refused call anywhere else, it leaves no result.
 */
const REFUSED_CALL_ERRORS: readonly RegExp[] = [
  /rejected permission to use this specific tool call/i,
  /specified a rule which prevents you from using this specific tool call/i,
  /dismissed this question/i,
]

/**
 * Record one OpenCode tool result of an EYAS task, the way a run records its
 * tool output (memory/v2/run-capture.ts): only with
 * memory.l0.captureToolResults on, once per call (callID), trust 'ingested',
 * in the bound conversation's project. The content is what the tool
 * returned — or, for a call that ran and failed, its error, marked
 * isError / outcome 'error'; a refused call ran nothing and leaves nothing.
 * Its arguments are kept as provenance only (meta.input). No binding — an
 * attached external server, or a session EYAS did not create — means no
 * capture. Returns whether a unit was captured; never throws.
 */
export function captureOpencodeToolEvent(
  event: OpencodeEvent,
  binding: OpencodeSessionBinding | null | undefined,
  deps: OpencodeCaptureDeps,
): boolean {
  if (!binding) return false
  try {
    if (event.type !== 'message.part.updated') return false
    if (!(deps.policy ?? capturePolicy)().toolResults) return false
    const parsed = SettledToolPartSchema.safeParse(event.properties ?? {})
    if (!parsed.success) return false
    const { part } = parsed.data
    if (binding.captured.has(part.callID)) return false
    binding.captured.add(part.callID)
    const failed = part.state.status === 'error'
    const output = part.state.status === 'error' ? part.state.error : part.state.output
    if (failed && REFUSED_CALL_ERRORS.some((re) => re.test(output))) return false
    if (EMPTY_OUTPUTS.has(output.trim())) return false
    const scope = resolveConversationScope(deps.db, binding.conversationId)
    const endedAt = part.state.time?.end
    captureUnit({
      id: generateId(),
      sourceType: 'tool_result',
      actor: `tool:${part.tool}`,
      conversationId: binding.conversationId,
      projectId: scope.projectId,
      projectTypeId: scope.projectTypeId,
      occurredAtMs: typeof endedAt === 'number' && endedAt > 0 ? endedAt : (deps.now ?? Date.now)(),
      // What the call returned (or its error): indexed and extracted.
      content: JSON.stringify({ tool: part.tool, output, isError: failed, outcome: failed ? 'error' : 'success', executedBy: 'provider' }),
      trustTier: 'ingested',
      meta: {
        origin: 'opencode',
        entryPath: 'opencode',
        provider: 'opencode',
        model: binding.model ?? null,
        agentId: binding.agentId ?? scope.agentId ?? null,
        sessionId: binding.runId ?? null,
        opencodeSessionId: part.sessionID,
        toolUseId: part.callID,
        toolName: part.tool,
        // What the model asked for: provenance only, never indexed or extracted.
        input: clippedInput(part.state.input),
      },
    })
    return true
  } catch {
    return false
  }
}

export interface PtyCaptureInput {
  sessionId: string
  userId: string
  conversationId: string
  text: string
  kind: PtyKind
}

/**
 * Record a chunk of terminal-panel output (the OpenCode TUI or a shell) —
 * only with memory.l0.captureToolResults on, only for a conversation that
 * exists and belongs to the terminal's user, in that conversation's project,
 * trust 'ingested', actor `pty:<kind>`. Returns whether a unit was captured;
 * never throws.
 */
export function capturePtyOutput(input: PtyCaptureInput, deps: OpencodeCaptureDeps): boolean {
  try {
    if (!input.conversationId || !input.text.trim()) return false
    if (!(deps.policy ?? capturePolicy)().toolResults) return false
    const scope = findConversationScope(deps.db, input.conversationId)
    if (!scope) return false
    if (scope.userId && scope.userId !== input.userId) return false
    captureUnit({
      id: generateId(),
      sourceType: 'tool_result',
      actor: `pty:${input.kind}`,
      conversationId: input.conversationId,
      projectId: scope.projectId,
      projectTypeId: scope.projectTypeId,
      occurredAtMs: (deps.now ?? Date.now)(),
      content: input.text,
      trustTier: 'ingested',
      meta: {
        origin: 'terminal',
        entryPath: 'terminal',
        provider: input.kind === 'tui' ? 'opencode' : null,
        ptySessionId: input.sessionId,
        kind: input.kind,
      },
    })
    return true
  } catch {
    return false
  }
}
