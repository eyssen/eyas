// Part of eYssen. See LICENSE file for full copyright and licensing details.
// The ONLY write site for context composition data — and therefore the only
// write site for skill usage counters. One source of truth means the counter
// cannot drift from the composition record it is derived from.
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { generateId } from '@shared/crypto'
import type { ContextSection } from '@modules/prompt-wizard/types.js'

export type ContextEntryPoint =
  | 'conversation'
  | 'background'
  | 'orchestrator-member'
  | 'delegated'      // executeAgent — every delegate_to_agent subagent
  | 'channel'        // channel-run-agent — inbound email / Telegram / Slack replies
  | 'unassembled'

export interface RecordInput {
  sections: ContextSection[]
  entryPoint: ContextEntryPoint
  conversationId?: string | null
  runId?: string | null
  agentId?: string | null
  provider?: string | null
  model?: string | null
  /** The window the prompt was sized for (the resolved delivery profile's); absent → 0, "not resolved". */
  contextWindow?: number
  budgetTotalTokens?: number
  /**
   * chars/4 estimate of the conversation history sent with this composition
   * (the messages; the system prompt and turn block are the sections). The
   * occupancy numerator adds it to the sections until a model call reports
   * the real prompt size (observe()).
   */
  historyEstimatedTokens?: number
  prefixHash?: string | null
  assemblerError?: string | null
  /**
   * Who the prompt was sized for and what recall delivered (the assembler's
   * PromptDelivery, read structurally; assemble-system.ts
   * deliveryRecordFields passes it on every entry path). Stored as
   * delivery_json. Its recall turn id becomes the composition id, so the
   * access log's inject rows (stamped by recall) and drill-down rows (stamped
   * by the runner with the composition id) name the same turn.
   */
  delivery?: CompositionDeliveryInput | null
}

// ─── Memory delivery (I12) ────────────────────────────────────────────

/** How the EYAS system prompt reached an ACP CLI's model (model/types.ts SystemPromptDelivery). */
export const SYSTEM_PROMPT_CHANNELS = ['meta-verified', 'meta-unverified', 'prompt'] as const
export type SystemPromptChannel = (typeof SYSTEM_PROMPT_CHANNELS)[number]

/** Why a turn block carried no recall (prompt-wizard/types.ts RecallWithheld). */
export const RECALL_WITHHELD_REASONS = ['external', 'no-budget', 'unavailable', 'failed'] as const

/**
 * The assembler's delivery record as the recorder reads it — structurally the
 * prompt-wizard's PromptDelivery (DeliveryProfile + RecallDelivery), so this
 * module does not depend on the assembler.
 */
export interface CompositionDeliveryInput {
  profile: {
    providerId: string | null
    modelId: string | null
    contextWindow: number
    resolved: boolean
    windowSource: string
    supportsTools: boolean
    drillDown: boolean
    toolAddressing: { kind: string }
  }
  budgetTotalTokens: number
  recall?: {
    ids: readonly string[]
    retrieved: readonly string[]
    expanded: readonly string[]
    chars: number
    budgetChars: number
    turnId: string
    withheld?: string
  }
}

const Count = z.number().int().nonnegative()

/**
 * context_compositions.delivery_json. `turnId` is the composition id (the
 * turn the memory access log's rows carry). `profile` and `recall` are null
 * when no assembler ran (a record that only carries the prompt channel);
 * `systemPromptChannel` is set after the call, by observe(), for an ACP CLI.
 */
export const CompositionDeliverySchema = z.object({
  turnId: z.string().min(1),
  profile: z.object({
    providerId: z.string().nullable(),
    modelId: z.string().nullable(),
    contextWindow: Count,
    resolved: z.boolean(),
    windowSource: z.string(),
    supportsTools: z.boolean(),
    drillDown: z.boolean(),
    toolAddressing: z.string(),
  }).nullable(),
  budgetTotalTokens: Count.nullable(),
  recall: z.object({
    ids: z.array(z.string()),
    retrieved: z.array(z.string()),
    expanded: z.array(z.string()),
    chars: Count,
    budgetChars: Count,
    /** The turn id recall stamped on its inject rows, when it differs from turnId. */
    injectTurnId: z.string().optional(),
    withheld: z.enum(RECALL_WITHHELD_REASONS).optional(),
  }).nullable(),
  systemPromptChannel: z.enum(SYSTEM_PROMPT_CHANNELS).optional(),
})

