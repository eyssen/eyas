import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import {
  backfillConversationFts,
  ftsConversation,
} from '@modules/memory/search/conversation-fts'

let db: any

function tables() {
  db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle',
    user_id TEXT NOT NULL DEFAULT 'u1', project_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
  )`)
}

function conv(id: string, over: Record<string, unknown> = {}) {
  const now = '2026-08-31T00:00:00Z'
  db.run(sql`INSERT INTO conversations (id, title, status, project_id, created_at, updated_at)
    VALUES (${id}, ${over.title ?? id}, ${over.status ?? 'idle'}, ${over.project_id ?? null}, ${now}, ${now})`)
}

function msg(conversationId: string, role: string, content: string) {
  db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, created_at)
    VALUES (${conversationId}, ${role}, ${content}, '2026-08-31T00:00:00Z')`)
}

beforeEach(() => {
  db = createMemoryDb()
  tables()
  createMemoryTables(db)
})

describe('conversation FTS', () => {
  it('indexes inserts that happen after ensure, via the trigger', () => {
    conv('c1', { title: 'MNB' })
    msg('c1', 'user', 'Cloudflare 1010 blocked the IAP from pods')
    const hits = ftsConversation(db, 'Cloudflare IAP', { limit: 5, scope: 'all' })
    expect(hits.some(h => h.body.includes('Cloudflare 1010'))).toBe(true)
    expect(hits[0].conversationId).toBe('c1')
  })

  it('backfills rows that predate the triggers', () => {
    conv('c1')
    msg('c1', 'user', 'historical SOAP endpoint')
    // Recreate FTS without triggers by dropping — then insert, then ensure+backfill.
    db.run(sql`DROP TABLE IF EXISTS conversation_fts`)
    db.run(sql`DROP TRIGGER IF EXISTS conversation_fts_ai`)
    db.run(sql`DROP TRIGGER IF EXISTS conversation_fts_ad`)
    db.run(sql`DROP TRIGGER IF EXISTS conversation_fts_au`)
    msg('c1', 'assistant', 'use http://www.mnb.hu/arfolyamok.asmx')
    const { ensureConversationFts } = require('@modules/memory/search/conversation-fts')
    ensureConversationFts(db)
    expect(ftsConversation(db, 'arfolyamok', { limit: 5, scope: 'all' })).toHaveLength(0)
    let last = 0
    for (let i = 0; i < 10; i++) {
      const r = backfillConversationFts(db, { afterRowId: last, limit: 10 })
      last = r.lastRowId
      if (r.done) break
    }
    expect(ftsConversation(db, 'arfolyamok', { limit: 5, scope: 'all' }).length).toBeGreaterThan(0)
  })

  it('excludes deleted conversations', () => {
    conv('c1', { status: 'deleted' })
    msg('c1', 'user', 'secret deleted thread about IAP')
    expect(ftsConversation(db, 'IAP', { limit: 5, scope: 'all' })).toHaveLength(0)
  })

  it('excludes the current conversation', () => {
    conv('c1')
    conv('c2')
    msg('c1', 'user', 'unique-token-alpha IAP')
    msg('c2', 'user', 'unique-token-alpha SOAP')
    const hits = ftsConversation(db, 'unique-token-alpha', {
      limit: 5, scope: 'all', excludeConversationId: 'c1',
    })
    expect(hits.map(h => h.conversationId)).toEqual(['c2'])
  })

  it('does not index tool or system roles', () => {
    conv('c1')
    msg('c1', 'tool', 'tool output mentioning unique-token-bravo')
    msg('c1', 'system', 'system unique-token-bravo')
    msg('c1', 'user', 'hello')
    expect(ftsConversation(db, 'unique-token-bravo', { limit: 5, scope: 'all' })).toHaveLength(0)
  })

  it('scope=current hides other projects', () => {
    conv('c1', { project_id: 'proj-a' })
    conv('c2', { project_id: 'proj-b' })
    msg('c1', 'user', 'unique-token-charlie on A')
    msg('c2', 'user', 'unique-token-charlie on B')
    const hits = ftsConversation(db, 'unique-token-charlie', {
      limit: 5, scope: 'current', projectId: 'proj-a',
    })
    expect(hits.map(h => h.conversationId)).toEqual(['c1'])
  })

  it('omitted scope returns L0 from a project conversation', () => {
    conv('c1', { project_id: 'proj-a' })
    msg('c1', 'user', 'unique-token-golf on a real project')
    const hits = ftsConversation(db, 'unique-token-golf', { limit: 5 })
    expect(hits.map(h => h.conversationId)).toEqual(['c1'])
  })

  it('clips indexed body to 4000 characters', () => {
    conv('c1')
    const body = `head ${'x'.repeat(5000)} unique-token-delta`
    msg('c1', 'user', body)
    const hits = ftsConversation(db, 'head', { limit: 5, scope: 'all' })
    expect(hits[0].body.length).toBeLessThanOrEqual(4000)
    expect(ftsConversation(db, 'unique-token-delta', { limit: 5, scope: 'all' })).toHaveLength(0)
  })
})
