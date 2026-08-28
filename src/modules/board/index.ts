// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasDb, EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createProjectTypeService } from './services/project-type-service.js'
import { createProjectService } from './services/project-service.js'
import { createStageService } from './services/stage-service.js'
import { createTagService } from './services/tag-service.js'

/** Default operating brief for the seed 'general-general' project — the fallback home for every conversation. */
export const GENERAL_BRIEF = 'This is the owner\'s general workspace — the default home for everyday conversations and tasks. Prefer the internal board, memory, and knowledge base over external services. Keep work organized as tasks, capture decisions and findings in memory, and summarize outcomes when you finish.'

/** Old one-liner, kept around so the backfill migration can recognize (and safely replace) it. */
const OLD_GENERAL_TYPE_PROMPT = 'General-purpose project for quick conversations and tasks.'
export const GENERAL_TYPE_PROMPT = 'General-purpose workspace for everyday conversations, quick questions, and small tasks that don\'t belong to a dedicated project. Keep exchanges focused and lightweight, track any follow-up work as a task on the board, and prefer a more specific project type when one exists for the work at hand.'

const OLD_EYAS_TYPE_PROMPT = 'EYAS platform internal operations — agents, skills, prompts, system maintenance.'
export const EYAS_TYPE_PROMPT = 'Internal operations workspace for maintaining the EYAS platform itself — designing and tuning agents, building and testing skills, refining prompts, and handling day-to-day system maintenance. Treat changes here as platform engineering: verify behavior before calling it done, capture decisions in memory, and prefer the smallest safe change over a rewrite.'

/**
 * Seeds default project types and projects, and backfills the operating-brief
 * prompts on existing installs without clobbering an owner's own edits.
 * Extracted from onStart so it can run against a bare DB in tests.
 */
export function seedBoardDefaults(db: EyasDb, now: string, logger?: ModuleContext['logger']) {
  // Seed default project types
  try {
    const seedTypes = [
      {
        id: 'general',
        name: 'General',
        prompt: GENERAL_TYPE_PROMPT,
        icon: 'folder',
        stages: '["Backlog","To Do","In Progress","Review","Done"]',
      },
      {
        id: 'eyas',
        name: 'EYAS',
        prompt: EYAS_TYPE_PROMPT,
        icon: 'settings',
        stages: '["Backlog","To Do","In Progress","Review","Done"]',
      },
    ]
    for (const t of seedTypes) {
      db.run(sql`INSERT OR IGNORE INTO project_types (id, name, prompt, icon, default_stages, default_priority, source, created_at)
        VALUES (${t.id}, ${t.name}, ${t.prompt}, ${t.icon}, ${t.stages}, 'normal', 'seed', ${now})`)
    }
    logger?.info('Seeded %d default project types', seedTypes.length)
  } catch (err) {
    logger?.warn('Could not seed default project types: %s', err)
  }

  // Seed default projects
  try {
    const seedProjects = [
      { id: 'general-general', name: 'General', typeId: 'general', description: 'Default project for all conversations', prompt: GENERAL_BRIEF },
      { id: 'eyas-agents', name: 'Agents', typeId: 'eyas', description: 'Agent design, wizard conversations, agent configuration' },
      { id: 'eyas-skills', name: 'Skills', typeId: 'eyas', description: 'Skill development and testing' },
      { id: 'eyas-prompts', name: 'Prompts', typeId: 'eyas', description: 'Prompt template editing and refinement' },
      { id: 'eyas-system', name: 'System', typeId: 'eyas', description: 'Platform maintenance, system engineer tasks' },
    ]
    for (const p of seedProjects) {
      db.run(sql`INSERT OR IGNORE INTO projects (id, name, description, type_id, prompt, source, sort_order, created_at, updated_at)
        VALUES (${p.id}, ${p.name}, ${p.description}, ${p.typeId}, ${p.prompt ?? null}, 'seed', 0, ${now}, ${now})`)
    }
    logger?.info('Seeded %d default projects', seedProjects.length)
  } catch (err) {
    logger?.warn('Could not seed default projects: %s', err)
  }

  // Migration: backfill the richer prompts on existing installs, guarded so an owner edit is never overwritten.
  try {
    db.run(sql`UPDATE projects SET prompt=${GENERAL_BRIEF}, updated_at=${now} WHERE id='general-general' AND source='seed' AND (prompt IS NULL OR prompt='')`)
    db.run(sql`UPDATE project_types SET prompt=${GENERAL_TYPE_PROMPT} WHERE id='general' AND source='seed' AND prompt IN ('', ${OLD_GENERAL_TYPE_PROMPT})`)
    db.run(sql`UPDATE project_types SET prompt=${EYAS_TYPE_PROMPT} WHERE id='eyas' AND source='seed' AND prompt IN ('', ${OLD_EYAS_TYPE_PROMPT})`)
  } catch (err) {
    logger?.warn('Could not migrate default project/type prompts: %s', err)
  }
}

