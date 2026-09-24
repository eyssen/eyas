// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A3 — continuity is EYAS replay only. Two boot migrations retire the stored
// provider session ids: the conversations module clears the inert legacy
// conversations.sdk_session_id column, and the model module drops the
// claude_code_sessions table. Both are idempotent and safe on a fresh DB.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb, createTestDb } from '../../helpers/test-db'
import { createProductionConversationsDb, conversationColumns } from '../../helpers/production-conversations-db'
import { clearLegacyProviderSessionIds } from '@modules/conversations/index'
import { createSetupRegistry } from '@modules/setup/registry'
import type { ModuleContext } from '@core/types'

const warnings: unknown[] = []
const logger = {
  info() {}, error() {}, debug() {}, trace() {}, fatal() {},
  warn(...args: unknown[]) { warnings.push(args) },
  child() { return logger },
} as any

beforeEach(() => { warnings.length = 0 })

function legacyConversationsDb() {
  const db = createMemoryDb()
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT, sdk_session_id TEXT)`)
  db.run(sql`INSERT INTO conversations (id, title, sdk_session_id) VALUES ('c1', 'a', 'host-session-1'), ('c2', 'b', NULL)`)
  return db
}

describe('clearLegacyProviderSessionIds', () => {
  it('clears every stored provider session id on a legacy database (positive)', () => {
    const db = legacyConversationsDb()
    clearLegacyProviderSessionIds({ db, logger } as any)
    const rows = db.all(sql`SELECT id, title, sdk_session_id FROM conversations ORDER BY id`) as any[]
    expect(rows).toEqual([
      { id: 'c1', title: 'a', sdk_session_id: null },
      { id: 'c2', title: 'b', sdk_session_id: null },
    ])
    // Idempotent: a second boot is a no-op.
    clearLegacyProviderSessionIds({ db, logger } as any)
    expect(warnings).toHaveLength(0)
  })

  it('leaves a database without the column untouched and does not warn (negative)', () => {
    const db = createMemoryDb()
    db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT)`)
    db.run(sql`INSERT INTO conversations (id, title) VALUES ('c1', 'a')`)
    clearLegacyProviderSessionIds({ db, logger } as any)
    expect(db.all(sql`SELECT id, title FROM conversations`)).toEqual([{ id: 'c1', title: 'a' }])
    expect(warnings).toHaveLength(0)
  })

  it('logs instead of throwing when the database refuses (fail-soft boot)', () => {
    const db = { all: () => { throw new Error('db gone') }, run: () => {}, get: () => undefined }
    expect(() => clearLegacyProviderSessionIds({ db, logger } as any)).not.toThrow()
    expect(warnings).toHaveLength(1)
  })

  it('a fresh production-shaped conversations table has no sdk_session_id column', async () => {
    const db = await createProductionConversationsDb()
    expect(conversationColumns(db)).not.toContain('sdk_session_id')
  })
})

describe('model module — legacy claude_code_sessions table', () => {
  function buildCtx(db: any): ModuleContext {
    return {
      db,
      logger,
      http: new Hono(),
      setup: createSetupRegistry(db),
      secrets: { get: async () => null, set: async () => {}, delete: async () => false, list: async () => [], has: async () => false },
    } as unknown as ModuleContext
  }

  function tables(db: any): string[] {
    return (db.all(sql`SELECT name FROM sqlite_master WHERE type = 'table'`) as Array<{ name: string }>).map((t) => t.name)
  }

  it('drops the table on boot when a legacy install still has it (positive)', async () => {
    const db = createTestDb('a3-claude-sessions-drop').open()
    db.run(sql`CREATE TABLE claude_code_sessions (conversation_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent_id TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`)
    db.run(sql`INSERT INTO claude_code_sessions (conversation_id, session_id) VALUES ('c1', 'host-session-1')`)
    const { modelModule } = await import('@modules/model/index')
    const ctx = buildCtx(db)
    await modelModule.onRegister!(ctx)
    expect(tables(db)).not.toContain('claude_code_sessions')
    // Nothing publishes a session store any more.
    expect((ctx as any).claudeSessionStore).toBeUndefined()
  })

  it('never creates the table on a fresh install, and a second boot is a no-op (negative)', async () => {
    const db = createTestDb('a3-claude-sessions-fresh').open()
    const { modelModule } = await import('@modules/model/index')
    await modelModule.onRegister!(buildCtx(db))
    await modelModule.onRegister!(buildCtx(db))
    expect(tables(db)).not.toContain('claude_code_sessions')
  })
})
