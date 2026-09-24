// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// I2 — the memory drill-down tools: 3 calls per EYAS answer turn (keyed by the
// turnId the runner / the CLI bridge binding stamps), the same on every
// provider however long its loop runs; and a scope resolved on the server from
// the conversation row, never from the context's projectId.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { createMemoryTools, MEMORY_DRILL_LIMIT } from '@modules/tools/builtin/memory-tools'
import type { ToolContext, ToolImplementation } from '@modules/tools/types'

const logger: any = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger } }

let db: any
let service: { db: any; retrieve: ReturnType<typeof vi.fn>; expand: ReturnType<typeof vi.fn> }
let tools: Map<string, ToolImplementation>

function ctx(extra: Partial<ToolContext> = {}): ToolContext {
  return { conversationId: 'conv-p', userId: 'u1', logger, actor: { kind: 'agent', role: 'agent' }, ...extra }
}

async function call(name: string, input: Record<string, unknown>, c: ToolContext): Promise<any> {
  return tools.get(name)!.execute(input, c)
}

beforeEach(() => {
  db = createMemoryDb()
  createMemoryV2Tables(db, probeSqliteCapabilities(getRawFromDrizzle(db)))
  db.run(sql`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, type_id TEXT)`)
  db.run(sql`INSERT INTO projects (id, name, type_id) VALUES ('P', 'Home', 'T'), ('Q', 'Elsewhere', 'T')`)
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT)`)
  db.run(sql`INSERT INTO conversations (id, project_id) VALUES ('conv-p', 'P'), ('conv-free', NULL)`)
  service = {
    db,
    retrieve: vi.fn(async () => [{ id: 'gs:g1', source: 'gist', text: 'a remembered decision', score: 0.9 }]),
    expand: vi.fn(() => ({ id: 'gs:g1', source: 'gist', content: 'the whole gist', metadata: {} })),
  }
  tools = new Map(createMemoryTools(() => service).map((t) => [t.name, t]))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('per-turn drill budget', () => {
  it('two quick turns each get their own 3 calls', async () => {
    for (const turnId of ['turn-1', 'turn-2']) {
      for (let i = 0; i < MEMORY_DRILL_LIMIT; i++) {
        const out = await call('memory_search', { query: 'q' }, ctx({ turnId }))
        expect(out.error).toBeUndefined()
      }
    }
    expect(service.retrieve).toHaveBeenCalledTimes(2 * MEMORY_DRILL_LIMIT)
  })

  it('refuses a 4th call in the same turn — search, expand and the alias share the budget', async () => {
    const c = ctx({ turnId: 'turn-1' })
    await call('memory_search', { query: 'q' }, c)
    await call('memory_expand', { id: 'gs:g1' }, c)
    await call('search_memory', { query: 'q' }, c)
    const fourth = await call('memory_expand', { id: 'gs:g1' }, c)
    expect(fourth.error).toMatch(/limited to 3 memory tool calls per turn/)
    expect(service.expand).toHaveBeenCalledTimes(1)
  })

  it('a CLI loop longer than 90 seconds keeps the same turn budget', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-22T10:00:00Z'))
    const c = ctx({ turnId: 'turn-long' })
    for (let i = 0; i < MEMORY_DRILL_LIMIT; i++) await call('memory_search', { query: 'q' }, c)
    vi.setSystemTime(new Date('2026-09-22T10:05:00Z'))
    const late = await call('memory_search', { query: 'q' }, c)
    expect(late.error).toMatch(/per turn/)
    expect(late.results).toEqual([])
  })

  it('an outside caller without a turnId falls back to 3 calls per 90 seconds', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-22T10:00:00Z'))
    const c = ctx({ conversationId: 'mcp-external', actor: { kind: 'external', role: 'owner' } })
    for (let i = 0; i < MEMORY_DRILL_LIMIT; i++) {
      expect((await call('memory_search', { query: 'q' }, c)).error).toBeUndefined()
    }
    const refused = await call('memory_search', { query: 'q' }, c)
    expect(refused.error).toMatch(/per 90 seconds outside an EYAS turn/)
    vi.setSystemTime(new Date('2026-09-22T10:01:31Z'))
    expect((await call('memory_search', { query: 'q' }, c)).error).toBeUndefined()
  })

  it('logs every drill read with the turn it belongs to and the call\'s ordinal in it (I12)', async () => {
    await call('memory_search', { query: 'q' }, ctx({ turnId: 'turn-log' }))
    await call('memory_expand', { id: 'gs:g1' }, ctx({ turnId: 'turn-log' }))
    const rows = db.all(sql`SELECT actor, memory_type, memory_id, context_task_id, rank_detail_json FROM memory_access_log ORDER BY id`)
    expect(rows).toEqual([
      {
        actor: 'model_drilldown', memory_type: 'gs', memory_id: 'g1', context_task_id: 'conv-p',
        rank_detail_json: JSON.stringify({ turnId: 'turn-log', call: 1 }),
      },
      {
        actor: 'model_drilldown', memory_type: 'gs', memory_id: 'g1', context_task_id: 'conv-p',
        rank_detail_json: JSON.stringify({ turnId: 'turn-log', call: 2 }),
      },
    ])
  })

  it('(−) a refused call logs nothing, and a call outside a turn carries no turn detail', async () => {
    const c = ctx({ turnId: 'turn-full' })
    for (let i = 0; i < MEMORY_DRILL_LIMIT; i++) await call('memory_expand', { id: 'gs:g1' }, c)
    await call('memory_expand', { id: 'gs:g1' }, c)
    const calls = (db.all(sql`SELECT rank_detail_json FROM memory_access_log`) as Array<{ rank_detail_json: string }>)
      .map((r) => JSON.parse(r.rank_detail_json).call)
    expect(calls).toEqual([1, 2, 3])
    await call('memory_search', { query: 'q' }, ctx({ conversationId: 'mcp-external', actor: { kind: 'external', role: 'owner' } }))
    const outside = db.all(sql`SELECT rank_detail_json FROM memory_access_log WHERE context_task_id = 'mcp-external'`)
    expect(outside).toEqual([{ rank_detail_json: null }])
  })
})

describe('server-side drill scope', () => {
  it('ignores a spoofed context projectId: a P conversation reads P (+ its type + global)', async () => {
    await call('memory_search', { query: 'q' }, ctx({ projectId: 'Q', turnId: 't' }))
    expect(service.retrieve.mock.calls[0][0]).toMatchObject({ projectId: 'P', projectTypeId: 'T' })
    await call('memory_expand', { id: 'gs:g1' }, ctx({ projectId: 'Q', turnId: 't' }))
    expect(service.expand.mock.calls[0][1]).toEqual({ projectId: 'P', projectTypeId: 'T' })
  })

  it('fails closed on an unknown conversation: an error and no results', async () => {
    const out = await call('memory_search', { query: 'q' }, ctx({ conversationId: 'conv-gone', projectId: 'P', turnId: 't' }))
    expect(out.error).toMatch(/memory scope unresolved/)
    expect(out.results).toEqual([])
    const exp = await call('memory_expand', { id: 'gs:g1' }, ctx({ conversationId: 'conv-gone', turnId: 't' }))
    expect(exp.error).toMatch(/memory scope unresolved/)
    expect(service.retrieve).not.toHaveBeenCalled()
    expect(service.expand).not.toHaveBeenCalled()
  })

  it('an unresolved call does not spend the turn budget', async () => {
    const c = ctx({ conversationId: 'conv-gone', turnId: 'turn-x' })
    for (let i = 0; i < 5; i++) await call('memory_search', { query: 'q' }, c)
    const ok = await call('memory_search', { query: 'q' }, ctx({ turnId: 'turn-x' }))
    expect(ok.error).toBeUndefined()
  })

  it('a projectless conversation reads global memory only', async () => {
    await call('memory_search', { query: 'q' }, ctx({ conversationId: 'conv-free', projectId: 'P', turnId: 't' }))
    expect(service.retrieve.mock.calls[0][0]).toMatchObject({ projectId: null, projectTypeId: null })
  })

  it('an outside MCP client reads global memory only, whatever it claims', async () => {
    await call('memory_search', { query: 'q' }, ctx({ conversationId: 'mcp-external', projectId: 'P', actor: { kind: 'external', role: 'owner' } }))
    expect(service.retrieve.mock.calls[0][0]).toMatchObject({ projectId: null, projectTypeId: null })
  })

  it('fails closed when the service has no database to resolve the conversation with', async () => {
    const bare = createMemoryTools(() => ({ retrieve: service.retrieve })).find((t) => t.name === 'memory_search')!
    const out: any = await bare.execute({ query: 'q' }, ctx({ turnId: 't' }))
    expect(out.error).toMatch(/memory scope unresolved/)
    expect(service.retrieve).not.toHaveBeenCalled()
  })
})
