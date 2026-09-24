// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D3 migration (conversations.model_binding): agentless conversations keep
// their pair ('pinned'); agent-bound conversations and sub-conversations
// follow their colleague ('inherit'). It runs once — in the boot that adds
// the column — so a later user choice is never flipped back.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { conversationsModule } from '@modules/conversations/index'
import { createConversationService } from '@modules/conversations/conversation-service'

const logger: any = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger } }

function legacyDb() {
  const db = createMemoryDb()
  // The conversations table as a pre-D3 install has it: no model_binding.
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle', provider_id TEXT, model_id TEXT, user_id TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, agent_id TEXT, parent_conversation_id TEXT)`)
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO conversations (id, title, provider_id, model_id, user_id, created_at, updated_at, agent_id, parent_conversation_id) VALUES
    ('plain', 'a', 'grok-cli', 'grok-cli-default', 'u', ${now}, ${now}, NULL, NULL),
    ('empty', 'b', NULL, NULL, 'u', ${now}, ${now}, NULL, NULL),
    ('agent', 'c', 'claude-code', 'claude-code-sonnet', 'u', ${now}, ${now}, 'a1', NULL),
    ('child', 'd', 'claude-code', 'claude-code-opus', 'u', ${now}, ${now}, NULL, 'plain')`)
  return db
}

async function boot(db: any) {
  await conversationsModule.onRegister!({ db, logger, bus: { emit() {}, on() {}, off() {} }, config: {} } as any)
}

function modes(db: any): Record<string, { mode: string; provider: string | null; model: string | null }> {
  const rows = db.all(sql`SELECT id, model_binding, provider_id, model_id FROM conversations ORDER BY id`) as any[]
  return Object.fromEntries(rows.map((r) => [r.id, { mode: r.model_binding, provider: r.provider_id, model: r.model_id }]))
}

describe('conversations.model_binding migration', () => {
  it('agentless rows are pinned with their pair unchanged; agent-bound rows and children inherit (positive)', async () => {
    const db = legacyDb()
    await boot(db)
    expect(modes(db)).toEqual({
      agent: { mode: 'inherit', provider: 'claude-code', model: 'claude-code-sonnet' },
      child: { mode: 'inherit', provider: 'claude-code', model: 'claude-code-opus' },
      empty: { mode: 'pinned', provider: null, model: null },
      plain: { mode: 'pinned', provider: 'grok-cli', model: 'grok-cli-default' },
    })
  })

  it('a second boot does not flip a row the user later set to Auto (negative)', async () => {
    const db = legacyDb()
    await boot(db)
    db.run(sql`UPDATE conversations SET model_binding = 'auto' WHERE id IN ('plain', 'agent')`)
    await boot(db)
    const after = modes(db)
    expect(after.plain.mode).toBe('auto')
    expect(after.agent.mode).toBe('auto')
  })

  it('the service reads the stored mode, and derives it for a row from a table without the column', () => {
    const db = createMemoryDb()
    db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, status TEXT, user_id TEXT, agent_id TEXT, parent_conversation_id TEXT, created_at TEXT, updated_at TEXT)`)
    db.run(sql`CREATE TABLE conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT)`)
    db.run(sql`INSERT INTO conversations (id, status, user_id, agent_id) VALUES ('x', 'idle', 'u', 'a1'), ('y', 'idle', 'u', NULL)`)
    const svc = createConversationService(db)
    expect(svc.get('x')!.modelBinding).toBe('inherit')
    expect(svc.get('y')!.modelBinding).toBe('pinned')
  })
})
