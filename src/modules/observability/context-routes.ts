// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Read-only HTTP surface over the context-composition detail tables recorded
// by context-recorder.ts (see context-schema.ts for the table shapes). This
// is what the context inspector UI (Task 23/24) reads from.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { requirePermission } from '@modules/permissions/middleware'
import type { EyasDb } from '@core/types'
import { charsToTokens } from '@modules/prompt-wizard/token-budget.js'
import { MEMORY_DRILL_LIMIT } from '@modules/tools/builtin/memory-tools.js'
import { MEMORY_RECALL_SECTION_KEY } from '@modules/memory/v2/assemble.js'
import {
  parseCompositionDelivery,
  parseCompositionEgress,
  parseEgressSpans,
  type CompositionDelivery,
} from './context-recorder.js'

const DEFAULT_COMPOSITION_LIMIT = 25
const MAX_COMPOSITION_LIMIT = 100
const DEFAULT_DAILY_LIMIT = 500
const MAX_DAILY_LIMIT = 2000

interface CompositionRow {
  id: string
  created_at: string
  conversation_id: string | null
  run_id: string | null
  agent_id: string | null
  entry_point: string
  provider: string | null
  model: string | null
  context_window: number
  budget_total_tokens: number
  estimated_tokens: number
  prefix_hash: string | null
  section_count: number
  assembler_error: string | null
}

function mapComposition(row: CompositionRow) {
  return {
    id: row.id,
    createdAt: row.created_at,
    conversationId: row.conversation_id,
    runId: row.run_id,
    agentId: row.agent_id,
    entryPoint: row.entry_point,
    provider: row.provider,
    model: row.model,
    contextWindow: row.context_window,
    budgetTotalTokens: row.budget_total_tokens,
    estimatedTokens: row.estimated_tokens,
    prefixHash: row.prefix_hash,
    sectionCount: row.section_count,
    assemblerError: row.assembler_error,
  }
}

/**
 * The memory-delivery view of a composition (I12): who the prompt was sized
 * for, what recall put in the turn block (counts, chars and the chars/4
 * token estimate against the recall cap, or why it was withheld) and how the
 * system prompt reached an ACP CLI's model. Null: nothing was recorded.
 */
function mapDelivery(d: CompositionDelivery | null) {
  if (!d) return null
  const r = d.recall
  return {
    turnId: d.turnId,
    profile: d.profile,
    budgetTotalTokens: d.budgetTotalTokens,
    recall: r
      ? {
          ids: r.ids,
          hits: r.ids.length,
          retrieved: r.retrieved.length,
          expanded: r.expanded.length,
          chars: r.chars,
          budgetChars: r.budgetChars,
          tokens: charsToTokens(r.chars),
          budgetTokens: charsToTokens(r.budgetChars),
          withheld: r.withheld ?? null,
        }
      : null,
    systemPromptChannel: d.systemPromptChannel ?? null,
  }
}

/** A composition's memory drill-downs: the calls its turn made, the items they read, and the per-turn cap. */
export interface DrillDownSummary {
  /**
   * Drill-down calls of the turn that read memory, by their ordinal in the
   * turn (memory-tools.ts logDrill): a call after the last one that read
   * something is not seen. Null when the rows carry no ordinal (older rows).
   */
  calls: number | null
  /** memory_access_log drilldown_read rows of the turn (one per item read). */
  reads: number
  limit: number
}

/**
 * The drill-down rows of one composition's turn: memory_access_log
 * drilldown_read rows whose rank_detail turnId is the composition id (the
 * runner's turn id). Narrowed first by the conversation and the time the
 * composition was recorded, both indexed, so the JSON filter scans only
 * that turn's neighbourhood. Null when the access log cannot be read.
 */
function drillDownFor(db: EyasDb, composition: { id: string; created_at: string; conversation_id: string | null }): DrillDownSummary | null {
  const created = Date.parse(composition.created_at)
  // A minute of slack for clock steps; drill-downs run after the record.
  const since = Number.isFinite(created) ? created - 60_000 : 0
  const byConversation = composition.conversation_id
    ? sql`context_task_id = ${composition.conversation_id}`
    : sql`context_task_id IS NULL`
  try {
    const row = db.all<{ reads: number; calls: number | null }>(sql`SELECT COUNT(*) AS reads,
        MAX(CAST(json_extract(rank_detail_json, '$.call') AS INTEGER)) AS calls
      FROM memory_access_log
      WHERE ${byConversation} AND ts >= ${since} AND action = 'drilldown_read'
        AND json_valid(rank_detail_json) AND json_extract(rank_detail_json, '$.turnId') = ${composition.id}`)[0]
    const reads = Number(row?.reads ?? 0)
    const calls = row?.calls == null ? (reads > 0 ? null : 0) : Math.min(Number(row.calls), MEMORY_DRILL_LIMIT)
    return { calls, reads, limit: MEMORY_DRILL_LIMIT }
  } catch {
    return null
  }
}

