// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createSkillLoader } from './skill-loader.js'
import { createSkillMatcher } from './skill-matcher.js'
import { createSkillsRoutes } from './routes.js'
import type { SkillsServices } from './routes.js'

export const skillsModule: EyasModule = {
  id: 'skills',
  name: 'Skills',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Skill loader, matcher, and management — markdown skills with YAML frontmatter',
  dependencies: [],

  async onRegister(ctx: ModuleContext) {
    // Create skills table
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      trigger_patterns TEXT,
      capabilities TEXT,
      version TEXT DEFAULT '1.0.0',
      content TEXT NOT NULL,
      skill_type TEXT NOT NULL DEFAULT 'knowledge',
      tool_config TEXT,
      integration_config TEXT,
      sources TEXT,
      source TEXT NOT NULL DEFAULT 'user',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)

    // Migrate existing tables — add new columns if missing
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN category TEXT`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN skill_type TEXT NOT NULL DEFAULT 'knowledge'`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN tool_config TEXT`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN integration_config TEXT`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN sources TEXT`) } catch { /* already exists */ }

    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_skills_type ON skills(skill_type)`)

    const loader = createSkillLoader(ctx.db, ctx.logger)
    const matcher = createSkillMatcher()

    const services: SkillsServices = { loader, matcher }
    ;(ctx as any).skills = services

    ctx.logger.info('Skills module registered')
  },

  async onStart(ctx: ModuleContext) {
    const services = (ctx as any).skills as SkillsServices

    // Load bundled skills from config/skills/
    const loaded = await services.loader.loadFromDirectory('config/skills')
    if (loaded > 0) {
      ctx.logger.info({ count: loaded }, 'Loaded bundled skills from config/skills/')
    }

    // Mount routes
    createSkillsRoutes(ctx.http, services)

    ctx.logger.info('Skills module started')
  },

  async onStop(_ctx: ModuleContext) {
    // No cleanup needed
  },
}
