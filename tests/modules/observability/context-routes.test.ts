// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createContextTables } from '@modules/observability/context-schema'
import { createContextRoutes } from '@modules/observability/context-routes'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { MEMORY_DRILL_LIMIT } from '@modules/tools/builtin/memory-tools'
import { createMemoryDb, getRawFromDrizzle } from '../../helpers/test-db'

function seedComposition(db: any, over: Record<string, unknown> = {}) {
  const row = {
    id: 'comp-1',
    created_at: '2026-08-15T10:00:00.000Z',
    conversation_id: 'conv-1',
    run_id: null,
    agent_id: null,
    entry_point: 'conversation',
    provider: 'anthropic',
    model: 'claude-opus-5',
    context_window: 200000,
    budget_total_tokens: 10000,
    estimated_tokens: 42,
    prefix_hash: 'abc',
    section_count: 3,
    assembler_error: null,
    ...over,
  }
  db.run(sql`INSERT INTO context_compositions
    (id, created_at, conversation_id, run_id, agent_id, entry_point, provider, model,
     context_window, budget_total_tokens, estimated_tokens, prefix_hash, section_count, assembler_error)
    VALUES (${row.id}, ${row.created_at}, ${row.conversation_id}, ${row.run_id}, ${row.agent_id},
            ${row.entry_point}, ${row.provider}, ${row.model}, ${row.context_window},
            ${row.budget_total_tokens}, ${row.estimated_tokens}, ${row.prefix_hash},
            ${row.section_count}, ${row.assembler_error})`)
  return row.id
}

function seedSection(db: any, compositionId: string, ord: number, key: string, over: Record<string, unknown> = {}) {
  const row = {
    zone: 'prefix',
    source_ref: null,
    chars: 10,
    estimated_tokens: 3,
    budget_tokens: null,
    truncated: 0,
    dropped_chars: 0,
    content: `content for ${key}`,
    content_hash: 'hash',
    ...over,
  }
  db.run(sql`INSERT INTO context_sections
    (composition_id, ord, zone, section_key, source_ref, chars, estimated_tokens,
     budget_tokens, truncated, dropped_chars, content, content_hash)
    VALUES (${compositionId}, ${ord}, ${row.zone}, ${key}, ${row.source_ref}, ${row.chars},
            ${row.estimated_tokens}, ${row.budget_tokens}, ${row.truncated}, ${row.dropped_chars},
            ${row.content}, ${row.content_hash})`)
}

function seedDaily(db: any, day: string, sectionKey: string, over: Record<string, unknown> = {}) {
  const row = {
    count: 1,
    sum_tokens: 10,
    max_tokens: 10,
    truncated_count: 0,
    sum_dropped_chars: 0,
    ...over,
  }
  db.run(sql`INSERT INTO context_section_daily
    (day, section_key, count, sum_tokens, max_tokens, truncated_count, sum_dropped_chars)
    VALUES (${day}, ${sectionKey}, ${row.count}, ${row.sum_tokens}, ${row.max_tokens},
            ${row.truncated_count}, ${row.sum_dropped_chars})`)
}

let db: any

function mount(ability?: { can: (a: string, s: string) => boolean }) {
  const app = new Hono()
  if (ability) app.use('*', async (c, next) => { (c as any).set('ability', ability); await next() })
  createContextRoutes(app as any, db)
  return app
}

beforeEach(() => {
  db = drizzle(new Database(':memory:'))
  createContextTables(db)
})

describe('GET /api/v1/observability/compositions — auth', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await mount().request('/api/v1/observability/compositions')
    expect(res.status).toBe(401)
  })

  it('rejects when the ability denies AuditEntry', async () => {
    const res = await mount({ can: () => false }).request('/api/v1/observability/compositions')
    expect(res.status).toBe(403)
  })
})

