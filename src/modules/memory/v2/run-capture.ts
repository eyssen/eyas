// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// L0 capture of one agent run's tool I/O and model reasoning, for EVERY
// provider. The runner yields one normalized event stream whoever ran a
// tool: its own executor (API providers), a CLI calling an EYAS tool over
// the bridge, or a CLI's built-in tool (Claude Code's Bash, Grok's and
// Kimi's own) — each settles with tool_result{outcome, executedBy}. Reading
// that stream, instead of the EYAS executor's log, is what makes a CLI run
// leave the same memory as an API run. A tool call outside any agent run is
// not captured.
//
// Both halves are opt-in (capturePolicy, read per event):
//  - memory.l0.captureToolResults — one 'tool_result' unit per call that ran
//    (outcome success or error), trust 'ingested', actor `tool:<name>`. A
//    refused, skipped or approval-waiting call executed nothing and leaves
//    nothing; neither does an empty result. Stored verbatim and unredacted.
//    The unit's CONTENT is what the call returned — {tool, output, isError,
//    outcome, executedBy}, byte-capped by the ingest
//    (memory.l0.toolResultMaxBytes); it is FTS-indexed and feeds extraction,
//    but is never recalled as its own text (retrieve.ts
//    NEVER_RECALLED_SOURCE_TYPES): a captured credential or fetched page never
//    comes back word for word in another conversation's prompt. The call's
//    ARGUMENTS are what the model asked for, not what anything returned: they
//    are kept on the row (meta.input, clipped) as provenance only, so a
//    password a tool typed or a path a model guessed is never indexed and
//    never becomes a topic, an entity or a fact.
//  - memory.l0.captureThinking — one 'thinking' unit per model call, trust
//    'derived'. Audit only: 'thinking' rows are never extracted or recalled.
//
// Every unit carries one provenance shape (meta): origin 'agent_run', the
// provider and model that ANSWERED the model call the unit belongs to (its
// turn_complete, D3), the agent, the entry path and the supervised run.
// A unit is held until that call completes; end() stamps the rest with the
// last answering pair, else the pair the run asked for.
//
// Never throws: a capture must never break a run.

import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import { canonicalToolName, normalizeToolInput } from '@shared/canonical-tool-name.js'
import type { AgentEvent } from '@modules/agent/agent-runner.js'
import {
  captureUnit,
  capturePolicy,
  type CaptureEntryPath,
  type CapturePolicy,
  type TrustTier,
} from './ingest-bridge.js'
import { resolveConversationScope, type ConversationScope } from './scope.js'

/** How much of a call's arguments the row keeps as provenance (characters of their JSON, meta.input). */
export const RUN_CAPTURE_INPUT_MAX_CHARS = 2_048

/** What the runner knows about a run when it starts. */
export interface RunCaptureStart {
  conversationId: string
  agentId?: string | null
  /** The supervised run (agent_sessions.id), when there is one. */
  sessionId?: string | null
  entryPath?: CaptureEntryPath | null
  /** The pair the run asked for — stamps only a unit whose own model call never completed. */
  provider?: string | null
  model?: string | null
}

export interface RunCaptureOptions extends RunCaptureStart {
  db: EyasDb
  /** The opt-in switches. Defaults to the bridge's (memory.l0.*). */
  policy?: () => CapturePolicy
  now?: () => number
}

export interface RunCapture {
  /** Every event the run yields, in order. */
  observe(event: AgentEvent): void
  /** However the run ended (done, cancelled, parked, thrown or abandoned). */
  end(): void
}

interface Pair {
  provider: string | null
  model: string | null
}

interface OpenCall {
  name: string
  rawName?: string
  input: Record<string, unknown>
  /** The model call (1-based) that asked for it. */
  turn: number
}

interface PendingUnit {
  /** The model call whose answering pair stamps this unit. */
  turn: number
  sourceType: 'tool_result' | 'thinking'
  /** `tool:<name>`; a thinking unit's actor is the agent, else the answering provider. */
  actor?: string
  content: string
  occurredAtMs: number
  trustTier: TrustTier
  meta: Record<string, unknown>
}

/** Results that carry nothing worth remembering (OpenCode's tool capture skips the same). */
export const EMPTY_OUTPUTS: ReadonlySet<string> = new Set(['', 'null', 'undefined', '{}', '""'])

/**
 * The arguments as the row keeps them: a plain-JSON snapshot taken now, or
 * their clipped JSON text. Meta is serialised only when the ingest flushes,
 * so a live object here could change — or stop serialising — before then.
 * OpenCode's tool capture (opencode/memory-bridge.ts) keeps its calls'
 * arguments the same way.
 */
export function clippedInput(input: Record<string, unknown>): unknown {
  let text: string
  try {
    text = JSON.stringify(input) ?? ''
  } catch {
    return '[unserialisable]'
  }
  if (text.length > RUN_CAPTURE_INPUT_MAX_CHARS) return `${text.slice(0, RUN_CAPTURE_INPUT_MAX_CHARS)}…`
  return text ? (JSON.parse(text) as unknown) : {}
}

/**
 * The capture of one run. Create it at run start and feed it every event;
 * the runner does both (agent-runner.ts withRunCapture).
 */
