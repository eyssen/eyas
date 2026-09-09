import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const migrations = sqliteTable('_migrations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  appliedAt: text('applied_at').notNull().$defaultFn(() => new Date().toISOString()),
})
