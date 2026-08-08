// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createActivityService } from './activity-service.js'
import { generateId } from '@shared/crypto'

export const activityModule: EyasModule = {
  id: 'activity',
  name: 'Activity',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Odoo-style activity types, scheduling, chaining, done/cancel',
  dependencies: [],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS activity_types (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, category TEXT NOT NULL DEFAULT 'default' CHECK (category IN ('default', 'upload_file', 'phonecall', 'meeting')), decoration TEXT NOT NULL DEFAULT 'normal' CHECK (decoration IN ('normal', 'warning', 'danger')), delay_days INTEGER DEFAULT 0, delay_unit TEXT DEFAULT 'days' CHECK (delay_unit IN ('days', 'weeks', 'months')), trigger_next_type_id TEXT REFERENCES activity_types(id) ON DELETE SET NULL, suggest_next_type_id TEXT REFERENCES activity_types(id) ON DELETE SET NULL, default_user_id TEXT, summary_template TEXT, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`)
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, type_id TEXT NOT NULL REFERENCES activity_types(id) ON DELETE CASCADE, res_model TEXT NOT NULL, res_id TEXT NOT NULL, summary TEXT, note TEXT, user_id TEXT NOT NULL, created_by_id TEXT NOT NULL, date_deadline TEXT NOT NULL, done_at TEXT, feedback TEXT, automated INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`)

    // Indexes
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_activities_record ON activities(res_model, res_id)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_activities_user ON activities(user_id, date_deadline)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_activities_deadline ON activities(date_deadline)`)

    const activityService = createActivityService(ctx.db)
    ;(ctx as any).activity = activityService
    ctx.logger.info('Activity module registered')
  },

  async onStart(ctx: ModuleContext) {
    const activityService = (ctx as any).activity

    // Seed default activity types if none exist
    try {
      const existing = activityService.listTypes()
      if (existing.length === 0) {
        const defaults = [
          { name: 'To Do', icon: '✅', category: 'default', decoration: 'normal', sortOrder: 0 },
          { name: 'Code Review', icon: '🔍', category: 'default', decoration: 'warning', sortOrder: 1 },
          { name: 'Follow Up', icon: '📌', category: 'default', decoration: 'normal', sortOrder: 2 },
          { name: 'Upload Document', icon: '📎', category: 'upload_file', decoration: 'normal', sortOrder: 3 },
          { name: 'Meeting', icon: '📅', category: 'meeting', decoration: 'normal', sortOrder: 4 },
          { name: 'Call', icon: '📞', category: 'phonecall', decoration: 'normal', sortOrder: 5 },
        ]
        for (const t of defaults) {
          const id = generateId()
          ctx.db.run(sql`INSERT INTO activity_types (id, name, icon, category, decoration, sort_order)
            VALUES (${id}, ${t.name}, ${t.icon}, ${t.category}, ${t.decoration}, ${t.sortOrder})`)
        }
        ctx.logger.info('Seeded %d default activity types', defaults.length)
      }
    } catch (err) {
      ctx.logger.warn('Could not seed default activity types: %s', err)
    }

    const { createActivityRoutes } = await import('./routes.js')
    createActivityRoutes(ctx.http, activityService)
    ctx.logger.info('Activity module started')
  },

  async onStop() {},
}
