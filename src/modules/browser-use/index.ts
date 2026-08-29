// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Optional sidecars: MIT Browser Use Python CLI (legacy) and Vercel
// agent-browser (recommended, Apache-2.0). Not Studio, not Media. LLM stays
// the EYAS model module. Do not vendor the Rust crate.

import { sql } from 'drizzle-orm'
import type { EyasModule, ModuleContext } from '@core/types'
import { createProcessRunner } from '@modules/studio/cli-runner.js'
import { load as loadSettings, save as saveSettings } from './settings-store.js'

export const browserUseModule: EyasModule = {
  id: 'browser-use',
  name: 'Browser Use',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Optional Browser Use / agent-browser CLI sidecars — persistent auth, not Studio, not Media.',
  dependencies: ['permissions', 'auth', 'tools'],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS browser_use_settings (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)

    try {
      ctx.permissions.registerSubject('BrowserUse', {
        actions: ['read', 'create', 'manage'],
        defaults: {
          owner: ['manage'],
          admin: ['manage'],
          user: ['read', 'create'],
          agent: ['create'],
          guest: [],
        },
      })
    } catch {
      /* already registered */
    }

    ctx.logger.info('Browser Use module registered')
  },

  async onStart(ctx: ModuleContext) {
    const runner = createProcessRunner()
    ;(ctx as any).browserUse = { runner }

    const registry = (ctx as any).tools?.registry
    if (registry) {
      const { createBrowserUseTools } = await import('./tools.js')
      for (const tool of createBrowserUseTools({
        getRunner: () => (ctx as any).browserUse?.runner,
        getSettings: () => loadSettings(ctx.db),
      })) {
        try {
          if (!registry.has?.(tool.name)) registry.register(tool)
        } catch (err) {
          ctx.logger.warn({ err, tool: tool.name }, 'Browser Use tool registration skipped')
        }
      }
    }

    const { createBrowserUseRoutes } = await import('./routes.js')
    createBrowserUseRoutes(ctx.http, {
      runner,
      load: () => loadSettings(ctx.db),
      save: (s) => saveSettings(ctx.db, s),
    })

    ctx.logger.info('Browser Use module started')
  },

  async onStop() {},
}
