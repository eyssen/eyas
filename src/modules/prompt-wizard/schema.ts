// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const promptTemplates = sqliteTable('prompt_templates', {
  id: text('id').primaryKey(),
  level: text('level').notNull(),          // 'master' | 'project_type' | 'project' | 'conversation'
  targetId: text('target_id'),             // null for master level
  name: text('name').notNull(),
  content: text('content').notNull(),
  section: text('section'),
  locked: integer('locked').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
