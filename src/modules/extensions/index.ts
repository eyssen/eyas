// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createExtensionManager } from './extension-manager.js'
import { createExtensionRoutes } from './routes.js'
import type { ExtensionServices } from './routes.js'

export const extensionsModule: EyasModule = {
  id: 'extensions',
  name: 'Extensions',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Extension marketplace — install optional skill packs with license consent',
  dependencies: ['skills'],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS installed_extensions (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      license TEXT NOT NULL,
      license_compat TEXT NOT NULL,
      license_accepted_at TEXT NOT NULL,
      installed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      install_path TEXT NOT NULL
    )`)

    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_extensions_enabled ON installed_extensions(enabled)`)

    const dataDir = (ctx as any).config?.dataDir ?? 'data'
    const manager = createExtensionManager(ctx.db, ctx.logger, dataDir)

    const services: ExtensionServices = { manager }
    ;(ctx as any).extensions = services

    ctx.logger.info('Extensions module registered')
  },

  async onStart(ctx: ModuleContext) {
    const services = (ctx as any).extensions as ExtensionServices

    // Load skills from enabled extensions into the skill loader
    const skillsServices = (ctx as any).skills
    if (skillsServices?.loader) {
      const dirs = services.manager.getEnabledSkillDirs()
      let totalLoaded = 0
      for (const dir of dirs) {
        const count = await skillsServices.loader.loadFromDirectory(dir)
        totalLoaded += count
      }
      if (totalLoaded > 0) {
        ctx.logger.info({ count: totalLoaded, extensions: dirs.length }, 'Loaded skills from extensions')
      }
    }

    // Mount routes
    createExtensionRoutes(ctx.http, services)

    ctx.logger.info('Extensions module started')
  },

  async onStop(_ctx: ModuleContext) {
    // No cleanup needed
  },
}