describe('GET /api/v1/observability/compositions', () => {
  it('lists composition summary rows without section content', async () => {
    seedComposition(db)
    seedSection(db, 'comp-1', 0, 'core-identity')
    const res = await mount({ can: () => true }).request('/api/v1/observability/compositions')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.total).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id: 'comp-1', conversationId: 'conv-1', entryPoint: 'conversation' })
    // The list must never carry section content or a nested sections array —
    // that's the single-composition detail endpoint's job only.
    expect(body.items[0].content).toBeUndefined()
    expect(body.items[0].sections).toBeUndefined()
  })

  it('filters by conversationId', async () => {
    seedComposition(db, { id: 'comp-1', conversation_id: 'conv-1' })
    seedComposition(db, { id: 'comp-2', conversation_id: 'conv-2' })
    const res = await mount({ can: () => true }).request('/api/v1/observability/compositions?conversationId=conv-2')
    const body = await res.json() as any
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe('comp-2')
  })

  it('rejects a limit above the hard maximum with 400', async () => {
    const res = await mount({ can: () => true }).request('/api/v1/observability/compositions?limit=99999')
    expect(res.status).toBe(400)
  })

  it('applies a sane default limit when none is given', async () => {
    for (let i = 0; i < 3; i++) seedComposition(db, { id: `comp-${i}` })
    const res = await mount({ can: () => true }).request('/api/v1/observability/compositions')
    const body = await res.json() as any
    expect(body.items).toHaveLength(3)
    expect(body.total).toBe(3)
  })
})

describe('GET /api/v1/observability/compositions/:id', () => {
  it('returns 404 for an unknown composition', async () => {
    const res = await mount({ can: () => true }).request('/api/v1/observability/compositions/nope')
    expect(res.status).toBe(404)
  })

  it('returns sections in prompt order for a composition, including content', async () => {
    seedComposition(db)
    seedSection(db, 'comp-1', 2, 'third')
    seedSection(db, 'comp-1', 0, 'first')
    seedSection(db, 'comp-1', 1, 'second')
    const res = await mount({ can: () => true }).request('/api/v1/observability/compositions/comp-1')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.composition).toMatchObject({ id: 'comp-1' })
    expect(body.sections.map((s: any) => s.ord)).toEqual([0, 1, 2])
    expect(body.sections.map((s: any) => s.key)).toEqual(['first', 'second', 'third'])
    expect(body.sections[0].content).toBe('content for first')
  })
})

describe('GET /api/v1/observability/context-sections/daily', () => {
  it('returns daily rollup rows in the requested window', async () => {
    seedDaily(db, '2026-08-10', 'core-identity')
    seedDaily(db, '2026-09-01', 'core-identity') // outside window
    const res = await mount({ can: () => true })
      .request('/api/v1/observability/context-sections/daily?from=2026-08-01&to=2026-08-31')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.every((r: any) => r.day >= '2026-08-01' && r.day <= '2026-08-31')).toBe(true)
  })

  it('rejects an unauthenticated request', async () => {
    const res = await mount().request('/api/v1/observability/context-sections/daily')
    expect(res.status).toBe(401)
  })
})

