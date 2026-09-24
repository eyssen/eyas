import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTaskSourceAdapter } from '@modules/proactive-assistant/source-adapters'
import { isBun } from '@shared/platform'

let rawDb: any
let drizzleDb: any
let adapter: ReturnType<typeof createTaskSourceAdapter>

function createRawDb() {
  // The source-adapters module calls `db.all(sql\`...\`)` — a Drizzle API.
  // Tests therefore need a Drizzle wrapper over an in-memory sqlite handle;
  // returning the raw handle bypassed Drizzle and produced "db.all is not a
  // function" at runtime.
  if (isBun) {
    const { Database } = require('bun:sqlite')
    const { drizzle } = require('drizzle-orm/bun-sqlite')
    const raw = new Database(':memory:')
    return { raw, db: drizzle(raw) }
  } else {
    const BetterSqlite3 = require('better-sqlite3')
    const { drizzle } = require('drizzle-orm/better-sqlite3')
    const raw = new BetterSqlite3(':memory:')
    return { raw, db: drizzle(raw) }
  }
}

function createTables(db: any) {
  // Drizzle's run() with a tagged-template statement covers DDL uniformly
  // across the two sqlite drivers (bun:sqlite + better-sqlite3).
  db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    due_date TEXT,
    updated_at TEXT NOT NULL
  )`)
}

beforeEach(() => {
  const created = createRawDb()
  rawDb = created.raw
  drizzleDb = created.db
  createTables(drizzleDb)
  adapter = createTaskSourceAdapter(drizzleDb)
})

describe('TaskSourceAdapter', () => {
  it('has correct type and name', () => {
    expect(adapter.type).toBe('tasks')
    expect(adapter.name).toBe('Task Monitor')
  })

  it('returns empty alerts when no data', async () => {
    const alerts = await adapter.check()
    expect(alerts).toEqual([])
  })

  it('detects overdue conversations', async () => {
    const yesterday = new Date(Date.now() - 86400_000).toISOString().split('T')[0]
    const stmt = rawDb.prepare(
      'INSERT INTO conversations (id, title, status, due_date, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    stmt.run('conv-1', 'Overdue Task', 'working', yesterday, new Date().toISOString())

    const alerts = await adapter.check()
    expect(alerts).toHaveLength(1)
    expect(alerts[0].id).toBe('overdue-conv-1')
    expect(alerts[0].type).toBe('warning')
    expect(alerts[0].title).toContain('Overdue')
    expect(alerts[0].title).toContain('Overdue Task')
    expect(alerts[0].priority).toBe('high')
    expect(alerts[0].actionable).toBe(true)
    expect(alerts[0].action!.type).toBe('open_conversation')
    expect(alerts[0].action!.data.conversationId).toBe('conv-1')
    expect(alerts[0].source).toBe('tasks')
  })

  it('does not flag conversations with future due dates', async () => {
    const tomorrow = new Date(Date.now() + 86400_000).toISOString().split('T')[0]
    rawDb.prepare(
      'INSERT INTO conversations (id, title, status, due_date, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-1', 'Future Task', 'working', tomorrow, new Date().toISOString())

    const alerts = await adapter.check()
    const overdue = alerts.filter((a: any) => a.id.startsWith('overdue-'))
    expect(overdue).toHaveLength(0)
  })

  it('ignores deleted and archived conversations for overdue check', async () => {
    const yesterday = new Date(Date.now() - 86400_000).toISOString().split('T')[0]
    const now = new Date().toISOString()

    rawDb.prepare(
      'INSERT INTO conversations (id, title, status, due_date, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-deleted', 'Deleted', 'deleted', yesterday, now)

    rawDb.prepare(
      'INSERT INTO conversations (id, title, status, due_date, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-archived', 'Archived', 'archived', yesterday, now)

    rawDb.prepare(
      'INSERT INTO conversations (id, title, status, due_date, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-idle', 'Idle', 'idle', yesterday, now)

    // Also add a 'working' conversation that should be detected
    rawDb.prepare(
      'INSERT INTO conversations (id, title, status, due_date, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-working', 'Working', 'working', yesterday, now)

    const alerts = await adapter.check()
    const overdue = alerts.filter((a: any) => a.id.startsWith('overdue-'))
    // 'deleted', 'archived', and 'idle' are all excluded; only 'working' should be detected
    expect(overdue).toHaveLength(1)
    expect(overdue[0].id).toBe('overdue-conv-working')
  })

  it('ignores conversations without due_date', async () => {
    rawDb.prepare(
      'INSERT INTO conversations (id, title, status, due_date, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-no-due', 'No Due Date', 'working', null, new Date().toISOString())

    const alerts = await adapter.check()
    const overdue = alerts.filter((a: any) => a.id.startsWith('overdue-'))
    expect(overdue).toHaveLength(0)
  })

  it('detects stalled conversations (working for >1 hour)', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString()
    rawDb.prepare(
      'INSERT INTO conversations (id, title, status, due_date, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-stalled', 'Stalled Task', 'working', null, twoHoursAgo)

    const alerts = await adapter.check()
    const stalled = alerts.filter((a: any) => a.id.startsWith('stalled-'))
    expect(stalled).toHaveLength(1)
    expect(stalled[0].title).toContain('Stalled')
    expect(stalled[0].title).toContain('Stalled Task')
    expect(stalled[0].priority).toBe('normal')
    expect(stalled[0].body).toContain('over an hour')
  })

  it('does not flag recently updated working conversations as stalled', async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString()
    rawDb.prepare(
      'INSERT INTO conversations (id, title, status, due_date, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-active', 'Active Task', 'working', null, fiveMinutesAgo)

    const alerts = await adapter.check()
    const stalled = alerts.filter((a: any) => a.id.startsWith('stalled-'))
    expect(stalled).toHaveLength(0)
  })

  it('does not flag non-working conversations as stalled', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString()
    rawDb.prepare(
      'INSERT INTO conversations (id, title, status, due_date, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-idle', 'Idle Task', 'idle', null, twoHoursAgo)

    const alerts = await adapter.check()
    const stalled = alerts.filter((a: any) => a.id.startsWith('stalled-'))
    expect(stalled).toHaveLength(0)
  })

  it('handles untitled conversations gracefully', async () => {
    const yesterday = new Date(Date.now() - 86400_000).toISOString().split('T')[0]
    rawDb.prepare(
      'INSERT INTO conversations (id, title, status, due_date, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-untitled', null, 'working', yesterday, new Date().toISOString())

    const alerts = await adapter.check()
    const overdue = alerts.find((a: any) => a.id === 'overdue-conv-untitled')
    expect(overdue).toBeDefined()
    expect(overdue!.title).toContain('Untitled')
  })

  it('uses prepared statements (no SQL injection)', async () => {
    // The adapter uses db.prepare() with parameterized queries
    // Verify it does not break with SQL injection-like values
    const yesterday = new Date(Date.now() - 86400_000).toISOString().split('T')[0]
    rawDb.prepare(
      'INSERT INTO conversations (id, title, status, due_date, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-inject', "Robert'); DROP TABLE conversations;--", 'working', yesterday, new Date().toISOString())

    const alerts = await adapter.check()
    expect(alerts.length).toBeGreaterThanOrEqual(1)
    // Table should still exist
    const count = rawDb.prepare('SELECT COUNT(*) as cnt FROM conversations').get()
    expect(count.cnt).toBe(1)
  })

  it('can detect both overdue and stalled in the same check', async () => {
    const yesterday = new Date(Date.now() - 86400_000).toISOString().split('T')[0]
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString()

    rawDb.prepare(
      'INSERT INTO conversations (id, title, status, due_date, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-overdue', 'Overdue One', 'working', yesterday, new Date().toISOString())

    rawDb.prepare(
      'INSERT INTO conversations (id, title, status, due_date, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-stalled', 'Stalled One', 'working', null, twoHoursAgo)

    const alerts = await adapter.check()
    const overdue = alerts.filter((a: any) => a.id.startsWith('overdue-'))
    const stalled = alerts.filter((a: any) => a.id.startsWith('stalled-'))
    expect(overdue.length).toBeGreaterThanOrEqual(1)
    expect(stalled.length).toBeGreaterThanOrEqual(1)
  })
})
