// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// NOTE: this table is created at runtime by conversations/index.ts onRegister
// (plus the board and agent modules' own ALTERs), not by a drizzle-kit
// migration. The declaration below is kept aligned with that runtime shape so
// drizzle-kit has a truthful input and so the schema contract test
// (tests/contracts/conversations-schema.contract.test.ts) can catch drift.
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  taskId: text('task_id'),
  title: text('title'),
  status: text('status').notNull().default('idle'),
  providerId: text('provider_id'),
  modelId: text('model_id'),
  userId: text('user_id').notNull(),
  tokensUsed: integer('tokens_used').notNull().default(0),
  projectId: text('project_id'),
  stageId: text('stage_id'),
  priority: text('priority').default('normal'),
  pinned: integer('pinned').default(0),
  position: real('position').default(0),
  dueDate: text('due_date'),
  prompt: text('prompt'),
  sdkSessionId: text('sdk_session_id'),
  assignees: text('assignees'),
  tags: text('tags'),
  mode: text('mode').notNull().default('simple'),
  agentId: text('agent_id'),
  parentConversationId: text('parent_conversation_id'),
  goalDescription: text('goal_description'),
  complexity: text('complexity'),
  totalCostUsd: real('total_cost_usd').default(0),
  teamSessionId: text('team_session_id'),
  thinking: text('thinking', { enum: ['off', 'on', 'auto'] }).notNull().default('off'),
  thinkingBudget: integer('thinking_budget'),
  effort: text('effort', { enum: ['low', 'medium', 'high', 'max'] }),
  orchestration: text('orchestration', { enum: ['solo', 'auto', 'deep'] }),
  voiceScopeOverride: text('voice_scope_override', { enum: ['internal', 'external'] }),
  /** JSON SearchContextSpec — pin indexed sources for multi-version Odoo etc. */
  searchContext: text('search_context'),
  /** JSON string[] — absolute working directories; first is primary cwd. */
  workingDirectories: text('working_directories'),
  /** Separate axis from orchestration: 0/1 multi-model ensemble. */
  godMode: integer('god_mode').notNull().default(0),
  designSystemId: text('design_system_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const conversationMessages = sqliteTable('conversation_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: text('conversation_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  model: text('model'),
  provider: text('provider'),
  tokensIn: integer('tokens_in').default(0),
  tokensOut: integer('tokens_out').default(0),
  attachments: text('attachments').default('[]'),
  createdAt: text('created_at').notNull(),
})
