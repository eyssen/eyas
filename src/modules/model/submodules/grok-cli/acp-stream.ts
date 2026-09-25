// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Maps one ACP session (Grok and Kimi CLIs) onto the provider-neutral stream
// contract (G1), so a CLI turn looks the same in the chat as any other
// provider's:
//   - every tool call becomes one tool row: tool_use_start under the
//     canonical name with the CLI's own title as rawName and the call's input,
//     re-emitted (upserted) as the CLI fills in its kind, title and input, and
//     settled by exactly one tool_result with the output, the duration and
//     how it ended (success, error, or the refusal EYAS gave it);
//   - a call waiting on a human raises approval_required;
//   - the turn's usage is read tolerantly and mapped onto canonical ModelUsage.
//
// Pure bookkeeping: acp-client.ts feeds it validated session updates
// (acp-events.ts) and EYAS's decisions, and yields what it returns.

import { z } from 'zod'
import type { ToolExecutor, ToolOutcome } from '@shared/chat-stream.js'
import { canonicalToolName, normalizeToolInput } from '@shared/canonical-tool-name.js'
import type { ModelUsage, StreamEvent } from '../../types.js'
import type { BridgeToolOutcome } from '../../cli-mcp/bridge-routes.js'
import type { AcpSessionEvent, AcpToolContent, AcpToolStatus } from './acp-events.js'

/** How much of a tool's output one tool_result carries (UTF-8 bytes). */
export const ACP_TOOL_OUTPUT_CAP_BYTES = 64 * 1024

/** A refusal outcome: the call never ran. */
export type AcpRefusalOutcome = Extract<ToolOutcome, 'denied' | 'approval_required' | 'skipped'>

/** EYAS refused one tool call (a governance decision, a gate verdict, a limit). */
export interface AcpToolRefusal {
  /** The CLI's id for the call; absent for a refusal nobody can attach to a row. */
  toolCallId?: string
  outcome: AcpRefusalOutcome
  reason: string
  /** The queued approval row, when outcome is 'approval_required'. */
  approvalId?: number
  /** The tool as the gate saw it (Bash, Write, …) — used when the call has no row. */
  toolName?: string
}

type ToolCallEvent = Extract<AcpSessionEvent, { kind: 'tool_call' | 'tool_call_update' }>
type ApprovalEvent = Extract<StreamEvent, { type: 'approval_required' }>

/**
 * A tool EYAS itself runs, called through the CLI's MCP bridge: Claude-style
 * `mcp__eyas__<tool>` or Grok's qualified `eyas__<tool>` (grok 1.0.40 reaches
 * MCP tools through use_tool with that name — A1 fixture mcp-dispatch.json).
 */
const EYAS_BRIDGE_TOOL_RE = /^(?:mcp__eyas__|eyas__)([A-Za-z][A-Za-z0-9_.:-]{0,127})$/

function eyasToolName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return EYAS_BRIDGE_TOOL_RE.exec(value.trim())?.[1]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Cut a text to at most `maxBytes` UTF-8 bytes, saying how much was left out. */
export function capToolOutput(text: string, maxBytes = ACP_TOOL_OUTPUT_CAP_BYTES): string {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= maxBytes) return text
  // A cut inside a multi-byte character decodes to U+FFFD: drop it.
  const head = bytes.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/, '')
  return `${head}\n… [output truncated: ${bytes.length - maxBytes} more bytes]`
}

/**
 * The text of a tool call's output: its ACP `content` text blocks, else its
 * rawOutput (a string as is, anything else as JSON). Diffs and terminals carry
 * no text of their own.
 */
