import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const SYSTEM_ROLES = [
  { id: 'owner', name: 'Owner', description: 'Full system control — root user', isSystem: true },
  { id: 'admin', name: 'Admin', description: 'Manage users, settings, modules', isSystem: true },
  { id: 'user', name: 'User', description: 'Standard user access', isSystem: true },
  { id: 'agent', name: 'Agent', description: 'AI agent — restricted to explicit permissions', isSystem: true },
  { id: 'guest', name: 'Guest', description: 'Read-only access', isSystem: true },
] as const