// ─── Memory delivery by provider (G12) ────────────────────────────────

/** GET /api/v1/observability/memory-parity query: the window in days (default 7). */
export const MemoryParityQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
}).strip()

/** The latest turns listed per provider. */
export const MEMORY_PARITY_RECENT_TURNS = 10

/** One turn (context composition) as the parity view shows it. */
export interface MemoryParityTurn {
  compositionId: string
  createdAt: string
  conversationId: string | null
  model: string | null
  /** The turn block carried a memory recall section. */
  hasMemory: boolean
  /** Injected items per layer (memory id prefix: vt, gs, ft, en, ep, rw). */
  itemsByLayer: Record<string, number>
  items: number
  /** Sum of the injected items' own token estimates. */
  memoryTokens: number
  /** Drill-down calls that read memory (null: the rows carry no ordinal). */
  drillDownCalls: number | null
  /** Memory items the model read itself (memory_search / memory_expand). */
  drillDownReads: number
}

/** One provider's memory delivery over the window. */
export interface MemoryParityProvider {
  /** The provider that answered the turn (its last trace), else the one the prompt was built for. */
  provider: string
  turns: number
  /** Turns whose turn block carried memory. */
  memoryTurns: number
  /** Average injected items per layer, over the turns with memory. */
  avgItemsByLayer: Record<string, number>
  avgItems: number
  /** Average memory tokens, over the turns with memory. */
  avgMemoryTokens: number
  /** Turns in which the model read memory itself. */
  drillDownTurns: number
  /** Average drill-down calls per turn, over all turns. */
  avgDrillDownCalls: number
  /** Average memory items read by drill-down per turn, over all turns. */
  avgDrillDownReads: number
  /** The latest turns, newest first. */
  recentTurns: MemoryParityTurn[]
}

export interface MemoryParityReport {
  days: number
  since: string
  providers: MemoryParityProvider[]
}

interface ParityCompositionRow {
  id: string
  created_at: string
  conversation_id: string | null
  provider: string | null
  model: string | null
  delivery_json: string | null
  answered_provider: string | null
  answered_model: string | null
  has_memory: number
}

interface ParityLogRow {
  turn_id: string | null
  action: string
  memory_type: string
  n: number
  tokens: number
  calls: number | null
}

interface TurnLog {
  inject: Map<string, { n: number; tokens: number }>
  reads: number
  calls: number | null
}

const round2 = (n: number): number => Math.round(n * 100) / 100

function tableExists(db: EyasDb, name: string): boolean {
  try {
    return db.all(sql`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ${name}`).length > 0
  } catch {
    return false
  }
}

/**
 * The memory access log of the window, per turn id: the injected items per
 * layer (recall's inject rows, one per item with its own tokens) and the
 * model's drill-down reads (drilldown_read rows). Empty when the log cannot
 * be read (no memory module).
 */
function accessLogByTurn(db: EyasDb, sinceMs: number): Map<string, TurnLog> {
  const byTurn = new Map<string, TurnLog>()
  let rows: ParityLogRow[] = []
  try {
    rows = db.all<ParityLogRow>(sql`SELECT json_extract(rank_detail_json, '$.turnId') AS turn_id, action, memory_type,
        COUNT(*) AS n, SUM(COALESCE(tokens_estimate, 0)) AS tokens,
        MAX(CAST(json_extract(rank_detail_json, '$.call') AS INTEGER)) AS calls
      FROM memory_access_log
      WHERE ts >= ${sinceMs} AND action IN ('inject', 'drilldown_read') AND json_valid(rank_detail_json)
      GROUP BY turn_id, action, memory_type`)
  } catch {
    return byTurn
  }
  for (const row of rows) {
    if (typeof row.turn_id !== 'string' || !row.turn_id) continue
    const turn = byTurn.get(row.turn_id) ?? { inject: new Map(), reads: 0, calls: null }
    const n = Number(row.n ?? 0)
    if (row.action === 'inject') {
      const layer = turn.inject.get(row.memory_type) ?? { n: 0, tokens: 0 }
      layer.n += n
      layer.tokens += Number(row.tokens ?? 0)
      turn.inject.set(row.memory_type, layer)
    } else {
      turn.reads += n
      if (row.calls != null) turn.calls = Math.max(turn.calls ?? 0, Math.min(Number(row.calls), MEMORY_DRILL_LIMIT))
    }
    byTurn.set(row.turn_id, turn)
  }
  return byTurn
}

