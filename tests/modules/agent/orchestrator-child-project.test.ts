// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createConversationService } from '@modules/conversations/conversation-service'

/**
 * Guards the orchestrator's child-conversation contract at the service level:
 * `projectId` must be an accepted create input AND update key, so the
 * orchestrator's one-line fix actually lands in the column rather than being
 * silently dropped by UPDATE_FIELD_MAP.
 */
function conversationsTable(db: any) {
  db.run(sql`CREATE TABLE conversations (
    id TEXT PRIMARY KEY, task_id TEXT, title TEXT, status TEXT NOT NULL DEFAULT 'idle',
    provider_id TEXT, model_id TEXT, user_id TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0,
    project_id TEXT, stage_id TEXT, priority TEXT NOT NULL DEFAULT 'normal',
    pinned INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, due_date TEXT,
    prompt TEXT, sdk_session_id TEXT, assignees TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]', mode TEXT NOT NULL DEFAULT 'simple', agent_id TEXT,
    parent_conversation_id TEXT, goal_description TEXT, complexity TEXT,
    total_cost_usd REAL NOT NULL DEFAULT 0, team_session_id TEXT,
    thinking TEXT NOT NULL DEFAULT 'off', thinking_budget INTEGER, effort TEXT,
    orchestration TEXT NOT NULL DEFAULT 'auto', voice_scope_override TEXT,
    search_context TEXT, working_directories TEXT, god_mode INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  // get() joins messages, so the fixture needs this table even though these
  // tests never write one.
  db.run(sql`CREATE TABLE conversation_messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT NOT NULL, model TEXT, provider TEXT,
    tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
    attachments TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)`)
}

function svcOn(db: any) {
  conversationsTable(db)
  return createConversationService(db)
}

describe('child conversation project inheritance', () => {
  it('accepts projectId through update() and persists it', () => {
    const db = createMemoryDb()
    const svc = svcOn(db)

    const child = svc.create({ userId: 'system', title: 'Member: reviewer' })
    expect(child.projectId).toBeNull()

    svc.update(child.id, { parentConversationId: 'parent-1', agentId: 'a1', mode: 'managed', projectId: 'p-42' })

    const rows = db.all(sql`SELECT project_id FROM conversations WHERE id = ${child.id}`) as any[]
    expect(rows[0].project_id).toBe('p-42')
    expect(svc.get(child.id)?.projectId).toBe('p-42')
  })

  it('persists projectId supplied at create time', () => {
    const db = createMemoryDb()
    const svc = svcOn(db)
    const c = svc.create({ userId: 'system', title: 'x', projectId: 'p-7' })
    expect(c.projectId).toBe('p-7')
    expect(svc.get(c.id)?.projectId).toBe('p-7')
  })

  it('leaves projectId null when the caller omits it', () => {
    const db = createMemoryDb()
    const svc = svcOn(db)
    expect(svc.create({ userId: 'system', title: 'x' }).projectId).toBeNull()
  })
})