export function acpToolOutputText(content: AcpToolContent | undefined, rawOutput: unknown): string {
  const parts: string[] = []
  for (const item of content ?? []) {
    if (item.type !== 'content') continue
    const block = (item as { content?: unknown }).content
    if (isPlainObject(block) && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  if (parts.length > 0) return parts.join('\n')
  if (rawOutput === undefined || rawOutput === null) return ''
  if (typeof rawOutput === 'string') return rawOutput
  try {
    return JSON.stringify(rawOutput) ?? ''
  } catch {
    return String(rawOutput)
  }
}

/**
 * The arguments of an EYAS tool grok reached through its use_tool meta-tool.
 * Such a call's rawInput is the wrapper `{variant, tool_name: 'eyas__<tool>',
 * tool_input}` (grok 1.0.40, A1 fixture fs-call-trace.json), and `tool_input`
 * is exactly what the bridge's tools/call receives. The row shows, and the
 * run records, those arguments — so the do-not-repeat ledger a resumed run
 * builds from the record matches the call the bridge sees again. Undefined
 * for any other input.
 */
function useToolArguments(rawInput: Record<string, unknown>): Record<string, unknown> | undefined {
  if (eyasToolName(rawInput.tool_name) === undefined || !('tool_input' in rawInput)) return undefined
  const args = rawInput.tool_input
  if (isPlainObject(args)) return args
  if (typeof args === 'string') {
    try {
      const parsed: unknown = JSON.parse(args)
      if (isPlainObject(parsed)) return parsed
    } catch {
      // Not JSON: no arguments EYAS can read.
    }
  }
  return {}
}

/** The first diff of a tool call's content as an edit input: {path, old_string, new_string}. */
function diffInput(content: AcpToolContent | undefined): Record<string, unknown> | undefined {
  for (const item of content ?? []) {
    if (item.type !== 'diff') continue
    const { path, oldText, newText } = item as { path?: unknown; oldText?: unknown; newText?: unknown }
    if (typeof path !== 'string' || typeof newText !== 'string') continue
    return { path, old_string: typeof oldText === 'string' ? oldText : '', new_string: newText }
  }
  return undefined
}

interface ToolRow {
  id: string
  /** The title of the first tool_call: grok 1.0.40 puts the tool's own name there. */
  firstTitle?: string
  /** The latest title (display text on most CLIs). */
  title?: string
  kind?: string
  rawInput?: unknown
  content?: AcpToolContent
  rawOutput?: unknown
  startedAt: number
  settled: boolean
  /** What the last tool_use_start said, to re-emit only on a change. */
  emitted?: string
}

interface ResolvedTool {
  name: string
  rawName?: string
  input: Record<string, unknown>
  executedBy: ToolExecutor
}

/** Name, input and executor of a row as far as the CLI has described it. */
function resolveTool(row: ToolRow): ResolvedTool {
  const titles = [row.title, row.firstTitle].filter((t): t is string => typeof t === 'string' && t.trim() !== '')
  const rawToolName = isPlainObject(row.rawInput) ? row.rawInput.tool_name : undefined
  const eyas = [...titles, rawToolName].map(eyasToolName).find((n) => n !== undefined)
  const kind = row.kind ?? 'other'
  // The ACP kind decides; otherwise the first machine identifier among the
  // titles (grok's first title is the tool's own name). A human title is
  // never taken for a name: without either, the kind itself is the name.
  const name = eyas
    ?? titles.map((t) => canonicalToolName(t, { acpKind: kind })).find((n) => n !== kind)
    ?? canonicalToolName(titles[0] ?? '', { acpKind: kind })
  const rawName = titles[0] && titles[0] !== name ? titles[0] : undefined
  const base = isPlainObject(row.rawInput) ? normalizeToolInput(useToolArguments(row.rawInput) ?? row.rawInput) : {}
  const diff = diffInput(row.content)
  return {
    name,
    ...(rawName ? { rawName } : {}),
    input: diff ? { ...base, ...diff } : base,
    executedBy: eyas ? 'eyas' : 'provider',
  }
}

export interface AcpToolStream {
  /** A validated tool_call / tool_call_update: the events it produces (row upserts, a settle). */
  update(event: ToolCallEvent): StreamEvent[]
  /** EYAS refused a call: remembered for its row; an approval raises approval_required. */
  refuse(refusal: AcpToolRefusal): StreamEvent[]
  /** The executor refused an EYAS tool the CLI called through the MCP bridge. */
  bridgeOutcome(outcome: BridgeToolOutcome): StreamEvent[]
  /** The turn ended: settle the rows EYAS refused that the CLI never settled (they never ran). */
  finish(): StreamEvent[]
}

export function createAcpToolStream(opts: { now?: () => number; maxOutputBytes?: number } = {}): AcpToolStream {
  const now = opts.now ?? Date.now
  const rows = new Map<string, ToolRow>()
  /** Refusals by call id — a permission request may come before its tool_call. */
  const refusals = new Map<string, AcpToolRefusal>()
  /** Bridge refusals whose row was not identified yet, oldest first. */
  const pendingBridge: BridgeToolOutcome[] = []

  const start = (row: ToolRow): StreamEvent[] => {
    const tool = resolveTool(row)
    const event: StreamEvent = {
      type: 'tool_use_start',
      id: row.id,
      name: tool.name,
      ...(tool.rawName ? { rawName: tool.rawName } : {}),
      input: tool.input,
    }
    const key = JSON.stringify(event)
    if (key === row.emitted) return []
    row.emitted = key
    return [event]
  }

  /** The refusal that decides a row's outcome: its own, else a matching bridge refusal. */
  const refusalOf = (row: ToolRow, tool: ResolvedTool): AcpToolRefusal | undefined => {
    const own = refusals.get(row.id)
    if (own) return own
    if (tool.executedBy !== 'eyas') return undefined
    const i = pendingBridge.findIndex((o) => o.toolName === tool.name)
    if (i < 0) return undefined
    const [o] = pendingBridge.splice(i, 1)
    const refusal: AcpToolRefusal = { toolCallId: row.id, outcome: o.outcome, reason: o.reason, ...(o.approvalId !== undefined ? { approvalId: o.approvalId } : {}) }
    refusals.set(row.id, refusal)
    return refusal
  }

  const settle = (row: ToolRow, status: AcpToolStatus | 'ended'): StreamEvent[] => {
    row.settled = true
    const tool = resolveTool(row)
    const refusal = refusalOf(row, tool)
    const output = acpToolOutputText(row.content, row.rawOutput)
    const outcome: ToolOutcome = refusal ? refusal.outcome : status === 'failed' ? 'error' : 'success'
    return [{
      type: 'tool_result',
      toolUseId: row.id,
      content: capToolOutput(output || (refusal ? refusal.reason : ''), opts.maxOutputBytes),
      isError: outcome !== 'success',
      durationMs: Math.max(0, now() - row.startedAt),
      outcome,
      executedBy: tool.executedBy,
    }]
  }

  const approval = (refusal: AcpToolRefusal, row: ToolRow | undefined, toolName: string): ApprovalEvent => ({
    type: 'approval_required',
    ...(row ? { toolUseId: row.id } : refusal.toolCallId ? { toolUseId: refusal.toolCallId } : {}),
    toolName,
    reason: refusal.reason,
    ...(refusal.approvalId !== undefined ? { approvalId: refusal.approvalId } : {}),
  })

  return {
    update(event) {
      let row = rows.get(event.toolCallId)
      const events: StreamEvent[] = []
      if (!row) {
        row = { id: event.toolCallId, startedAt: now(), settled: false }
        rows.set(row.id, row)
      }
      if (row.settled) return events
      if (event.kind === 'tool_call' && event.title && row.firstTitle === undefined) row.firstTitle = event.title
      if (event.title) row.title = event.title
      if (event.toolKind) row.kind = event.toolKind
      if (event.rawInput !== undefined) row.rawInput = event.rawInput
      if (event.content) row.content = event.content
      if (event.kind === 'tool_call_update' && event.rawOutput !== undefined) row.rawOutput = event.rawOutput
      events.push(...start(row))
      if (event.status === 'completed' || event.status === 'failed') events.push(...settle(row, event.status))
      return events
    },

    refuse(refusal) {
      const row = refusal.toolCallId ? rows.get(refusal.toolCallId) : undefined
      // The first refusal of a call stands: a later cancel of an already
      // refused call does not change why it did not run.
      if (refusal.toolCallId && !refusals.has(refusal.toolCallId)) refusals.set(refusal.toolCallId, refusal)
      if (refusal.outcome !== 'approval_required') return []
      const toolName = row ? resolveTool(row).name : canonicalToolName(refusal.toolName ?? 'tool')
      return [approval(refusal, row, toolName)]
    },

    bridgeOutcome(outcome) {
      // The newest open row of this EYAS tool that has no refusal yet.
      const row = [...rows.values()].reverse().find((r) => {
        if (r.settled || refusals.has(r.id)) return false
        const tool = resolveTool(r)
        return tool.executedBy === 'eyas' && tool.name === outcome.toolName
      })
      const refusal: AcpToolRefusal = {
        ...(row ? { toolCallId: row.id } : {}),
        outcome: outcome.outcome,
        reason: outcome.reason,
        ...(outcome.approvalId !== undefined ? { approvalId: outcome.approvalId } : {}),
      }
      if (row) refusals.set(row.id, refusal)
      else pendingBridge.push(outcome)
      return outcome.outcome === 'approval_required' ? [approval(refusal, row, outcome.toolName)] : []
    },

    finish() {
      const events: StreamEvent[] = []
      for (const row of rows.values()) {
        if (!row.settled && refusals.has(row.id)) events.push(...settle(row, 'ended'))
      }
      return events
    },
  }
}

// ─── Relay for bridge outcomes ─────────────────

/**
 * Carries the MCP bridge's refusals of EYAS tools (bridge-routes
 * onToolOutcome, called from the HTTP handler) into the running ACP turn.
 * Outcomes emitted before the turn subscribes are kept and delivered on
 * subscribe; after the turn unsubscribes they are dropped.
 */
export interface AcpBridgeOutcomes {
  emit(outcome: BridgeToolOutcome): void
  subscribe(listener: (outcome: BridgeToolOutcome) => void): () => void
}

export function createAcpBridgeOutcomes(): AcpBridgeOutcomes {
  let listener: ((outcome: BridgeToolOutcome) => void) | null = null
  const buffered: BridgeToolOutcome[] = []
  return {
    emit(outcome) {
      if (listener) listener(outcome)
      else buffered.push(outcome)
    },
    subscribe(fn) {
      listener = fn
      for (const outcome of buffered.splice(0)) fn(outcome)
      return () => {
        if (listener === fn) listener = null
      }
    },
  }
}

// ─── Usage ─────────────────────────────────────

/** A token count as a CLI reports it; anything that is not a count is ignored. */
const Count = z.number().finite().nonnegative().transform((n) => Math.round(n)).optional().catch(undefined)

const AcpUsageSchema = z.object({
  inputTokens: Count, input_tokens: Count,
  outputTokens: Count, output_tokens: Count,
  totalTokens: Count, total_tokens: Count,
  cachedReadTokens: Count, cached_read_tokens: Count, cacheReadTokens: Count,
  cachedWriteTokens: Count, cached_write_tokens: Count, cacheCreationTokens: Count,
  thoughtTokens: Count, thought_tokens: Count, reasoningTokens: Count,
}).passthrough()

/** Canonical counts of one ACP turn (ModelUsage minus cost and the reported flag). */
export interface AcpUsageCounts {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  reasoningTokens?: number
}

/**
 * Map a CLI's usage report onto canonical counts: inputTokens UNCACHED,
 * outputTokens including reasoning. The ACP usage object counts cache reads
 * and writes separately and its total is the sum of every count; a CLI whose
 * input or output figure already contains the cached or reasoning tokens
 * shows it in its own total, which is then used to take them out or add them
 * in. Without a total, or when no reading adds up, the figures are taken as
 * the ACP definition states them. Null when the report names neither an
 * input nor an output count (nothing was reported).
 */
export function normalizeAcpUsage(raw: unknown): AcpUsageCounts | null {
  const parsed = AcpUsageSchema.safeParse(raw)
  if (!parsed.success) return null
  const u = parsed.data
  const input = u.inputTokens ?? u.input_tokens
  const output = u.outputTokens ?? u.output_tokens
  if (input === undefined && output === undefined) return null
  const total = u.totalTokens ?? u.total_tokens
  const cacheRead = u.cachedReadTokens ?? u.cached_read_tokens ?? u.cacheReadTokens
  const cacheWrite = u.cachedWriteTokens ?? u.cached_write_tokens ?? u.cacheCreationTokens
  const reasoning = u.thoughtTokens ?? u.thought_tokens ?? u.reasoningTokens

  const I = input ?? 0
  const O = output ?? 0
  const C = cacheRead ?? 0
  const W = cacheWrite ?? 0
  const R = reasoning ?? 0
  let inputTokens = I
  let outputTokens = O
  if (total !== undefined && (C > 0 || W > 0 || R > 0)) {
    const readings = [
      { cacheInInput: false, reasoningInOutput: true, sum: I + O + C + W },
      { cacheInInput: false, reasoningInOutput: false, sum: I + O + C + W + R },
      { cacheInInput: true, reasoningInOutput: true, sum: I + O },
      { cacheInInput: true, reasoningInOutput: false, sum: I + O + R },
    ]
    const match = readings.find((r) => r.sum === total)
    if (match?.cacheInInput) inputTokens = Math.max(0, I - C - W)
    if (match && !match.reasoningInOutput) outputTokens = O + R
  }
  return {
    inputTokens,
    outputTokens,
    ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheWrite ? { cacheCreationTokens: cacheWrite } : {}),
    ...(reasoning ? { reasoningTokens: reasoning } : {}),
  }
}

/** The canonical usage of a finished ACP run (acp-client.ts GrokAcpRunResult). */
export function acpRunUsage(result: {
  inputTokens: number
  outputTokens: number
  usageReported?: boolean
  cacheReadTokens?: number
  cacheCreationTokens?: number
  reasoningTokens?: number
}): ModelUsage {
  return {
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    ...(result.cacheReadTokens ? { cacheReadTokens: result.cacheReadTokens } : {}),
    ...(result.cacheCreationTokens ? { cacheCreationTokens: result.cacheCreationTokens } : {}),
    ...(result.reasoningTokens ? { reasoningTokens: result.reasoningTokens } : {}),
    ...(result.usageReported === false ? { reported: false } : {}),
  }
}
