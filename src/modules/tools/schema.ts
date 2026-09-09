// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const toolExecutions = sqliteTable('tool_executions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: text('conversation_id'),
  agentId: text('agent_id'),
  toolName: text('tool_name').notNull(),
  input: text('input'),
  output: text('output'),
  error: text('error'),
  success: integer('success').notNull(),
  durationMs: integer('duration_ms').notNull(),
  createdAt: text('created_at').notNull(),
})