export function createRunCapture(opts: RunCaptureOptions): RunCapture {
  const policy = opts.policy ?? capturePolicy
  const now = opts.now ?? Date.now
  const requested: Pair = { provider: opts.provider ?? null, model: opts.model ?? null }

  // The model calls completed so far, and the pair that answered each.
  let completed = 0
  const pairs = new Map<number, Pair>()
  let lastPair: Pair | null = null
  const open = new Map<string, OpenCall>()
  const settled = new Set<string>()
  const pending: PendingUnit[] = []
  let thinking: { turn: number; text: string; startedAtMs: number } | null = null
  let ended = false

  const finishThinking = (): void => {
    const t = thinking
    thinking = null
    if (!t || !t.text.trim()) return
    pending.push({
      turn: t.turn,
      sourceType: 'thinking',
      content: t.text,
      occurredAtMs: t.startedAtMs,
      trustTier: 'derived',
      meta: {},
    })
  }

  /** Emit every held unit whose pair is known — or all of them, at the end. */
  const drain = (final: boolean): void => {
    if (pending.length === 0) return
    let scope: ConversationScope | null = null
    const keep: PendingUnit[] = []
    for (const unit of pending) {
      const pair = pairs.get(unit.turn) ?? (final ? (lastPair ?? requested) : undefined)
      if (!pair) {
        keep.push(unit)
        continue
      }
      scope ??= resolveConversationScope(opts.db, opts.conversationId)
      const agentId = opts.agentId ?? scope.agentId ?? null
      captureUnit({
        id: generateId(),
        sourceType: unit.sourceType,
        actor: unit.actor ?? agentId ?? pair.provider ?? 'assistant',
        conversationId: opts.conversationId,
        projectId: scope.projectId,
        projectTypeId: scope.projectTypeId,
        occurredAtMs: unit.occurredAtMs,
        content: unit.content,
        trustTier: unit.trustTier,
        meta: {
          origin: 'agent_run',
          provider: pair.provider,
          model: pair.model,
          agentId,
          entryPath: opts.entryPath ?? null,
          sessionId: opts.sessionId ?? null,
          turn: unit.turn,
          ...unit.meta,
        },
      })
    }
    pending.splice(0, pending.length, ...keep)
  }

  const onToolResult = (event: Extract<AgentEvent, { type: 'tool_result' }>): void => {
    if (settled.has(event.toolUseId)) return
    // Only a call that ran leaves a result; a refused one executed nothing.
    const ran = event.outcome === undefined || event.outcome === 'success' || event.outcome === 'error'
    if (!ran) return
    const opened = open.get(event.toolUseId)
    settled.add(event.toolUseId)
    open.delete(event.toolUseId)
    if (!policy().toolResults) return
    const output = typeof event.content === 'string' ? event.content : ''
    if (EMPTY_OUTPUTS.has(output.trim())) return
    const tool = opened?.name ?? 'unknown'
    const outcome = event.outcome ?? (event.isError ? 'error' : 'success')
    pending.push({
      // An executor result arrives after its call's turn_complete; a CLI's
      // own result inside the call, before it — the call that asked decides.
      turn: opened?.turn ?? completed + 1,
      sourceType: 'tool_result',
      actor: `tool:${tool}`,
      // What the call returned: indexed and extracted.
      content: JSON.stringify({
        tool,
        output,
        isError: event.isError === true,
        outcome,
        executedBy: event.executedBy ?? null,
      }),
      occurredAtMs: now(),
      trustTier: 'ingested',
      meta: {
        toolUseId: event.toolUseId,
        toolName: tool,
        ...(opened?.rawName ? { rawName: opened.rawName } : {}),
        durationMs: Number.isFinite(event.durationMs) ? Math.max(0, Math.round(event.durationMs)) : 0,
        // What the model asked for: provenance only, never indexed or extracted.
        // A result without a known start has no arguments to keep.
        ...(opened ? { input: clippedInput(opened.input) } : {}),
      },
    })
    drain(false)
  }

  const observe = (event: AgentEvent): void => {
    switch (event.type) {
      case 'tool_use_start': {
        // A row re-opens as its input fills in: keep the first turn, the latest input.
        if (settled.has(event.id)) return
        const prev = open.get(event.id)
        const name = canonicalToolName(event.name)
        const rawName = event.rawName ?? (event.name !== name ? event.name : undefined) ?? prev?.rawName
        const input = event.input && Object.keys(event.input).length > 0
          ? normalizeToolInput(event.input)
          : (prev?.input ?? {})
        open.set(event.id, { name, ...(rawName ? { rawName } : {}), input, turn: prev?.turn ?? completed + 1 })
        return
      }
      case 'tool_result':
        onToolResult(event)
        return
      case 'thinking': {
        if (!policy().thinking) return
        const turn = completed + 1
        if (thinking && thinking.turn !== turn) finishThinking()
        if (!thinking) thinking = { turn, text: '', startedAtMs: now() }
        thinking.text += event.text
        return
      }
      case 'turn_complete': {
        finishThinking()
        completed += 1
        const pair: Pair = { provider: event.provider ?? null, model: event.model ?? null }
        pairs.set(completed, pair)
        lastPair = pair
        drain(false)
        return
      }
      default:
        return
    }
  }

  return {
    observe(event) {
      if (ended) return
      try {
        observe(event)
      } catch {
        /* capture is best-effort; the run goes on */
      }
    },
    end() {
      if (ended) return
      ended = true
      try {
        finishThinking()
        drain(true)
      } catch {
        /* capture is best-effort */
      }
    },
  }
}
