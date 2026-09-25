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
  sourcePath: text('source_path'),           // path of the winning source file, relative to sourceRoot
  sourceRoot: text('source_root'),           // scan root this skill was loaded from (e.g. 'config/skills')
  lastSeenAt: text('last_seen_at'),          // last time the source file was seen during a scan
  disabledReason: text('disabled_reason'),
  disabledAt: text('disabled_at'),
  disabledBy: text('disabled_by'),
  useCount: integer('use_count').notNull().default(0),
  lastUsedAt: text('last_used_at'),
  enabled: integer('enabled').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const skillShadowedSources = sqliteTable('skill_shadowed_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  skillId: text('skill_id').notNull(),
  path: text('path').notNull(),
  root: text('root').notNull(),
  seenAt: text('seen_at').notNull(),
})

export const skillUsageDaily = sqliteTable('skill_usage_daily', {
  day: text('day').notNull(),
  skillId: text('skill_id').notNull(),
  injectedCount: integer('injected_count').notNull().default(0),
})
