// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const providerConfig = sqliteTable('provider_config', {
  id: text('id').primaryKey(),
  enabled: integer('enabled').notNull().default(1),
  settings: text('settings').default('{}'),
  isDefault: integer('is_default').notNull().default(0),
  defaultModel: text('default_model'),
  updatedAt: text('updated_at').notNull(),
})

export const modelConfig = sqliteTable('model_config', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().references(() => providerConfig.id),
  modelId: text('model_id').notNull(),
  enabled: integer('enabled').notNull().default(1),
  name: text('name').notNull(),
  contextWindow: integer('context_window'),
  maxOutputTokens: integer('max_output_tokens'),
  supportsTools: integer('supports_tools').default(1),
  supportsImages: integer('supports_images').default(1),
  supportsStreaming: integer('supports_streaming').default(1),
  updatedAt: text('updated_at').notNull(),
})
