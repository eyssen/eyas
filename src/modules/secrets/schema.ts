import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const secrets = sqliteTable('secrets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  scope: text('scope').notNull(),
  encrypted: text('encrypted').notNull(),
  iv: text('iv').notNull(),
  tag: text('tag').notNull(),
  module: text('module'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
