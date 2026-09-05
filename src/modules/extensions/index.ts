// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createExtensionManager } from './extension-manager.js'
import { createExtensionRoutes } from './routes.js'
import type { ExtensionServices } from './routes.js'
import { extensionRootId } from '@modules/skills/skill-inventory.js'

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
      let totalInserted = 0
      let totalUpdated = 0
      let anyIncomplete = false
      for (const dir of dirs) {
        // Each extension's install directory is its own scan root, so shadowing
        // and provenance (source_root) can distinguish one extension from another.
        // extensionRootId() prefixes the root so it can never collide with the
        // literal core root string ('config/skills'), whatever dataDir resolves to.
        const scan = await skillsServices.loader.loadFromDirectory(dir, extensionRootId(dir))
        totalInserted += scan.inserted
        totalUpdated += scan.updated
        if (!scan.complete) anyIncomplete = true
      }
      if (totalInserted + totalUpdated > 0) {
        ctx.logger.info(
          { inserted: totalInserted, updated: totalUpdated, extensions: dirs.length },
          'Loaded skills from extensions',
        )
      }
      if (anyIncomplete) {
        ctx.logger.warn({ dirs }, 'One or more extension skill scans were incomplete')
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
