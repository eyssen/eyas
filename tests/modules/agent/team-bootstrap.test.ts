import { describe, it, expect, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createMemoryDb } from '../../helpers/test-db'
import { listTeamTemplates, applyTeamAgentSelection } from '@modules/agent/team-bootstrap'

describe('team-bootstrap', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs) { try { rmSync(d, { recursive: true }) } catch { /* ignore */ } }
    dirs.length = 0
  })
  const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'eyas-team-')); dirs.push(d); return d }

  function freshDb() {
    const db = createMemoryDb()
    db.run(sql`CREATE TABLE IF NOT EXISTS agent_definitions (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, tier TEXT NOT NULL DEFAULT 'specialist',
      agent_type TEXT NOT NULL DEFAULT 'assistant', model TEXT, max_turns INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'seed',
      addressable INTEGER NOT NULL DEFAULT 0, workspace_path TEXT, tools TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    return db
  }

  it('lists recommended + specialist templates', () => {
    const templates = listTeamTemplates()
    expect(templates.length).toBeGreaterThan(0)
    expect(templates.some((t) => t.recommended)).toBe(true)
    expect(templates.some((t) => t.id === 'code-reviewer')).toBe(true)
  })

  it('includes agentType and defaultEnabled so the wizard needs no hardcoded copy', () => {
    const templates = listTeamTemplates()
    expect(templates[0]).toHaveProperty('agentType')
    expect(templates[0]).toHaveProperty('defaultEnabled')
    expect(typeof templates[0].agentType).toBe('string')
    expect(typeof templates[0].defaultEnabled).toBe('boolean')
  })

  it('creates only the selected specialist agents', async () => {
    const db = freshDb()
    const res = await applyTeamAgentSelection({ db, dataDir: tmp() }, ['code-reviewer'])
    expect(res.created).toHaveLength(1)
    const rows = db.all(sql`SELECT name, source, tools FROM agent_definitions`) as any[]
    expect(rows.length).toBe(1)
    expect(rows[0].source).toBe('seed')
    // F1 task-3 (R6f): tools persisted at creation, not omitted
    expect(JSON.parse(rows[0].tools).length).toBeGreaterThan(0)
  })

  it('defaults to the recommended agents when nothing is selected', async () => {
    const db = freshDb()
    const res = await applyTeamAgentSelection({ db, dataDir: tmp() }, [])
    expect(res.created.length).toBeGreaterThan(0)
    const rows = db.all(sql`SELECT id FROM agent_definitions`) as any[]
    expect(rows.length).toBe(res.created.length)
  })
})