/**
 * Memory delivery per provider over the last `days` days: how many turns
 * carried memory, the injected items per layer and their tokens, and how
 * often the model opened memory itself — the same measures for every
 * provider, so an API model and a CLI can be compared. Built from the context
 * compositions of the window (short-retention: older turns are gone), the
 * memory access log's per-item rows and each composition's last trace.
 */
export function memoryParity(db: EyasDb, days: number, now: number = Date.now()): MemoryParityReport {
  const sinceMs = now - days * 86_400_000
  const since = new Date(sinceMs).toISOString()
  // A minute of slack for clock steps between the log and the composition.
  const log = accessLogByTurn(db, sinceMs - 60_000)
  const answered = tableExists(db, 'ai_traces')
    ? sql`(SELECT t.provider FROM ai_traces t WHERE t.composition_id = c.id ORDER BY t.timestamp DESC, t.rowid DESC LIMIT 1) AS answered_provider,
        (SELECT t.model FROM ai_traces t WHERE t.composition_id = c.id ORDER BY t.timestamp DESC, t.rowid DESC LIMIT 1) AS answered_model,`
    : sql`NULL AS answered_provider, NULL AS answered_model,`
  const compositions = db.all<ParityCompositionRow>(sql`SELECT c.id, c.created_at, c.conversation_id, c.provider, c.model,
      c.delivery_json, ${answered}
      EXISTS (SELECT 1 FROM context_sections s WHERE s.composition_id = c.id AND s.section_key = ${MEMORY_RECALL_SECTION_KEY}) AS has_memory
    FROM context_compositions c
    WHERE c.created_at >= ${since}
    ORDER BY c.created_at DESC, c.rowid DESC`)

  interface Acc {
    report: MemoryParityProvider
    layerSums: Record<string, number>
    items: number
    tokens: number
    calls: number
    reads: number
  }
  const byProvider = new Map<string, Acc>()
  for (const row of compositions) {
    const delivery = parseCompositionDelivery(row.delivery_json)
    const provider = row.answered_provider || row.provider || delivery?.profile?.providerId || 'unknown'
    const injected = log.get(delivery?.recall?.injectTurnId ?? row.id)?.inject
    const drill = log.get(row.id)
    const itemsByLayer: Record<string, number> = {}
    let items = 0
    let memoryTokens = 0
    for (const [layer, v] of injected ?? []) {
      itemsByLayer[layer] = v.n
      items += v.n
      memoryTokens += v.tokens
    }
    const reads = drill?.reads ?? 0
    const turn: MemoryParityTurn = {
      compositionId: row.id,
      createdAt: row.created_at,
      conversationId: row.conversation_id,
      model: row.answered_model || row.model || delivery?.profile?.modelId || null,
      hasMemory: Number(row.has_memory) === 1 || items > 0,
      itemsByLayer,
      items,
      memoryTokens,
      drillDownCalls: drill?.calls ?? (reads > 0 ? null : 0),
      drillDownReads: reads,
    }

    let acc = byProvider.get(provider)
    if (!acc) {
      acc = {
        report: {
          provider,
          turns: 0,
          memoryTurns: 0,
          avgItemsByLayer: {},
          avgItems: 0,
          avgMemoryTokens: 0,
          drillDownTurns: 0,
          avgDrillDownCalls: 0,
          avgDrillDownReads: 0,
          recentTurns: [],
        },
        layerSums: {},
        items: 0,
        tokens: 0,
        calls: 0,
        reads: 0,
      }
      byProvider.set(provider, acc)
    }
    acc.report.turns++
    if (turn.hasMemory) {
      acc.report.memoryTurns++
      for (const [layer, n] of Object.entries(itemsByLayer)) acc.layerSums[layer] = (acc.layerSums[layer] ?? 0) + n
      acc.items += items
      acc.tokens += memoryTokens
    }
    if (reads > 0) acc.report.drillDownTurns++
    // A turn whose rows carry no ordinal made at least one call.
    acc.calls += turn.drillDownCalls ?? 1
    acc.reads += reads
    if (acc.report.recentTurns.length < MEMORY_PARITY_RECENT_TURNS) acc.report.recentTurns.push(turn)
  }

  const providers = [...byProvider.values()].map(({ report, layerSums, items, tokens, calls, reads }) => {
    const memoryTurns = report.memoryTurns
    return {
      ...report,
      avgItemsByLayer: Object.fromEntries(
        Object.entries(layerSums)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([layer, n]) => [layer, memoryTurns > 0 ? round2(n / memoryTurns) : 0]),
      ),
      avgItems: memoryTurns > 0 ? round2(items / memoryTurns) : 0,
      avgMemoryTokens: memoryTurns > 0 ? Math.round(tokens / memoryTurns) : 0,
      avgDrillDownCalls: report.turns > 0 ? round2(calls / report.turns) : 0,
      avgDrillDownReads: report.turns > 0 ? round2(reads / report.turns) : 0,
    }
  })
  providers.sort((a, b) => b.turns - a.turns || a.provider.localeCompare(b.provider))
  return { days, since, providers }
}

