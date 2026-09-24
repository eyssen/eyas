// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { Chunk } from '../../types.js'

interface ConversationRow {
  id: string
  title: string | null
  status: string
  created_at: string
  updated_at: string
  project_id: string | null
}

/**
 * Indexes existing conversations into search for ⌘K discovery.
 * Called once on startup, and can be re-triggered via bus events.
 */
export function indexConversations(db: any): Chunk[] {
  const rows = db.all(
    sql`SELECT id, title, status, created_at, updated_at, project_id FROM conversations WHERE status != 'deleted' ORDER BY updated_at DESC LIMIT 500`,
  ) as ConversationRow[]

  return rows
    .filter((r) => r.title && r.title.trim().length > 0)
    .map((r) => ({
      id: `conv-${r.id}`,
      sourceId: '__conversations__',
      collection: 'conversations',
      content: r.title!,
      metadata: {
        conversationId: r.id,
        status: r.status,
        projectId: r.project_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
    }))
}
