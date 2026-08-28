// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const projectTypes = sqliteTable('project_types', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  prompt: text('prompt').notNull().default(''),
  defaultStages: text('default_stages').notNull().default('["Backlog","In Progress","Done"]'),
  defaultPriority: text('default_priority').notNull().default('normal'),
  color: text('color'),
  icon: text('icon'),
  source: text('source').notNull().default('user'),
  indexedSources: text('indexed_sources'),
  skills: text('skills'),
  permissions: text('permissions'),
  defaultAgentId: text('default_agent_id'),
  createdAt: text('created_at').notNull(),
})

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  typeId: text('type_id'),
  prompt: text('prompt'),
  defaultAgentId: text('default_agent_id'),
  indexedSources: text('indexed_sources'),
  workingDirectories: text('working_directories'),
  skills: text('skills'),
  permissions: text('permissions'),
  color: text('color'),
  source: text('source').notNull().default('user'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const stages = sqliteTable('stages', {
  id: text('id').primaryKey(),
  projectId: text('project_id'),
  name: text('name').notNull(),
  color: text('color'),
  sortOrder: integer('sort_order').notNull().default(0),
  isClosed: integer('is_closed').notNull().default(0),
  isHidden: integer('is_hidden').notNull().default(0),
  isFolded: integer('is_folded').notNull().default(0),
  botListen: integer('bot_listen').notNull().default(0),
  /** Agent that picks up cards entering this stage (NULL = none). */
  autoAssigneeId: text('auto_assignee_id'),
  /** Max cards allowed in this stage (NULL/0 = unlimited). */
  wipLimit: integer('wip_limit'),
  createdAt: text('created_at').notNull(),
})
