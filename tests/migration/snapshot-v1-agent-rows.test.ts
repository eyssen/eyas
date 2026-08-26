// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { snapshotV1AgentRows } from '../../scripts/lib/snapshot-v1-agent-rows.js'

interface SnapshotRow {
  id: string
  data: string
  snapshot_at: string
}

function setupDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  // Minimum viable agent_definitions (matches src/modules/agent/schema.ts shape)
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
  return db
}

describe('snapshotV1AgentRows', () => {
  let db: ReturnType<typeof setupDb>

  beforeEach(() => {
    db = setupDb()
  })

  it('returns 0 when there are no agent rows', async () => {
    const count = await snapshotV1AgentRows(db)
    expect(count).toBe(0)
  })

  it('bootstraps the snapshot table on first call', async () => {
    db.run(sql`INSERT INTO agent_definitions (id, name, system_prompt, created_at, updated_at)
      VALUES ('a1', 'Test', 'old prompt', '2026-01-01', '2026-01-01')`)
    const count = await snapshotV1AgentRows(db)
    expect(count).toBe(1)
    const rows = db.all<SnapshotRow>(sql`SELECT * FROM agent_definitions_v1_snapshot`)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('a1')
    expect(JSON.parse(rows[0].data).systemPrompt).toBe('old prompt')
  })

  it('snapshots all rows and INSERT-OR-REPLACEs on a second call', async () => {
    db.run(sql`INSERT INTO agent_definitions (id, name, system_prompt, created_at, updated_at)
      VALUES ('a1', 'A1', 'p1', '2026-01-01', '2026-01-01'),
             ('a2', 'A2', 'p2', '2026-01-01', '2026-01-01')`)
    const first = await snapshotV1AgentRows(db)
    expect(first).toBe(2)

    // Mutate row a1 in v1 then snapshot again — should overwrite the entry.
    db.run(sql`UPDATE agent_definitions SET system_prompt = 'p1-updated' WHERE id = 'a1'`)
    const second = await snapshotV1AgentRows(db)
    expect(second).toBe(2)

    const rows = db.all<SnapshotRow>(sql`SELECT * FROM agent_definitions_v1_snapshot ORDER BY id`)
    expect(rows).toHaveLength(2)
    expect(JSON.parse(rows[0].data).systemPrompt).toBe('p1-updated')
  })
})
