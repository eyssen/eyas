// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createContextTables } from '@modules/observability/context-schema'
import { createContextRoutes } from '@modules/observability/context-routes'

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