interface SectionRow {
  ord: number
  zone: string
  section_key: string
  source_ref: string | null
  chars: number
  estimated_tokens: number
  budget_tokens: number | null
  truncated: number
  dropped_chars: number
  content: string | null
  content_hash: string | null
  // D7 additive columns: absent (undefined) on a table that predates them,
  // NULL on rows recorded before them.
  egress_masked?: number | null
  egress_spans?: string | null
  egress_skipped?: number | null
}

/**
 * What the privacy egress did to one section on the last remote call, or null
 * when nothing was recorded for it (no call yet, a local destination, a turn
 * section that rode in the user message, a section scanned as unattributed,
 * or a composition recorded before this existed).
 */
function mapSectionEgress(row: SectionRow): { masked: number; spans: Array<[number, number, string]>; skipped: boolean } | null {
  if (row.egress_skipped === 1) return { masked: 0, spans: [], skipped: true }
  if (row.egress_masked == null) return null
  return { masked: row.egress_masked, spans: parseEgressSpans(row.egress_spans) ?? [], skipped: false }
}

// Detail-only mapping — includes `content`, the full raw section text. NEVER
// reuse this for the list endpoint: that's the leak the brief calls out.
function mapSection(row: SectionRow) {
  return {
    ord: row.ord,
    zone: row.zone,
    key: row.section_key,
    sourceRef: row.source_ref,
    chars: row.chars,
    estimatedTokens: row.estimated_tokens,
    budgetTokens: row.budget_tokens,
    truncated: row.truncated === 1,
    droppedChars: row.dropped_chars,
    content: row.content,
    contentHash: row.content_hash,
    egress: mapSectionEgress(row),
  }
}

interface DailyRow {
  day: string
  section_key: string
  count: number
  sum_tokens: number
  max_tokens: number
  truncated_count: number
  sum_dropped_chars: number
}

function mapDaily(row: DailyRow) {
  return {
    day: row.day,
    sectionKey: row.section_key,
    count: row.count,
    sumTokens: row.sum_tokens,
    maxTokens: row.max_tokens,
    truncatedCount: row.truncated_count,
    sumDroppedChars: row.sum_dropped_chars,
  }
}

/**
 * Reads `limit`/`offset` query params. Rejects an out-of-range `limit` with
 * 400 instead of silently clamping it — a caller asking for 100000 rows
 * should be told no, not handed a quietly truncated response.
 */
function readPage(c: { req: { query(name: string): string | undefined } }, def: number, max: number) {
  const limitRaw = c.req.query('limit')
  let limit = def
  if (limitRaw != null && limitRaw !== '') {
    const n = Number(limitRaw)
    if (!Number.isFinite(n) || n <= 0) {
      throw new HTTPException(400, { message: 'limit must be a positive number' })
    }
    if (n > max) {
      throw new HTTPException(400, { message: `limit must be <= ${max}` })
    }
    limit = Math.floor(n)
  }

  const offsetRaw = c.req.query('offset')
  let offset = 0
  if (offsetRaw != null && offsetRaw !== '') {
    const n = Number(offsetRaw)
    offset = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
  }

  return { limit, offset }
}

