import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { SYSTEM_ROLES } from './schema.js'

export const permissionsModule: EyasModule = {
  id: 'permissions',
  name: 'Permissions',
  version: '1.0.0',
  type: 'core',
  required: true,
  description: 'CASL-based permission engine with modular subject registration',
  dependencies: [],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        is_system INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    ctx.logger.info('Permissions module registered')
  },

  async onStart(ctx: ModuleContext) {
    const db = ctx.db
    for (const role of SYSTEM_ROLES) {
      db.run(sql`
        INSERT OR IGNORE INTO roles (id, name, description, is_system)
        VALUES (${role.id}, ${role.name}, ${role.description}, 1)
      `)
    }
    ctx.logger.info('System roles seeded')
  },

  async onStop() {},
}
