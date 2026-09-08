// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Read-only HTTP surface over the context-composition detail tables recorded
// by context-recorder.ts (see context-schema.ts for the table shapes). This
// is what the context inspector UI (Task 23/24) reads from.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { sql } from 'drizzle-orm'
import { requirePermission } from '@modules/permissions/middleware'
import type { EyasDb } from '@core/types'

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
  // the prompt order, and the UI renders it directly.
  app.get('/api/v1/observability/compositions/:id', requirePermission('read', 'AuditEntry'), (c) => {
    const id = c.req.param('id')
    const composition = db.all<CompositionRow>(sql`SELECT * FROM context_compositions WHERE id = ${id}`)[0]
    if (!composition) {
      throw new HTTPException(404, { message: 'Composition not found' })
    }
    const sections = db.all<SectionRow>(sql`SELECT * FROM context_sections
      WHERE composition_id = ${id} ORDER BY ord ASC`)

    return c.json({ composition: mapComposition(composition), sections: sections.map(mapSection) })
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
