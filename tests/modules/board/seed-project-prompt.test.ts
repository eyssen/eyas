import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { seedBoardDefaults, GENERAL_BRIEF, GENERAL_TYPE_PROMPT, ODOO_TYPE_PROMPT } from '@modules/board'

const testDb = createTestDb('board-seed-prompt')
let db: ReturnType<typeof testDb.open>

beforeEach(() => { db = testDb.open() })
afterEach(() => testDb.cleanup())

describe('seedBoardDefaults — operating brief', () => {
  it('gives the default project a real, non-null prompt', () => {
    seedBoardDefaults(db, new Date().toISOString())
    const row = db.all(sql`SELECT prompt FROM projects WHERE id = 'general-general'`)[0] as any
    expect(row.prompt).toBeTruthy()
    expect(row.prompt).toContain('default home for everyday conversations')
  })

  it('gives the general project-type a richer prompt than the old one-liner', () => {
    seedBoardDefaults(db, new Date().toISOString())
    const row = db.all(sql`SELECT prompt FROM project_types WHERE id = 'general'`)[0] as any
    expect(row.prompt).toBe(GENERAL_TYPE_PROMPT)
    expect(row.prompt).not.toBe('General-purpose project for quick conversations and tasks.')
  })

  it('does not clobber an owner-edited prompt on re-seed', () => {
    const now = new Date().toISOString()
    // First seed run — fresh install.
    seedBoardDefaults(db, now)
    // Owner edits the default project's prompt.
    db.run(sql`UPDATE projects SET prompt = 'My custom brief' WHERE id = 'general-general'`)
    db.run(sql`UPDATE project_types SET prompt = 'My custom type brief' WHERE id = 'general'`)
    // Re-running the seed (e.g. on next boot) must not overwrite the owner's edits.
    seedBoardDefaults(db, new Date().toISOString())
    const project = db.all(sql`SELECT prompt FROM projects WHERE id = 'general-general'`)[0] as any
    const type = db.all(sql`SELECT prompt FROM project_types WHERE id = 'general'`)[0] as any
    expect(project.prompt).toBe('My custom brief')
    expect(type.prompt).toBe('My custom type brief')
  })

  it('backfills an existing install that has a null/empty seed prompt without an owner edit', () => {
    const now = new Date().toISOString()
    // Simulate a pre-existing install: project + type inserted the OLD way (no prompt column / one-liner).
    db.run(sql`INSERT INTO project_types (id, name, prompt, icon, default_stages, default_priority, source, created_at)
      VALUES ('general', 'General', 'General-purpose project for quick conversations and tasks.', 'folder', '["Backlog"]', 'normal', 'seed', ${now})`)
    db.run(sql`INSERT INTO projects (id, name, description, type_id, source, sort_order, created_at, updated_at)
      VALUES ('general-general', 'General', 'Default project for all conversations', 'general', 'seed', 0, ${now}, ${now})`)

    seedBoardDefaults(db, new Date().toISOString())

    const project = db.all(sql`SELECT prompt FROM projects WHERE id = 'general-general'`)[0] as any
    const type = db.all(sql`SELECT prompt FROM project_types WHERE id = 'general'`)[0] as any
    expect(project.prompt).toBe(GENERAL_BRIEF)
    expect(type.prompt).toBe(GENERAL_TYPE_PROMPT)
  })
})

describe('seedBoardDefaults — domain type', () => {
  it('seeds a work-domain project type without instance project names', () => {
    seedBoardDefaults(db, new Date().toISOString())
    const row = db.all(sql`SELECT id, name, prompt, source FROM project_types WHERE id = 'odoo'`)[0] as any
    expect(row).toBeTruthy()
    expect(row.source).toBe('seed')
    expect(row.prompt).toBe(ODOO_TYPE_PROMPT)
    expect(row.prompt).toMatch(/indexer/i)
    expect(row.prompt.toLowerCase()).not.toMatch(/werth|soler|eyssen-erp|l10n_hu/)
    const underType = db.all(sql`SELECT id FROM projects WHERE type_id = 'odoo'`) as any[]
    expect(underType).toHaveLength(0)
  })

  it('keeps the four EYAS seed projects', () => {
    seedBoardDefaults(db, new Date().toISOString())
    const ids = (db.all(sql`SELECT id FROM projects WHERE type_id = 'eyas'`) as any[])
      .map((r) => r.id)
      .sort()
    expect(ids).toEqual(['eyas-agents', 'eyas-prompts', 'eyas-skills', 'eyas-system'])
  })

  it('does not clobber an owner-edited domain type prompt on re-seed', () => {
    const now = new Date().toISOString()
    seedBoardDefaults(db, now)
    db.run(sql`UPDATE project_types SET prompt = 'My domain brief' WHERE id = 'odoo'`)
    seedBoardDefaults(db, new Date().toISOString())
    const type = db.all(sql`SELECT prompt FROM project_types WHERE id = 'odoo'`)[0] as any
    expect(type.prompt).toBe('My domain brief')
  })
})
