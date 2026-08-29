// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createSkillLoader } from './skill-loader.js'
import { createSkillMatcher } from './skill-matcher.js'
import { createSkillsRoutes } from './routes.js'
import type { SkillsServices } from './routes.js'
import { resolveClassifyConfig } from './classify-skill.js'
import { runDeadSkillScan, applyDeadSkillApproval } from './dead-skill-detector.js'
import { runSkillScan } from './skill-inventory.js'

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
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN source_path TEXT`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN source_root TEXT`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN last_seen_at TEXT`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN disabled_reason TEXT`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN disabled_at TEXT`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN disabled_by TEXT`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0`) } catch { /* already exists */ }
    try { ctx.db.run(sql`ALTER TABLE skills ADD COLUMN last_used_at TEXT`) } catch { /* already exists */ }

    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS skill_shadowed_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id TEXT NOT NULL,
      path TEXT NOT NULL,
      root TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      UNIQUE(skill_id, path, root)
    )`)

    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS skill_usage_daily (
      day TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      injected_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, skill_id)
    )`)

    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_skills_type ON skills(skill_type)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_skills_last_used ON skills(last_used_at)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_shadowed_skill ON skill_shadowed_sources(skill_id)`)

    const loader = createSkillLoader(ctx.db, ctx.logger)
    const matcher = createSkillMatcher()

    const services: SkillsServices = { loader, matcher, db: ctx.db, classifyConfig: resolveClassifyConfig(ctx.config) }
    ;(ctx as any).skills = services

    ctx.logger.info('Skills module registered')
  },

  async onStart(ctx: ModuleContext) {
    const services = (ctx as any).skills as SkillsServices

    // Load bundled skills from config/skills/
    const scan = await services.loader.loadFromDirectory('config/skills')
    ctx.logger.info(
      { inserted: scan.inserted, updated: scan.updated, shadowed: scan.shadowed, complete: scan.complete },
      'Scanned bundled skills from config/skills/',
    )

    // Mount routes
    createSkillsRoutes(ctx.http, services)

    // Weekly dead-skill scan. It PROPOSES ONLY: every candidate becomes an
    // approval row, and nothing is ever disabled here (decision A2 —
    // docs/superpowers/specs/2026-07-11-eyas-prompt-phase3-autonomy-design.md).
    // A missing scheduler or security-gate simply means no proposals: the
    // detector stays inert rather than falling back to applying anything.
    const scheduler = (ctx as any).scheduler
    if (scheduler) {
      scheduler.registerHandler('skills.deadScan', async () => {
        // Orphan evidence needs a fresh directory rescan — findOrphans()
        // (Task 15) only means something relative to a scan that JUST ran.
        // Only the CORE root (config/skills, ~222 bundled skills) is rescanned
        // here: it's a literal already known in this module, so it needs no
        // new cross-module machinery. Enumerating enabled EXTENSION roots
        // would mean pulling in extensions/index.ts's directory logic (or a
        // new cross-module hook) — real design work, left as a follow-up.
        // A failed or incomplete rescan must not fail the whole detector run
        // — it just costs this week's orphan signal (runSkillScan already
        // returns orphans: [] on an incomplete scan; the try/catch covers a
        // scan that throws outright, e.g. an unexpected filesystem error).
        let orphanIds: string[] = []
        try {
          const rescan = await runSkillScan(ctx.db, services.loader, 'config/skills', 'config/skills')
          orphanIds = rescan.orphans
        } catch (err) {
          ctx.logger.warn({ err }, 'skills.deadScan: core rescan failed — proceeding without orphan evidence this run')
        }
        ctx.logger.info({ orphanIds: orphanIds.length }, 'skills.deadScan: orphan evidence fed into this run')
        return runDeadSkillScan({
          db: ctx.db,
          loader: services.loader,
          classifyConfig: services.classifyConfig,
          autonomyPolicy: (ctx as any).securityGate?.autonomyPolicy,
          logger: ctx.logger,
          orphanIds,
        })
      })
      if (!scheduler.list().some((j: any) => j.handler === 'skills.deadScan')) {
        scheduler.create({
          name: 'Dead skill scan',
          description: 'Proposes disabling unused, shadowed or orphaned skills. Applies nothing.',
          triggerType: 'cron',
          triggerConfig: JSON.stringify({ cron: '0 6 * * 1' }), // Weekly Monday 06:00
          handler: 'skills.deadScan',
          source: 'system',
          kind: 'handler',
        })
        ctx.logger.info('Seeded dead skill scan job')
      }
    } else {
      ctx.logger.warn('Skills: no scheduler available — the weekly dead-skill scan is not registered')
    }

    // The ONLY path that disables a skill on the detector's behalf: an owner
    // decision on the proposal it enqueued. Emitted by the security-gate
    // approve/reject route after autonomyPolicy.decide() succeeds.
    ctx.bus.on('autonomy:approval-resolved', async (data) => {
      const payload = data as { approvalId?: number; status?: string }
      if (typeof payload?.approvalId !== 'number' || typeof payload.status !== 'string') return
      const disabled = applyDeadSkillApproval(
        { db: ctx.db, loader: services.loader },
        { approvalId: payload.approvalId, status: payload.status },
      )
      if (disabled) ctx.logger.info({ skillId: disabled }, 'Skill disabled via approved dead-skill proposal')
    })

    ctx.logger.info('Skills module started')
  },

  async onStop(_ctx: ModuleContext) {
    // No cleanup needed
  },
}
