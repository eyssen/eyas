// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { mkdir, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { migrateCascadeFiles } from '../../scripts/lib/cascade-migration.js'

let dataDir: string
let db: ReturnType<typeof drizzle>

beforeEach(async () => {
  dataDir = join(tmpdir(), `eyas-cascade-${randomUUID()}`)
  await mkdir(dataDir, { recursive: true })
  const sqlite = new Database(':memory:')
  db = drizzle(sqlite)
  // Minimal project_types and projects tables matching board/schema.ts
  db.run(sql`CREATE TABLE project_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL DEFAULT '',
    default_stages TEXT NOT NULL DEFAULT '["Backlog"]',
    default_priority TEXT NOT NULL DEFAULT 'normal',
    color TEXT,
    icon TEXT,
    source TEXT NOT NULL DEFAULT 'user',
    indexed_sources TEXT,
    skills TEXT,
    permissions TEXT,
    default_agent_id TEXT,
    created_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    type_id TEXT,
    prompt TEXT,
    default_agent_id TEXT,
    indexed_sources TEXT,
    skills TEXT,
    permissions TEXT,
    color TEXT,
    source TEXT NOT NULL DEFAULT 'user',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`)
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

describe('migrateCascadeFiles', () => {
  it('returns 0 counts when no rows have prompts', async () => {
    db.run(sql`INSERT INTO project_types (id, name, prompt, created_at) VALUES ('pt1', 'Type', '', '2026-01-01')`)
    db.run(sql`INSERT INTO projects (id, name, prompt, created_at) VALUES ('p1', 'Proj', NULL, '2026-01-01')`)

    const result = await migrateCascadeFiles(db as never, dataDir)
    expect(result).toEqual({ projectTypesMigrated: 0, projectsMigrated: 0 })
    expect(existsSync(join(dataDir, 'project-types'))).toBe(false)
    expect(existsSync(join(dataDir, 'projects'))).toBe(false)
  })

  it('writes AGENTS.md for project types with non-empty prompts', async () => {
    db.run(sql`INSERT INTO project_types (id, name, prompt, created_at)
      VALUES ('pt1', 'Customer Engagement', 'Always greet the client.', '2026-01-01')`)
    db.run(sql`INSERT INTO project_types (id, name, prompt, created_at)
      VALUES ('pt2', 'Empty Type', '', '2026-01-01')`)

    const result = await migrateCascadeFiles(db as never, dataDir)
    expect(result.projectTypesMigrated).toBe(1)

    const content = await readFile(join(dataDir, 'project-types', 'pt1', 'AGENTS.md'), 'utf8')
    expect(content).toBe('Always greet the client.')
    expect(existsSync(join(dataDir, 'project-types', 'pt2'))).toBe(false)
  })

  it('writes AGENTS.md for projects with non-empty prompts', async () => {
    db.run(sql`INSERT INTO projects (id, name, prompt, created_at)
      VALUES ('p1', 'Eyssen ERP', '## Project context\n\nBudgeting workflow.', '2026-01-01')`)
    db.run(sql`INSERT INTO projects (id, name, prompt, created_at)
      VALUES ('p2', 'No Prompt', NULL, '2026-01-01')`)

    const result = await migrateCascadeFiles(db as never, dataDir)
    expect(result.projectsMigrated).toBe(1)

    const content = await readFile(join(dataDir, 'projects', 'p1', 'AGENTS.md'), 'utf8')
    expect(content).toContain('Project context')
    expect(content).toContain('Budgeting workflow')
    expect(existsSync(join(dataDir, 'projects', 'p2'))).toBe(false)
  })

  it('skips rows whose prompt is whitespace-only', async () => {
    db.run(sql`INSERT INTO project_types (id, name, prompt, created_at)
      VALUES ('pt1', 'Whitespace', '   \n  ', '2026-01-01')`)

    const result = await migrateCascadeFiles(db as never, dataDir)
    expect(result.projectTypesMigrated).toBe(0)
    expect(existsSync(join(dataDir, 'project-types'))).toBe(false)
  })
})
