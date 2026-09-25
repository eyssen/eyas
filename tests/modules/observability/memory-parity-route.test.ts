// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G12 — GET /api/v1/observability/memory-parity: memory delivery per
// provider, from the window's context compositions, recall's per-item inject
// rows and the model's drill-down rows in memory_access_log (I4's shape), and
// each composition's last trace (the provider that answered).

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createContextTables } from '@modules/observability/context-schema'
import { createObservabilityTables } from '@modules/observability/schema'
import { createContextRoutes, MEMORY_PARITY_RECENT_TURNS, memoryParity } from '@modules/observability/context-routes'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { logMemoryAccess } from '@modules/memory/v2/access-log'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { MEMORY_RECALL_SECTION_KEY } from '@modules/memory/v2/assemble'
import { MEMORY_DRILL_LIMIT } from '@modules/tools/builtin/memory-tools'
import { createMemoryDb, getRawFromDrizzle } from '../../helpers/test-db'
import type { EyasDb } from '@core/types'

let db: EyasDb

function mount(ability?: { can: (a: string, s: string) => boolean }) {
  const app = new Hono()
  if (ability) app.use('*', async (c, next) => { (c as any).set('ability', ability); await next() })
  createContextRoutes(app as any, db)
  return app
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const HOUR = 3_600_000

function composition(id: string, over: { provider?: string | null; model?: string | null; createdAt?: string; conversationId?: string | null; delivery?: unknown } = {}): void {
  db.run(sql`INSERT INTO context_compositions (id, created_at, conversation_id, entry_point, provider, model, delivery_json)
    VALUES (${id}, ${over.createdAt ?? ago(HOUR)}, ${over.conversationId === undefined ? 'conv-1' : over.conversationId},
            'conversation', ${over.provider === undefined ? 'anthropic' : over.provider}, ${over.model ?? null},
            ${over.delivery ? JSON.stringify(over.delivery) : null})`)
}

function recallSection(compositionId: string, ids: string[]): void {
  db.run(sql`INSERT INTO context_sections (composition_id, ord, zone, section_key, source_ref, content)
    VALUES (${compositionId}, 1, 'turn', ${MEMORY_RECALL_SECTION_KEY}, ${ids.join(',')}, '<eyas-memory/>')`)
}

function trace(compositionId: string, provider: string, model: string, timestamp: string): void {
  db.run(sql`INSERT INTO ai_traces (id, timestamp, request_id, model, provider, composition_id)
    VALUES (${`${compositionId}-${provider}-${timestamp}`}, ${timestamp}, 'req', ${model}, ${provider}, ${compositionId})`)
}

/** Recall's per-item inject rows (assemble.ts), as I4 logs them: one row per id with its own tokens. */
function injected(turnId: string, items: Array<[id: string, tokens: number]>, providerId = 'anthropic'): void {
  items.forEach(([id, tokens], i) => {
    const colon = id.indexOf(':')
    logMemoryAccess(db, {
      actor: 'system_index',
      memoryType: id.slice(0, colon),
      memoryId: id.slice(colon + 1),
      action: 'inject',
      contextTaskId: 'conv-1',
      tokensEstimate: tokens,
      rankDetail: { turnId, providerId, modelId: null, tier: 'standing', rank: i + 1 },
    })
  })
}

/** The model's drill-down reads (memory-tools.ts logDrill). */
function drilled(turnId: string, call: number | null, ids: string[]): void {
  for (const id of ids) {
    logMemoryAccess(db, {
      actor: 'model_drilldown',
      memoryType: id.slice(0, 2),
      memoryId: id.slice(3),
      action: 'drilldown_read',
      contextTaskId: 'conv-1',
      rankDetail: call === null ? { turnId } : { turnId, call },
    })
  }
}

beforeEach(() => {
  db = createMemoryDb()
  createObservabilityTables(db)
  createContextTables(db)
  createMemoryV2Tables(db, probeSqliteCapabilities(getRawFromDrizzle(db)))
})

describe('GET /api/v1/observability/memory-parity — access and input', () => {
  it('(−) 401 without an authenticated ability, 403 without read AuditEntry', async () => {
    expect((await mount().request('/api/v1/observability/memory-parity')).status).toBe(401)
    const denied = await mount({ can: (a, s) => !(a === 'read' && s === 'AuditEntry') }).request('/api/v1/observability/memory-parity')
    expect(denied.status).toBe(403)
  })

  it('(−) 400 on days=0, days=91 and a non-number', async () => {
    for (const days of ['0', '91', 'abc', '2.5', '-3']) {
      const res = await mount({ can: () => true }).request(`/api/v1/observability/memory-parity?days=${days}`)
      expect(res.status, `days=${days}`).toBe(400)
    }
  })

  it('(+) defaults to 7 days and accepts 1 and 90', async () => {
    const body = await (await mount({ can: () => true }).request('/api/v1/observability/memory-parity')).json() as any
    expect(body).toMatchObject({ days: 7, providers: [] })
    for (const days of [1, 90]) {
      const res = await mount({ can: () => true }).request(`/api/v1/observability/memory-parity?days=${days}`)
      expect(res.status).toBe(200)
      expect(((await res.json()) as any).days).toBe(days)
    }
  })
})

describe('GET /api/v1/observability/memory-parity — per-provider aggregates', () => {
  it('(+) aggregates I4-shaped log rows per answering provider', async () => {
    // grok-cli: two turns with memory, one without; drill-downs on one turn.
    composition('g1', { provider: 'grok-cli', createdAt: ago(3 * HOUR) })
    recallSection('g1', ['vt:a.md', 'vt:b.md', 'gs:g1'])
    injected('g1', [['vt:a.md', 20], ['vt:b.md', 30], ['gs:g1', 50]], 'grok-cli')
    drilled('g1', 1, ['gs:x1', 'gs:x2'])
    drilled('g1', 2, ['ft:y1'])

    composition('g2', { provider: 'grok-cli', createdAt: ago(2 * HOUR) })
    recallSection('g2', ['vt:a.md', 'ft:f1'])
    injected('g2', [['vt:a.md', 20], ['ft:f1', 10]], 'grok-cli')

    composition('g3', { provider: 'grok-cli', createdAt: ago(HOUR) })

    // anthropic: one turn; recall stamped a different turn id (injectTurnId).
    composition('a1', {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      createdAt: ago(HOUR),
      delivery: {
        turnId: 'a1', profile: null, budgetTotalTokens: null,
        recall: { ids: ['vt:a.md'], retrieved: [], expanded: [], chars: 40, budgetChars: 400, injectTurnId: 'recall-turn-a1' },
      },
    })
    recallSection('a1', ['vt:a.md'])
    injected('recall-turn-a1', [['vt:a.md', 12]])

    // A composition built for claude-code but answered by openai after a failover.
    composition('f1', { provider: 'claude-code', createdAt: ago(HOUR) })
    trace('f1', 'claude-code', 'claude-code-sonnet', '2026-09-22 10:00:00')
    trace('f1', 'openai', 'gpt-5', '2026-09-22 10:00:05')

    // Outside the 7-day window: not counted.
    composition('old', { provider: 'grok-cli', createdAt: ago(8 * 24 * HOUR) })
    recallSection('old', ['vt:a.md'])

    const res = await mount({ can: () => true }).request('/api/v1/observability/memory-parity?days=7')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    const byProvider = Object.fromEntries(body.providers.map((p: any) => [p.provider, p]))
    expect(Object.keys(byProvider).sort()).toEqual(['anthropic', 'grok-cli', 'openai'])
    expect(body.providers[0].provider).toBe('grok-cli')

    expect(byProvider['grok-cli']).toMatchObject({
      turns: 3,
      memoryTurns: 2,
      avgItemsByLayer: { ft: 0.5, gs: 0.5, vt: 1.5 },
      avgItems: 2.5,
      avgMemoryTokens: 65,
      drillDownTurns: 1,
      avgDrillDownCalls: 0.67,
      avgDrillDownReads: 1,
    })
    const g1 = byProvider['grok-cli'].recentTurns.find((t: any) => t.compositionId === 'g1')
    expect(g1).toMatchObject({
      hasMemory: true,
      itemsByLayer: { vt: 2, gs: 1 },
      items: 3,
      memoryTokens: 100,
      drillDownCalls: 2,
      drillDownReads: 3,
    })
    expect(byProvider['grok-cli'].recentTurns.map((t: any) => t.compositionId)).toEqual(['g3', 'g2', 'g1'])
    expect(byProvider['grok-cli'].recentTurns[0]).toMatchObject({ hasMemory: false, items: 0, drillDownCalls: 0, drillDownReads: 0 })

    expect(byProvider.anthropic).toMatchObject({
      turns: 1, memoryTurns: 1, avgItemsByLayer: { vt: 1 }, avgMemoryTokens: 12, avgDrillDownCalls: 0,
    })
    expect(byProvider.anthropic.recentTurns[0].model).toBe('claude-sonnet-4-6')

    expect(byProvider.openai).toMatchObject({ turns: 1, memoryTurns: 0, avgItems: 0, avgMemoryTokens: 0 })
    expect(byProvider.openai.recentTurns[0].model).toBe('gpt-5')
  })

  it('(+) drill-down rows without a call ordinal count one call; calls are capped at the per-turn limit', () => {
    composition('t1', { createdAt: ago(HOUR) })
    drilled('t1', null, ['gs:a', 'gs:b'])
    composition('t2', { createdAt: ago(HOUR) })
    drilled('t2', MEMORY_DRILL_LIMIT + 5, ['gs:c'])
    const report = memoryParity(db, 7)
    const turns = Object.fromEntries(report.providers[0].recentTurns.map((t) => [t.compositionId, t]))
    expect(turns.t1).toMatchObject({ drillDownCalls: null, drillDownReads: 2 })
    expect(turns.t2).toMatchObject({ drillDownCalls: MEMORY_DRILL_LIMIT, drillDownReads: 1 })
    expect(report.providers[0]).toMatchObject({ drillDownTurns: 2, avgDrillDownCalls: (1 + MEMORY_DRILL_LIMIT) / 2 })
  })

  it('(+) lists at most the latest turns per provider, newest first', () => {
    for (let i = 0; i < MEMORY_PARITY_RECENT_TURNS + 3; i++) composition(`c${i}`, { createdAt: ago((i + 1) * 60_000) })
    const [p] = memoryParity(db, 1).providers
    expect(p.turns).toBe(MEMORY_PARITY_RECENT_TURNS + 3)
    expect(p.recentTurns).toHaveLength(MEMORY_PARITY_RECENT_TURNS)
    expect(p.recentTurns[0].compositionId).toBe('c0')
  })

  it('(−) another turn\'s rows and rows outside the window are not counted; a composition with no provider is "unknown"', () => {
    composition('x1', { provider: null, createdAt: ago(HOUR) })
    recallSection('x1', ['vt:a.md'])
    injected('x2', [['vt:a.md', 99]])
    const [p] = memoryParity(db, 7).providers
    expect(p).toMatchObject({ provider: 'unknown', turns: 1, memoryTurns: 1, avgItems: 0, avgMemoryTokens: 0, drillDownTurns: 0 })
    expect(memoryParity(db, 7, Date.now() + 30 * 24 * HOUR).providers).toEqual([])
  })

  it('(−) without the memory access log (no memory module) turns still count, with no items', () => {
    const bare = createMemoryDb()
    createContextTables(bare)
    bare.run(sql`INSERT INTO context_compositions (id, created_at, entry_point, provider) VALUES ('b1', ${ago(HOUR)}, 'conversation', 'kimi-cli')`)
    const report = memoryParity(bare, 7)
    expect(report.providers).toHaveLength(1)
    expect(report.providers[0]).toMatchObject({ provider: 'kimi-cli', turns: 1, memoryTurns: 0, avgItems: 0, avgDrillDownCalls: 0 })
  })
})