export const boardModule: EyasModule = {
  id: 'board',
  name: 'Board',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Kanban board — project types, projects, stages, conversation management',
  dependencies: ['conversations'],
  frontend: {
    widgets: [{ id: 'board.summary', titleKey: 'home.widget.board.title' }],
  },

  async onRegister(ctx: ModuleContext) {
    // Create board tables
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS project_types (id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '', default_stages TEXT NOT NULL DEFAULT '["Backlog","In Progress","Done"]', default_priority TEXT NOT NULL DEFAULT 'normal', color TEXT, icon TEXT, source TEXT NOT NULL DEFAULT 'user', indexed_sources TEXT, skills TEXT, permissions TEXT, created_at TEXT NOT NULL)`)
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, type_id TEXT, prompt TEXT, indexed_sources TEXT, skills TEXT, permissions TEXT, color TEXT, source TEXT NOT NULL DEFAULT 'user', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    // Recreate stages table if it has the old NOT NULL constraint on project_id
    try {
      const tableInfo = (ctx.db as any).all(sql`PRAGMA table_info(stages)`) as any[]
      const projectIdCol = tableInfo.find((c: any) => c.name === 'project_id')
      if (projectIdCol && projectIdCol.notnull === 1) {
        ctx.db.run(sql`DROP TABLE stages`)
      }
    } catch { /* table doesn't exist yet */ }
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS stages (id TEXT PRIMARY KEY, project_id TEXT, name TEXT NOT NULL, color TEXT, sort_order INTEGER NOT NULL DEFAULT 0, is_closed INTEGER NOT NULL DEFAULT 0, is_hidden INTEGER NOT NULL DEFAULT 0, is_folded INTEGER NOT NULL DEFAULT 0, bot_listen INTEGER NOT NULL DEFAULT 0, auto_assignee_id TEXT, wip_limit INTEGER, created_at TEXT NOT NULL)`)
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS tag_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#8b949e', sort_order INTEGER DEFAULT 0, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT DEFAULT (datetime('now')))`)
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#8b949e', category_id TEXT REFERENCES tag_categories(id) ON DELETE SET NULL, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT DEFAULT (datetime('now')))`)
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS conversation_tags (conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (conversation_id, tag_id))`)

    // Migration: add defaultAgentId columns
    try {
      ctx.db.run(sql`ALTER TABLE project_types ADD COLUMN default_agent_id TEXT`)
    } catch { /* column already exists */ }
    try {
      ctx.db.run(sql`ALTER TABLE projects ADD COLUMN default_agent_id TEXT`)
    } catch { /* column already exists */ }
    try { ctx.db.run(sql`ALTER TABLE projects ADD COLUMN working_directories TEXT`) } catch { /* already exists */ }
    // F1 — the project's brand. Everything produced in the project's
    // conversations is expected to follow it.
    try { ctx.db.run(sql`ALTER TABLE projects ADD COLUMN design_system_id TEXT`) } catch { /* already exists */ }

    // Migration: add source columns
    try { ctx.db.run(sql`ALTER TABLE project_types ADD COLUMN source TEXT NOT NULL DEFAULT 'user'`) } catch {}
    try { ctx.db.run(sql`ALTER TABLE projects ADD COLUMN source TEXT NOT NULL DEFAULT 'user'`) } catch {}
    // WIP limit per stage (0/null = unlimited)
    try { ctx.db.run(sql`ALTER TABLE stages ADD COLUMN wip_limit INTEGER`) } catch {}
    // Swimlane grouping preference is client-side; aging uses conversations.updated_at.

    // Extend conversations table with board fields
    const boardColumns = [
      { name: 'project_id', def: 'TEXT' },
      { name: 'stage_id', def: 'TEXT' },
      { name: 'priority', def: "TEXT DEFAULT 'normal'" },
      { name: 'pinned', def: 'INTEGER DEFAULT 0' },
      { name: 'position', def: 'REAL DEFAULT 0' },
      { name: 'due_date', def: 'TEXT' },
      { name: 'prompt', def: 'TEXT' },
      { name: 'assignees', def: 'TEXT' },
      { name: 'tags', def: 'TEXT' },
    ]
    for (const col of boardColumns) {
      try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN ${col.name} ${col.def}`)) } catch { /* column already exists */ }
    }

    // Indexes
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_conv_project_stage ON conversations(project_id, stage_id)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_conv_project_position ON conversations(project_id, position)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_stages_project ON stages(project_id, sort_order)`)

    const projectTypeService = createProjectTypeService(ctx.db)
    const projectService = createProjectService(ctx.db, projectTypeService)
    const stageService = createStageService(ctx.db)
    const tagService = createTagService(ctx.db)

    ;(ctx as any).board = {
      projectTypes: projectTypeService,
      projects: projectService,
      stages: stageService,
      tags: tagService,
      db: ctx.db,
    }
    ctx.logger.info('Board module registered')
  },

  async onStart(ctx: ModuleContext) {
    const board = (ctx as any).board
    // Ensure db is available for board card enrichment after restart/hot paths
    if (!board.db) board.db = ctx.db
    // Seed default global stages if none exist
    try {
      const globalStages = board.stages.listGlobal()
      if (globalStages.length === 0) {
        const defaults = [
          { name: 'Backlog', color: '#aaaaaa', sortOrder: 0 },
          { name: 'To Do', color: '#0061ff', sortOrder: 1, botListen: true },
          { name: 'In Progress', color: '#ff9300', sortOrder: 2 },
          { name: 'Review', color: '#be38f3', sortOrder: 3 },
          { name: 'Done', color: '#77bb41', sortOrder: 4, isClosed: true, isFolded: true },
        ]
        for (const stage of defaults) {
          board.stages.create({ ...stage, projectId: null })
        }
        ctx.logger.info('Seeded %d default global stages', defaults.length)
      }
    } catch (err) {
      ctx.logger.warn('Could not seed default stages: %s', err)
    }

    // Seed default project types + projects, and backfill their operating-brief prompts on existing installs
    seedBoardDefaults(ctx.db, new Date().toISOString(), ctx.logger)

    // Migrate: inherit default_agent_id from project_type if project has none
    try {
      ctx.db.run(sql`UPDATE projects SET default_agent_id = (
        SELECT pt.default_agent_id FROM project_types pt WHERE pt.id = projects.type_id
      ) WHERE projects.default_agent_id IS NULL AND projects.type_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM project_types pt WHERE pt.id = projects.type_id AND pt.default_agent_id IS NOT NULL)`)
    } catch (err) {
      ctx.logger.warn('Could not migrate project default agents: %s', err)
    }

    // Board→agent trigger: a card entering a bot-capable stage is armed for
    // the proactive-assistant's bot-executor. `stage_changed` is the single
    // stage-write signal (the move route and the move_to_stage tool both go
    // through conversationService.update), so one subscription covers both.
    const { createStageAutomation } = await import('./stage-automation.js')
    const automation = createStageAutomation({
      stages: board.stages,
      projects: board.projects,
      conversations: ctx.conversations,
      bus: ctx.bus,
      logger: ctx.logger,
    })
    ctx.bus.on('eyas.conversations.stage_changed', async (data) => {
      try {
        await automation.handleStageChanged(data as any)
      } catch (err) {
        ctx.logger.error({ err }, 'Stage automation failed')
      }
    })

    const { createBoardRoutes } = await import('./routes.js')
    // getDesigns is lazy: the design module publishes ctx.designs in its own
    // onRegister, and module order is not this module's business.
    createBoardRoutes(
      ctx.http,
      { ...board, getDesigns: () => (ctx as any).designs },
      ctx.conversations,
    )
    ctx.logger.info('Board module started')
  },

  async onStop() {},
}
