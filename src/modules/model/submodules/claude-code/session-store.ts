// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Persists Claude Code session IDs per conversation so later turns can resume
// the same CLI session (context continuity across process restarts).

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export function createClaudeSessionTables(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS claude_code_sessions (
    conversation_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
}

export interface ClaudeSessionStore {
  get(conversationId: string): string | null
  set(conversationId: string, sessionId: string, agentId?: string): void
  clear(conversationId: string): void
}

export function createClaudeSessionStore(db: EyasDb): ClaudeSessionStore {
  return {
    get(conversationId) {
      const rows = db.all(sql`
        SELECT session_id FROM claude_code_sessions WHERE conversation_id = ${conversationId} LIMIT 1
      `) as Array<{ session_id: string }>
      return rows[0]?.session_id ?? null
    },
    set(conversationId, sessionId, agentId) {
      db.run(sql`
        INSERT INTO claude_code_sessions (conversation_id, session_id, agent_id, updated_at)
        VALUES (${conversationId}, ${sessionId}, ${agentId ?? null}, datetime('now'))
        ON CONFLICT(conversation_id) DO UPDATE SET
          session_id = ${sessionId},
          agent_id = COALESCE(${agentId ?? null}, agent_id),
          updated_at = datetime('now')
      `)
    },
    clear(conversationId) {
      db.run(sql`DELETE FROM claude_code_sessions WHERE conversation_id = ${conversationId}`)
    },
  }
}