// D7 — the detail says what the privacy egress did on the way to the model.
describe('GET /api/v1/observability/compositions/:id — privacy egress', () => {
  const EGRESS = {
    locality: 'remote',
    transport: 'gateway',
    providerId: 'openai',
    rulesetVersion: 'regex@2/policy@3',
    calls: 2,
    at: '2026-09-22T10:00:00.000Z',
    unattributed: { masked: 0, warned: 0 },
    messages: { masked: 1, warned: 0 },
    toolResults: [{ toolName: 'memory_search', transport: 'mcp-bridge', masked: 1, warned: 0, calls: 1 }],
    byType: { email: 2 },
  }

  it('(+) returns the composition digest and each section\'s masks', async () => {
    seedComposition(db)
    db.run(sql`UPDATE context_compositions SET egress_json = ${JSON.stringify(EGRESS)} WHERE id = 'comp-1'`)
    seedSection(db, 'comp-1', 0, 'core-rules')
    seedSection(db, 'comp-1', 1, 'memory-context')
    seedSection(db, 'comp-1', 2, 'memory-recall', { zone: 'turn' })
    db.run(sql`UPDATE context_sections SET egress_skipped = 1 WHERE ord = 0`)
    db.run(sql`UPDATE context_sections SET egress_skipped = 0, egress_masked = 1, egress_spans = '[[12,26,"email"]]' WHERE ord = 1`)

    const body = await (await mount({ can: () => true }).request('/api/v1/observability/compositions/comp-1')).json() as any
    expect(body.composition.egress).toEqual(EGRESS)
    expect(body.sections.map((s: any) => s.egress)).toEqual([
      { masked: 0, spans: [], skipped: true },
      { masked: 1, spans: [[12, 26, 'email']], skipped: false },
      null,
    ])
  })

  it('(+) a scanned section with nothing masked reports masked 0', async () => {
    seedComposition(db)
    seedSection(db, 'comp-1', 0, 'project-context')
    db.run(sql`UPDATE context_sections SET egress_skipped = 0, egress_masked = 0 WHERE ord = 0`)
    const body = await (await mount({ can: () => true }).request('/api/v1/observability/compositions/comp-1')).json() as any
    expect(body.sections[0].egress).toEqual({ masked: 0, spans: [], skipped: false })
  })

  it('(−) a composition recorded before the egress existed returns nulls, not an error', async () => {
    seedComposition(db)
    seedSection(db, 'comp-1', 0, 'core-rules')
    const res = await mount({ can: () => true }).request('/api/v1/observability/compositions/comp-1')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.composition.egress).toBeNull()
    expect(body.sections[0].egress).toBeNull()
  })

  it('(−) malformed stored egress data reads as null / no spans', async () => {
    seedComposition(db)
    db.run(sql`UPDATE context_compositions SET egress_json = '{not json' WHERE id = 'comp-1'`)
    seedSection(db, 'comp-1', 0, 'memory-context')
    db.run(sql`UPDATE context_sections SET egress_skipped = 0, egress_masked = 1, egress_spans = '[["x"]]' WHERE ord = 0`)
    const body = await (await mount({ can: () => true }).request('/api/v1/observability/compositions/comp-1')).json() as any
    expect(body.composition.egress).toBeNull()
    expect(body.sections[0].egress).toEqual({ masked: 1, spans: [], skipped: false })
  })

  it('(−) the list endpoint carries no egress detail', async () => {
    seedComposition(db)
    db.run(sql`UPDATE context_compositions SET egress_json = ${JSON.stringify(EGRESS)} WHERE id = 'comp-1'`)
    const body = await (await mount({ can: () => true }).request('/api/v1/observability/compositions')).json() as any
    expect(body.items[0]).not.toHaveProperty('egress')
  })
})