export type CompositionDelivery = z.infer<typeof CompositionDeliverySchema>

/** A stored delivery_json, or null when it is absent or not the expected shape. */
export function parseCompositionDelivery(raw: unknown): CompositionDelivery | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed = CompositionDeliverySchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const finiteCount = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0)

/**
 * The stored record for one composition, or null when the input is not a
 * usable delivery (it is diagnostics: a malformed one is left out, never a
 * failed record).
 */
function toCompositionDelivery(input: CompositionDeliveryInput | null | undefined, compositionId: string): CompositionDelivery | null {
  if (!input || typeof input !== 'object' || !input.profile) return null
  const p = input.profile
  const r = input.recall
  const withheld = RECALL_WITHHELD_REASONS.find((w) => w === r?.withheld)
  const candidate = {
    turnId: compositionId,
    profile: {
      providerId: p.providerId ?? null,
      modelId: p.modelId ?? null,
      contextWindow: finiteCount(p.contextWindow),
      resolved: p.resolved === true,
      windowSource: String(p.windowSource ?? ''),
      supportsTools: p.supportsTools === true,
      drillDown: p.drillDown === true,
      toolAddressing: String(p.toolAddressing?.kind ?? ''),
    },
    budgetTotalTokens: finiteCount(input.budgetTotalTokens),
    recall: r
      ? {
          ids: [...(r.ids ?? [])],
          retrieved: [...(r.retrieved ?? [])],
          expanded: [...(r.expanded ?? [])],
          chars: finiteCount(r.chars),
          budgetChars: finiteCount(r.budgetChars),
          ...(r.turnId && r.turnId !== compositionId ? { injectTurnId: r.turnId } : {}),
          ...(withheld ? { withheld } : {}),
        }
      : null,
  }
  const parsed = CompositionDeliverySchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

/**
 * What the provider measured on a composition's LAST main-thread model call:
 * the prompt size it reported (ModelUsage.promptTokensLastCall — never a
 * usage summed over calls), the window the runtime reported for the model
 * that answered (ModelResponse.contextWindow), and — for an ACP CLI — how
 * the system prompt reached the model (ModelResponse.systemPromptChannel).
 */
export interface CompositionObservation {
  promptTokens?: number
  contextWindow?: number
  systemPromptChannel?: SystemPromptChannel
}

const ObservedCount = z.number().int().positive().max(100_000_000)
const ObservedChannel = z.enum(SYSTEM_PROMPT_CHANNELS)

/** A usable observation, or null when it carries nothing valid. */
export function parseCompositionObservation(raw: unknown): CompositionObservation | null {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const promptTokens = ObservedCount.safeParse(o.promptTokens)
  const contextWindow = ObservedCount.safeParse(o.contextWindow)
  const channel = ObservedChannel.safeParse(o.systemPromptChannel)
  if (!promptTokens.success && !contextWindow.success && !channel.success) return null
  return {
    ...(promptTokens.success ? { promptTokens: promptTokens.data } : {}),
    ...(contextWindow.success ? { contextWindow: contextWindow.data } : {}),
    ...(channel.success ? { systemPromptChannel: channel.data } : {}),
  }
}

/** One recorded section, in the order it was concatenated into the prompt. */
export interface RecordedSection {
  ord: number
  key: string
  content: string
}

export interface ContextRecorder {
  record(input: RecordInput): string | null
  /**
   * The sections of a RECENT composition (in-memory, the last
   * RECENT_COMPOSITIONS recorded), or null when the id is unknown or was
   * evicted. The privacy egress filter reads this to locate each section in
   * the system prompt it masks; a miss makes it scan the whole prompt.
   * 'turn' sections are left out: they travel in the user message, which the
   * filter scans as a message, and are never in the system prompt.
   */
  sectionsFor(compositionId: string | null | undefined): readonly RecordedSection[] | null
  /**
   * Records what the provider measured on the composition's last model call
   * (context occupancy; an ACP CLI's system-prompt channel goes into the
   * delivery record). Fire-and-forget and fail-open: an unknown id, an empty
   * observation or a failed write is a no-op, never a failed turn. A later
   * call overwrites a field it carries and keeps the ones it does not.
   * Optional so a recorder stand-in without it still records.
   */
  observe?(compositionId: string | null | undefined, observation: CompositionObservation | null | undefined): void
}

/** A run event as far as an observation is concerned (AgentEvent / StreamEvent, read structurally). */
interface ObservableEvent {
  type: string
  usage?: { promptTokensLastCall?: unknown } | null
  response?: { usage?: { promptTokensLastCall?: unknown } | null; contextWindow?: unknown; systemPromptChannel?: unknown } | null
}

/**
 * Passes a run's events through unchanged and, however the run ends (done,
 * thrown, or the consumer stopped early), records on the composition what
 * the provider measured on the run's last model call: each turn_complete's
 * prompt size (the last one wins), the done response's runtime window and,
 * for an ACP CLI, how the system prompt reached the model. One wrapper for
 * every entry path that records a composition and runs the agent runner, so
 * none of them computes a numerator of its own.
 */
export async function* observeRunEvents<E extends { type: string }>(
  events: AsyncIterable<E>,
  recorder: Pick<ContextRecorder, 'observe'> | null | undefined,
  compositionId: string | null | undefined,
): AsyncGenerator<E> {
  let promptTokens: unknown
  let contextWindow: unknown
  let systemPromptChannel: unknown
  try {
    for await (const event of events) {
      const e = event as unknown as ObservableEvent
      if (e.type === 'turn_complete' && e.usage?.promptTokensLastCall !== undefined) {
        promptTokens = e.usage.promptTokensLastCall
      } else if (e.type === 'done') {
        if (e.response?.usage?.promptTokensLastCall !== undefined) promptTokens = e.response.usage.promptTokensLastCall
        if (e.response?.contextWindow !== undefined) contextWindow = e.response.contextWindow
        if (e.response?.systemPromptChannel !== undefined) systemPromptChannel = e.response.systemPromptChannel
      }
      yield event
    }
  } finally {
    if (compositionId && recorder?.observe) {
      try {
        recorder.observe(compositionId, { promptTokens, contextWindow, systemPromptChannel } as CompositionObservation)
      } catch { /* an observation is diagnostics, never the run's ending */ }
    }
  }
}

/** How many recent compositions sectionsFor() can answer for. */
export const RECENT_COMPOSITIONS = 128

// ─── Privacy egress (post-privacy attribution) ────────────────────────

/** A masked span within a section's RECORDED content: [start, end, type]. */
export type EgressSpan = readonly [start: number, end: number, type: string]

interface EgressCounts {
  masked: number
  warned: number
}

/**
 * What one model call's privacy egress did to a composition — the privacy
 * egress filter's digest (privacy/egress-filter.ts EgressDigest), read
 * structurally so this module does not depend on privacy. It never carries a
 * detected value.
 */
export interface CompositionEgressInput {
  locality: 'local' | 'remote'
  transport: string
  providerId: string
  rulesetVersion: string
  /** The recorded system-prompt sections, by ord (empty for a local destination). */
  sections: ReadonlyArray<{ ord: number; located: boolean; skipped: boolean; spans: ReadonlyArray<EgressSpan> }>
  unattributed: EgressCounts
  messages: EgressCounts
  /** Memory-bearing tool results in the history that had a detection. */
  toolResults: ReadonlyArray<EgressCounts & { toolName: string }>
  byType: Readonly<Record<string, number>>
}

/**
 * A memory-bearing tool result masked on a transport that goes around the
 * model gateway (a CLI tool bridge): privacy/service.ts ToolOutputDigest,
 * read structurally.
 */
export interface ToolEgressInput extends EgressCounts {
  transport: string
  toolName: string
  rulesetVersion: string
}

const CountsSchema = z.object({ masked: z.number().int().nonnegative(), warned: z.number().int().nonnegative() })

/**
 * context_compositions.egress_json. The call fields (locality, provider,
 * ruleset, counts, byType) describe the LAST gateway call of the composition:
 * an agent loop calls the model once per iteration and each call overwrites
 * them. `calls` counts those calls. `toolResults` holds the gateway's
 * memory tool results of the last call ('gateway') plus the ones masked on a
 * CLI bridge during the turn, accumulated per tool and transport.
 */
export const CompositionEgressSchema = z.object({
  locality: z.enum(['local', 'remote']),
  transport: z.string(),
  providerId: z.string().nullable(),
  rulesetVersion: z.string(),
  calls: z.number().int().nonnegative(),
  at: z.string(),
  unattributed: CountsSchema,
  messages: CountsSchema,
  toolResults: z.array(CountsSchema.extend({
    toolName: z.string(),
    transport: z.string(),
    calls: z.number().int().nonnegative(),
  })),
  byType: z.record(z.string(), z.number()),
})

export type CompositionEgress = z.infer<typeof CompositionEgressSchema>

/** [[start, end, type]] as stored in context_sections.egress_spans. */
export const EgressSpansSchema = z.array(z.tuple([z.number().int(), z.number().int(), z.string()]))

/** A stored egress_json, or null when it is absent or not the expected shape. */
export function parseCompositionEgress(raw: unknown): CompositionEgress | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed = CompositionEgressSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** A stored egress_spans value, or null when it is absent or malformed. */
export function parseEgressSpans(raw: unknown): Array<[number, number, string]> | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed = EgressSpansSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Where the privacy module reports what it did to a recorded composition, so
 * the context inspector shows what the model actually received. Both calls
 * are fire-and-forget and fail open: a failed write never fails a model call.
 * An unknown composition id is a no-op.
 */
export interface CompositionEgressSink {
  /** One gateway call's digest: the per-section masks and the composition digest (the last call wins). */
  attachEgress(compositionId: string | null | undefined, digest: CompositionEgressInput): void
  /** A memory tool result masked on a CLI bridge during the turn (accumulated). */
  attachToolEgress(compositionId: string | null | undefined, digest: ToolEgressInput): void
}

export function createContextRecorder(db: any, logger: any): ContextRecorder & CompositionEgressSink {
  // Map order is recency order: the first key is the least recently used,
  // evicted beyond the cap.
  const recent = new Map<string, readonly RecordedSection[]>()
  // The per-section egress last written per composition. A tool loop masks
  // the same system prompt identically on every iteration, so an unchanged
  // digest skips the section UPDATEs.
  const lastSectionEgress = new Map<string, string>()

  function remember(id: string, sections: ContextSection[]): void {
    recent.set(id, sections
      .map((s, ord) => ({ ord, key: s.key, content: s.content, zone: s.zone }))
      .filter((s) => s.zone !== 'turn')
      .map(({ ord, key, content }) => ({ ord, key, content })))
    while (recent.size > RECENT_COMPOSITIONS) {
      const oldest = recent.keys().next().value
      if (oldest === undefined) break
      recent.delete(oldest)
    }
  }

  /**
   * The composition's id: the turn id recall stamped on its access-log rows
   * when that id is new here, so the inject rows and the runner's drill-down
   * rows (stamped with the composition id) name one turn. Otherwise fresh.
   */
  function compositionIdFor(input: RecordInput): string {
    const turnId = input.delivery?.recall?.turnId
    if (typeof turnId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(turnId)) {
      const taken = (db.all(sql`SELECT 1 AS x FROM context_compositions WHERE id = ${turnId}`) as any[]).length > 0
      if (!taken) return turnId
    }
    return generateId()
  }

  function record(input: RecordInput): string | null {
    try {
      const id = compositionIdFor(input)
      const now = new Date().toISOString()
      const day = now.slice(0, 10)
      const estimated = input.sections.reduce((sum, s) => sum + s.estimatedTokens, 0)

      const history = input.historyEstimatedTokens
      const historyTokens = typeof history === 'number' && Number.isFinite(history) && history >= 0 ? Math.round(history) : null
      const delivery = toCompositionDelivery(input.delivery, id)

      db.run(sql`INSERT INTO context_compositions
        (id, created_at, conversation_id, run_id, agent_id, entry_point, provider, model,
         context_window, budget_total_tokens, estimated_tokens, prefix_hash, section_count, assembler_error,
         history_estimated_tokens, delivery_json)
        VALUES (${id}, ${now}, ${input.conversationId ?? null}, ${input.runId ?? null},
                ${input.agentId ?? null}, ${input.entryPoint}, ${input.provider ?? null}, ${input.model ?? null},
                ${input.contextWindow ?? 0}, ${input.budgetTotalTokens ?? 0}, ${estimated},
                ${input.prefixHash ?? null}, ${input.sections.length}, ${input.assemblerError ?? null},
                ${historyTokens}, ${delivery ? JSON.stringify(delivery) : null})`)

      input.sections.forEach((s, ord) => {
        const hash = createHash('sha256').update(s.content).digest('hex')
        db.run(sql`INSERT INTO context_sections
          (composition_id, ord, zone, section_key, source_ref, chars, estimated_tokens,
           budget_tokens, truncated, dropped_chars, content, content_hash)
          VALUES (${id}, ${ord}, ${s.zone}, ${s.key}, ${s.sourceRef ?? null}, ${s.chars},
                  ${s.estimatedTokens}, ${s.budgetTokens ?? null}, ${s.truncated ? 1 : 0},
                  ${s.droppedChars}, ${s.content}, ${hash})`)

        db.run(sql`INSERT INTO context_section_daily
          (day, section_key, count, sum_tokens, max_tokens, truncated_count, sum_dropped_chars)
          VALUES (${day}, ${s.key}, 1, ${s.estimatedTokens}, ${s.estimatedTokens},
                  ${s.truncated ? 1 : 0}, ${s.droppedChars})
          ON CONFLICT(day, section_key) DO UPDATE SET
            count = count + 1,
            sum_tokens = sum_tokens + ${s.estimatedTokens},
            max_tokens = MAX(max_tokens, ${s.estimatedTokens}),
            truncated_count = truncated_count + ${s.truncated ? 1 : 0},
            sum_dropped_chars = sum_dropped_chars + ${s.droppedChars}`)

        // Skill USAGE is injection only. The <available-skills> listing is not
        // usage: the model cannot act on it (no skill_load tool exists), so
        // counting it would keep every skill permanently "alive".
        if (s.key === 'skill' && s.sourceRef) {
          // Own try/catch on purpose: `skills.use_count` and `skill_usage_daily`
          // are created by a LATER task, so on a database that has not migrated
          // yet these statements throw. Without this guard the outer catch would
          // swallow the failure and lose the ENTIRE composition record — the
          // module would silently record nothing at all.
          try {
            const updated = db.run(sql`UPDATE skills SET use_count = COALESCE(use_count, 0) + 1, last_used_at = ${now} WHERE id = ${s.sourceRef}`) as any
            if ((updated?.changes ?? 0) === 0) {
              // The UPDATE matched no row — a sourceRef pointing at a skill id
              // that doesn't exist (deleted skill, stale/wrong id, ...). This is
              // silent by default: use_count for that id simply never increments,
              // with no signal beyond zero forever. A systematically wrong
              // sourceRef deserves to be visible, not just debug-logged.
              logger.warn({ skillId: s.sourceRef }, 'skill usage counter UPDATE matched no row — sourceRef does not exist')
            }
            db.run(sql`INSERT INTO skill_usage_daily (day, skill_id, injected_count)
              VALUES (${day}, ${s.sourceRef}, 1)
              ON CONFLICT(day, skill_id) DO UPDATE SET injected_count = injected_count + 1`)
          } catch (err) {
            logger.debug({ err, skillId: s.sourceRef }, 'skill usage counters unavailable — composition still recorded')
          }
        }
      })

      remember(id, input.sections)
      return id
    } catch (err) {
      logger.debug({ err }, 'context recording failed — continuing without a composition record')
      return null
    }
  }

  /** The composition's current egress_json, or undefined when the composition does not exist. */
  function storedEgress(compositionId: string): { egress: CompositionEgress | null } | undefined {
    const row = (db.all(sql`SELECT egress_json FROM context_compositions WHERE id = ${compositionId}`) as any[])[0]
    if (!row) return undefined
    return { egress: parseCompositionEgress(row.egress_json) }
  }

  function writeSectionEgress(compositionId: string, digest: CompositionEgressInput): void {
    const rows = digest.locality === 'local'
      ? []
      : digest.sections.map((s) => ({
          ord: s.ord,
          // Not located: its text was scanned with the unattributed rest, so
          // there are no spans relative to the section — left NULL.
          masked: s.skipped || !s.located ? null : s.spans.length,
          spans: !s.skipped && s.located && s.spans.length > 0 ? JSON.stringify(s.spans) : null,
          skipped: s.skipped ? 1 : s.located ? 0 : null,
        }))
    const signature = JSON.stringify(rows)
    if (lastSectionEgress.get(compositionId) === signature) return

    // The last call wins: clear what an earlier call wrote (a remote attempt
    // followed by a local fallback leaves no stale masks behind).
    db.run(sql`UPDATE context_sections SET egress_masked = NULL, egress_spans = NULL, egress_skipped = NULL
      WHERE composition_id = ${compositionId}`)
    for (const r of rows) {
      db.run(sql`UPDATE context_sections SET egress_masked = ${r.masked}, egress_spans = ${r.spans}, egress_skipped = ${r.skipped}
        WHERE composition_id = ${compositionId} AND ord = ${r.ord}`)
    }
    lastSectionEgress.delete(compositionId)
    lastSectionEgress.set(compositionId, signature)
    while (lastSectionEgress.size > RECENT_COMPOSITIONS) {
      const oldest = lastSectionEgress.keys().next().value
      if (oldest === undefined) break
      lastSectionEgress.delete(oldest)
    }
  }

  function attachEgress(compositionId: string | null | undefined, digest: CompositionEgressInput): void {
    if (!compositionId) return
    try {
      const stored = storedEgress(compositionId)
      if (!stored) return
      const prev = stored.egress
      const next: CompositionEgress = {
        locality: digest.locality,
        transport: digest.transport,
        providerId: digest.providerId,
        rulesetVersion: digest.rulesetVersion,
        calls: (prev?.calls ?? 0) + 1,
        at: new Date().toISOString(),
        unattributed: { masked: digest.unattributed.masked, warned: digest.unattributed.warned },
        messages: { masked: digest.messages.masked, warned: digest.messages.warned },
        toolResults: [
          // This call's view of the history replaces the previous call's…
          ...digest.toolResults.map((t) => ({ toolName: t.toolName, transport: digest.transport, masked: t.masked, warned: t.warned, calls: 1 })),
          // …while results masked on a CLI bridge during the turn are kept.
          ...(prev?.toolResults ?? []).filter((t) => t.transport !== digest.transport),
        ],
        byType: { ...digest.byType },
      }
      writeSectionEgress(compositionId, digest)
      db.run(sql`UPDATE context_compositions SET egress_json = ${JSON.stringify(next)} WHERE id = ${compositionId}`)
    } catch (err) {
      logger.debug({ err, compositionId }, 'privacy egress not recorded — the composition keeps its assembled view')
    }
  }

  function attachToolEgress(compositionId: string | null | undefined, digest: ToolEgressInput): void {
    if (!compositionId) return
    try {
      const stored = storedEgress(compositionId)
      if (!stored) return
      const prev = stored.egress
      const toolResults = [...(prev?.toolResults ?? [])]
      const idx = toolResults.findIndex((t) => t.toolName === digest.toolName && t.transport === digest.transport)
      if (idx >= 0) {
        const t = toolResults[idx]
        toolResults[idx] = { ...t, masked: t.masked + digest.masked, warned: t.warned + digest.warned, calls: t.calls + 1 }
      } else {
        toolResults.push({ toolName: digest.toolName, transport: digest.transport, masked: digest.masked, warned: digest.warned, calls: 1 })
      }
      const next: CompositionEgress = prev
        ? { ...prev, toolResults, at: new Date().toISOString() }
        : {
            // No gateway call recorded yet: a bridge is always a remote destination.
            locality: 'remote',
            transport: digest.transport,
            providerId: null,
            rulesetVersion: digest.rulesetVersion,
            calls: 0,
            at: new Date().toISOString(),
            unattributed: { masked: 0, warned: 0 },
            messages: { masked: 0, warned: 0 },
            toolResults,
            byType: {},
          }
      db.run(sql`UPDATE context_compositions SET egress_json = ${JSON.stringify(next)} WHERE id = ${compositionId}`)
    } catch (err) {
      logger.debug({ err, compositionId }, 'privacy egress of a bridged tool result not recorded')
    }
  }

  function observe(compositionId: string | null | undefined, observation: CompositionObservation | null | undefined): void {
    if (!compositionId) return
    const parsed = parseCompositionObservation(observation)
    if (!parsed) return
    try {
      if (parsed.promptTokens !== undefined || parsed.contextWindow !== undefined) {
        db.run(sql`UPDATE context_compositions SET
          observed_prompt_tokens = COALESCE(${parsed.promptTokens ?? null}, observed_prompt_tokens),
          observed_context_window = COALESCE(${parsed.contextWindow ?? null}, observed_context_window)
          WHERE id = ${compositionId}`)
      }
    } catch (err) {
      logger.debug({ err, compositionId }, 'context occupancy observation not recorded — the estimate stands')
    }
    if (parsed.systemPromptChannel) attachSystemPromptChannel(compositionId, parsed.systemPromptChannel)
  }

  /**
   * How the system prompt reached an ACP CLI's model on the composition's
   * last call, kept in its delivery record. A composition recorded without
   * one (no assembler ran) gets a record carrying the channel alone.
   */
  function attachSystemPromptChannel(compositionId: string, channel: SystemPromptChannel): void {
    try {
      const row = (db.all(sql`SELECT delivery_json FROM context_compositions WHERE id = ${compositionId}`) as any[])[0]
      if (!row) return
      const prev = parseCompositionDelivery(row.delivery_json)
      if (prev?.systemPromptChannel === channel) return
      const next: CompositionDelivery = prev
        ? { ...prev, systemPromptChannel: channel }
        : { turnId: compositionId, profile: null, budgetTotalTokens: null, recall: null, systemPromptChannel: channel }
      db.run(sql`UPDATE context_compositions SET delivery_json = ${JSON.stringify(next)} WHERE id = ${compositionId}`)
    } catch (err) {
      logger.debug({ err, compositionId }, 'system-prompt channel not recorded')
    }
  }

  return {
    record,
    attachEgress,
    attachToolEgress,
    observe,
    sectionsFor(compositionId) {
      if (!compositionId) return null
      const sections = recent.get(compositionId)
      if (!sections) return null
      // Least recently used goes first: a long tool loop that keeps reading
      // its composition keeps it.
      recent.delete(compositionId)
      recent.set(compositionId, sections)
      return sections
    },
  }
}
