// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const securityEvents = sqliteTable('security_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  toolName: text('tool_name').notNull(),
  input: text('input'),
  decision: text('decision').notNull(),
  checkpoint: text('checkpoint').notNull(),
  reason: text('reason'),
  riskTier: text('risk_tier').notNull(),
  conversationId: text('conversation_id'),
  agentId: text('agent_id'),
  sessionRiskScore: real('session_risk_score').default(0),
  createdAt: text('created_at').notNull(),
})
