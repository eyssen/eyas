// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),                // e.g. 'coding/languages', 'api'
  triggerPatterns: text('trigger_patterns'),  // JSON array
  capabilities: text('capabilities'),        // JSON array
  version: text('version').default('1.0.0'),
  content: text('content').notNull(),
  skillType: text('skill_type').notNull().default('knowledge'), // 'knowledge' | 'tool' | 'integration'
  toolConfig: text('tool_config'),           // JSON — ToolConfig
  integrationConfig: text('integration_config'), // JSON — IntegrationConfig
  sources: text('sources'),                  // JSON — SkillSource[]
  source: text('source').notNull().default('user'),
  enabled: integer('enabled').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
