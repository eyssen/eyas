import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const setupSteps = sqliteTable('setup_steps', {
  id: text('id').primaryKey(),
  status: text('status').notNull().default('pending'),
  data: text('data'),
  completedAt: text('completed_at'),
})
