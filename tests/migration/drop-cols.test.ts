// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { dropV1Columns } from '../../scripts/migrate-prompts-v2-drop-cols.js'

type Db = ReturnType<typeof drizzle>

interface TableInfo {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

function setupDb(): Db {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)

  // Full agent_definitions schema (v1 + v2 columns)
  db.run(sql`CREATE TABLE agent_definitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT,
    description TEXT,
    goal TEXT,
    backstory TEXT,
    tier TEXT NOT NULL DEFAULT 'specialist',
    agent_type TEXT NOT NULL DEFAULT 'assistant',
    system_prompt TEXT,
    capabilities TEXT,
    tools TEXT,
    constraints TEXT,
    model TEXT,
    max_turns INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'seed',
    avatar TEXT,
    tags TEXT,
    monthly_token_budget INTEGER DEFAULT 0,
    tokens_used_month INTEGER DEFAULT 0,
    budget_reset_at TEXT,
    config TEXT,
    addressable INTEGER NOT NULL DEFAULT 0,
    workspace_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)

  // prompt_templates table (legacy)
  db.run(sql`CREATE TABLE prompt_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`)
  db.run(sql`INSERT INTO prompt_templates (id, name, content, created_at)
    VALUES ('pt1', 'Template A', 'Do stuff.', '2026-01-01')`)

  return db
}

function insertMigratedAgent(db: Db, id: string, name: string, workspacePath: string): void {
  db.run(sql`INSERT INTO agent_definitions
    (id, name, tier, workspace_path, created_at, updated_at)
    VALUES (${id}, ${name}, 'specialist', ${workspacePath}, '2026-01-01', '2026-01-01')`)
}

function insertUnmigratedAgent(db: Db, id: string, name: string): void {
  db.run(sql`INSERT INTO agent_definitions
    (id, name, tier, role, goal, system_prompt, created_at, updated_at)
    VALUES (${id}, ${name}, 'specialist', 'helper', 'Help users', 'You help.', '2026-01-01', '2026-01-01')`)
}

function getColumnNames(db: Db): string[] {
  const cols = db.all<TableInfo>(sql`PRAGMA table_info(agent_definitions)`)
  return cols.map((c) => c.name)
}

function tableExists(db: Db, tableName: string): boolean {
  const rows = db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type='table' AND name=${tableName}`,
  )
  return rows.length > 0
}

describe('dropV1Columns', () => {
  let db: Db

  beforeEach(() => {
    db = setupDb()
  })

  it('refuses to run if any agent has workspace_path NULL', async () => {
    insertMigratedAgent(db, 'a1', 'Migrated', 'data/agents/a1')
    insertUnmigratedAgent(db, 'a2', 'Not Yet Migrated')

    await expect(dropV1Columns(db as never)).rejects.toThrow('1 row(s) still on v1')
    await expect(dropV1Columns(db as never)).rejects.toThrow('a2')

    // Columns should still exist
    const cols = getColumnNames(db)
    expect(cols).toContain('role')
    expect(cols).toContain('system_prompt')
  })

  it('drops all v1 columns when all rows are migrated', async () => {
    insertMigratedAgent(db, 'a1', 'Jarvis', 'data/agents/a1')
    insertMigratedAgent(db, 'a2', 'Dev', 'data/agents/a2')

    await dropV1Columns(db as never)

    const cols = getColumnNames(db)
    // v1 columns must be gone
    expect(cols).not.toContain('role')
    expect(cols).not.toContain('goal')
    expect(cols).not.toContain('backstory')
    expect(cols).not.toContain('system_prompt')
    expect(cols).not.toContain('capabilities')
    expect(cols).not.toContain('tools')
    expect(cols).not.toContain('constraints')

    // v2 columns must remain
    expect(cols).toContain('id')
    expect(cols).toContain('name')
    expect(cols).toContain('workspace_path')
    expect(cols).toContain('addressable')
    expect(cols).toContain('tier')
    expect(cols).toContain('description')
  })

  it('drops the prompt_templates table', async () => {
    insertMigratedAgent(db, 'a1', 'Jarvis', 'data/agents/a1')
    expect(tableExists(db, 'prompt_templates')).toBe(true)

    await dropV1Columns(db as never)

    expect(tableExists(db, 'prompt_templates')).toBe(false)
  })

  it('succeeds when prompt_templates table does not exist (idempotent DROP IF EXISTS)', async () => {
    insertMigratedAgent(db, 'a1', 'Jarvis', 'data/agents/a1')
    db.run(sql`DROP TABLE prompt_templates`)

    await expect(dropV1Columns(db as never)).resolves.toBeUndefined()
    expect(tableExists(db, 'prompt_templates')).toBe(false)
  })

  it('succeeds with empty agent_definitions table', async () => {
    // No agents at all — nothing to check, nothing to drop
    await expect(dropV1Columns(db as never)).resolves.toBeUndefined()

    const cols = getColumnNames(db)
    expect(cols).not.toContain('role')
    expect(cols).not.toContain('system_prompt')
  })
})