// I12 — the composition's memory delivery and its turn's drill-down calls.
describe('GET /api/v1/observability/compositions/:id — memory delivery', () => {
  const DELIVERY = {
    turnId: 'comp-1',
    profile: {
      providerId: 'claude-code', modelId: 'claude-code-sonnet', contextWindow: 1_000_000, resolved: true,
      windowSource: 'catalog', supportsTools: true, drillDown: true, toolAddressing: 'mcp-prefix',
    },
    budgetTotalTokens: 20_000,
    recall: { ids: ['vt:a.md', 'gs:g1', 'ft:f1'], retrieved: ['gs:g1', 'ft:f1'], expanded: ['gs:g1'], chars: 1_801, budgetChars: 6_000 },
    systemPromptChannel: 'prompt',
  }
  const CREATED = '2026-09-22T10:00:00.000Z'
  const at = (offsetMs: number) => Date.parse(CREATED) + offsetMs

  function withAccessLog(): void {
    // The real memory_access_log shape (memory/v2/schema.ts).
    createMemoryV2Tables(db, probeSqliteCapabilities(getRawFromDrizzle(db)))
  }

  function drill(memoryId: string, detail: Record<string, unknown> | null, over: { conv?: string | null; ts?: number; action?: string } = {}): void {
    db.run(sql`INSERT INTO memory_access_log (ts, actor, memory_type, memory_id, action, context_task_id, rank_detail_json)
      VALUES (${over.ts ?? at(5_000)}, 'model_drilldown', 'gs', ${memoryId}, ${over.action ?? 'drilldown_read'},
              ${over.conv === undefined ? 'conv-1' : over.conv}, ${detail ? JSON.stringify(detail) : null})`)
  }

  beforeEach(() => {
    db = createMemoryDb()
    createContextTables(db)
  })

  it('(+) returns the delivery with its counts and the drill-down calls joined by turn', async () => {
    withAccessLog()
    seedComposition(db, { created_at: CREATED })
    db.run(sql`UPDATE context_compositions SET delivery_json = ${JSON.stringify(DELIVERY)} WHERE id = 'comp-1'`)
    // Call 1 read two items, call 2 one; another turn's and an inject row do not count.
    drill('g1', { turnId: 'comp-1', call: 1 })
    drill('g2', { turnId: 'comp-1', call: 1 })
    drill('g3', { turnId: 'comp-1', call: 2 })
    drill('g4', { turnId: 'comp-other', call: 1 })
    drill('g5', { turnId: 'comp-1', tier: 'retrieved' }, { action: 'inject' })

    const body = await (await mount({ can: () => true }).request('/api/v1/observability/compositions/comp-1')).json() as any
    expect(body.composition.delivery).toEqual({
      turnId: 'comp-1',
      profile: DELIVERY.profile,
      budgetTotalTokens: 20_000,
      recall: {
        ids: ['vt:a.md', 'gs:g1', 'ft:f1'], hits: 3, retrieved: 2, expanded: 1,
        chars: 1_801, budgetChars: 6_000, tokens: 451, budgetTokens: 1_500, withheld: null,
      },
      systemPromptChannel: 'prompt',
    })
    expect(body.composition.drillDown).toEqual({ calls: 2, reads: 3, limit: MEMORY_DRILL_LIMIT })
  })

  it('(+) a turn without drill-downs reports 0 calls; rows from before the ordinal existed report reads only', async () => {
    withAccessLog()
    seedComposition(db, { created_at: CREATED })
    db.run(sql`UPDATE context_compositions SET delivery_json = ${JSON.stringify(DELIVERY)} WHERE id = 'comp-1'`)
    let body = await (await mount({ can: () => true }).request('/api/v1/observability/compositions/comp-1')).json() as any
    expect(body.composition.drillDown).toEqual({ calls: 0, reads: 0, limit: MEMORY_DRILL_LIMIT })
    drill('g1', { turnId: 'comp-1' })
    body = await (await mount({ can: () => true }).request('/api/v1/observability/compositions/comp-1')).json() as any
    expect(body.composition.drillDown).toEqual({ calls: null, reads: 1, limit: MEMORY_DRILL_LIMIT })
  })

  it('(−) rows of another conversation or from before the composition are not counted', async () => {
    withAccessLog()
    seedComposition(db, { created_at: CREATED })
    db.run(sql`UPDATE context_compositions SET delivery_json = ${JSON.stringify(DELIVERY)} WHERE id = 'comp-1'`)
    drill('g1', { turnId: 'comp-1', call: 1 }, { conv: 'conv-2' })
    drill('g2', { turnId: 'comp-1', call: 1 }, { ts: at(-3_600_000) })
    drill('g3', { turnId: 'comp-1', call: 1 }, { conv: null })
    const body = await (await mount({ can: () => true }).request('/api/v1/observability/compositions/comp-1')).json() as any
    expect(body.composition.drillDown).toEqual({ calls: 0, reads: 0, limit: MEMORY_DRILL_LIMIT })
  })

  it('(−) a composition without a delivery record returns null fields', async () => {
    withAccessLog()
    seedComposition(db, { created_at: CREATED })
    drill('g1', { turnId: 'comp-1', call: 1 })
    const res = await mount({ can: () => true }).request('/api/v1/observability/compositions/comp-1')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.composition.delivery).toBeNull()
    expect(body.composition.drillDown).toBeNull()
  })

  it('(−) a malformed delivery reads null; a missing access log leaves the delivery and a null drill-down', async () => {
    seedComposition(db, { id: 'comp-bad', created_at: CREATED })
    db.run(sql`UPDATE context_compositions SET delivery_json = '{"turnId":' WHERE id = 'comp-bad'`)
    seedComposition(db, { created_at: CREATED })
    db.run(sql`UPDATE context_compositions SET delivery_json = ${JSON.stringify(DELIVERY)} WHERE id = 'comp-1'`)
    const bad = await (await mount({ can: () => true }).request('/api/v1/observability/compositions/comp-bad')).json() as any
    expect(bad.composition.delivery).toBeNull()
    const ok = await (await mount({ can: () => true }).request('/api/v1/observability/compositions/comp-1')).json() as any
    expect(ok.composition.delivery.recall.hits).toBe(3)
    expect(ok.composition.drillDown).toBeNull()
  })

  it('(−) the list endpoint carries no delivery detail', async () => {
    seedComposition(db)
    db.run(sql`UPDATE context_compositions SET delivery_json = ${JSON.stringify(DELIVERY)} WHERE id = 'comp-1'`)
    const body = await (await mount({ can: () => true }).request('/api/v1/observability/compositions')).json() as any
    expect(body.items[0]).not.toHaveProperty('delivery')
    expect(body.items[0]).not.toHaveProperty('drillDown')
  })
})
