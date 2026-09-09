// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Drizzle schema representation of the channel_configs table.
 * The table is created by src/modules/communication/index.ts via raw SQL on first boot;
 * this file provides type-safe query access and drizzle-kit migration tracking.
 */
export const channelConfigs = sqliteTable('channel_configs', {
  id: text('id').primaryKey(),
  channelType: text('channel_type').notNull(),
  channelId: text('channel_id').notNull().unique(),
  name: text('name').notNull(),
  agentId: text('agent_id'),
  enabled: integer('enabled').notNull().default(1),
  config: text('config').default('{}'),
  forceVoiceScope: text('force_voice_scope', { enum: ['internal', 'external'] }),
  mode: text('mode', { enum: ['managed', 'autonomous'] }).notNull().default('managed'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})