export function createContextRoutes(app: Hono, db: EyasDb): void {
  // List compositions — summary rows only, NEVER section content. Listing
  // compositions must stay cheap and non-leaky; the full raw prompt text
  // (project context, memory, working directories) is only ever returned by
  // the single-composition detail endpoint below.
  app.get('/api/v1/observability/compositions', requirePermission('read', 'AuditEntry'), (c) => {
    const { limit, offset } = readPage(c, DEFAULT_COMPOSITION_LIMIT, MAX_COMPOSITION_LIMIT)

    const conversationId = c.req.query('conversationId')
    const runId = c.req.query('runId')
    const agentId = c.req.query('agentId')
    const entryPoint = c.req.query('entryPoint')
    const from = c.req.query('from')
    const to = c.req.query('to')

    const fragments: ReturnType<typeof sql>[] = []
    if (conversationId) fragments.push(sql`conversation_id = ${conversationId}`)
    if (runId) fragments.push(sql`run_id = ${runId}`)
    if (agentId) fragments.push(sql`agent_id = ${agentId}`)
    if (entryPoint) fragments.push(sql`entry_point = ${entryPoint}`)
    if (from) fragments.push(sql`created_at >= ${from}`)
    if (to) fragments.push(sql`created_at <= ${to}`)
    const where = fragments.length > 0 ? sql.join(fragments, sql` AND `) : sql`1=1`

    // NOTE: db.get() is deliberately avoided — on the bun:sqlite Drizzle
    // driver it returns a positional array, not a column-keyed object, so
    // every other query site in this module uses db.all()[0] instead.
    const countRow = db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM context_compositions WHERE ${where}`)[0]
    const rows = db.all<CompositionRow>(sql`SELECT * FROM context_compositions WHERE ${where}
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`)

    return c.json({ items: rows.map(mapComposition), total: Number(countRow?.n ?? 0) })
  })

  // Single composition + its sections, ordered by `ord` — that ordering IS
  // the prompt order, and the UI renders it directly. `composition.egress`
  // and each section's `egress` say what the privacy egress did on the way
  // to the model (null: nothing recorded); the section content stays the
  // assembled text, and the spans let the UI render it as sent.
  // `composition.delivery` is what memory reached the model and how (I12),
  // and `composition.drillDown` the turn's memory drill-down calls; both
  // null for a composition recorded without a delivery record.
  app.get('/api/v1/observability/compositions/:id', requirePermission('read', 'AuditEntry'), (c) => {
    const id = c.req.param('id')
    const composition = db.all<CompositionRow & { egress_json?: string | null; delivery_json?: string | null }>(sql`SELECT * FROM context_compositions WHERE id = ${id}`)[0]
    if (!composition) {
      throw new HTTPException(404, { message: 'Composition not found' })
    }
    const sections = db.all<SectionRow>(sql`SELECT * FROM context_sections
      WHERE composition_id = ${id} ORDER BY ord ASC`)
    const delivery = parseCompositionDelivery(composition.delivery_json)

    return c.json({
      composition: {
        ...mapComposition(composition),
        egress: parseCompositionEgress(composition.egress_json),
        delivery: mapDelivery(delivery),
        drillDown: delivery ? drillDownFor(db, composition) : null,
      },
      sections: sections.map(mapSection),
    })
  })

  // Memory delivery by provider (G12): per provider, the turns with memory,
  // the injected items per layer, memory tokens and drill-downs per turn.
  app.get('/api/v1/observability/memory-parity', requirePermission('read', 'AuditEntry'), (c) => {
    const days = c.req.query('days')
    const parsed = MemoryParityQuerySchema.safeParse(days === undefined || days === '' ? {} : { days })
    if (!parsed.success) {
      return c.json({ error: 'Invalid query', details: parsed.error.issues }, 400)
    }
    return c.json(memoryParity(db, parsed.data.days))
  })

  // Long-lived daily rollup — never touches the short-retention detail tables.
  app.get('/api/v1/observability/context-sections/daily', requirePermission('read', 'AuditEntry'), (c) => {
    const { limit, offset } = readPage(c, DEFAULT_DAILY_LIMIT, MAX_DAILY_LIMIT)

    const sectionKey = c.req.query('sectionKey')
    const from = c.req.query('from')
    const to = c.req.query('to')

    const fragments: ReturnType<typeof sql>[] = []
    if (sectionKey) fragments.push(sql`section_key = ${sectionKey}`)
    if (from) fragments.push(sql`day >= ${from}`)
    if (to) fragments.push(sql`day <= ${to}`)
    const where = fragments.length > 0 ? sql.join(fragments, sql` AND `) : sql`1=1`

    const rows = db.all<DailyRow>(sql`SELECT * FROM context_section_daily WHERE ${where}
      ORDER BY day DESC, section_key ASC LIMIT ${limit} OFFSET ${offset}`)

    return c.json({ items: rows.map(mapDaily) })
  })
}
