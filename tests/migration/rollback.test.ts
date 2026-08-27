// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { snapshotV1AgentRows } from '../../scripts/lib/snapshot-v1-agent-rows.js'
import { restoreFromSnapshot } from '../../scripts/migrate-prompts-v2-rollback.js'

type Db = ReturnType<typeof drizzle>

interface AgentRow {
  id: string
  name: string
  role: string | null
  goal: string | null
  backstory: string | null
  system_prompt: string | null
  capabilities: string | null
  tools: string | null
  constraints: string | null
  workspace_path: string | null
  addressable: number
}

function setupDb(): Db {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
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

const AGENTS = [
  {
    id: 'agent-1',
    name: 'Jarvis',
    role: 'primary-assistant',
    goal: 'Help with everything',
    backstory: 'My first agent',
    system_prompt: 'You are Jarvis.',
    capabilities: '["reasoning","planning"]',
    tools: '["search","code"]',
    constraints: '["no-harm"]',
    tier: 'primary',
  },
  {
    id: 'agent-2',
    name: 'Dev Helper',
    role: 'developer',
    goal: 'Write code',
    backstory: null,
    system_prompt: null,
    capabilities: null,
    tools: null,
    constraints: null,
    tier: 'specialist',
  },
  {
    id: 'agent-3',
    name: 'QA Bot',
    role: 'quality-assurance',
    goal: 'Test everything',
    backstory: 'Runs tests',
    system_prompt: 'You are a tester.',
    capabilities: '["test-execution"]',
    tools: null,
    constraints: '["dont-break-prod"]',
    tier: 'team',
  },
]

function insertAgents(db: Db): void {
  for (const a of AGENTS) {
    db.run(sql`INSERT INTO agent_definitions
      (id, name, role, goal, backstory, tier, system_prompt, capabilities, tools, constraints, created_at, updated_at)
      VALUES (
        ${a.id}, ${a.name}, ${a.role}, ${a.goal}, ${a.backstory ?? null}, ${a.tier},
        ${a.system_prompt ?? null}, ${a.capabilities ?? null}, ${a.tools ?? null}, ${a.constraints ?? null},
        '2026-01-01', '2026-01-01'
      )`)
  }
}

function mutateAgents(db: Db): void {
  // Simulate what the migration does: clear v1 cols, set workspace_path
  for (const a of AGENTS) {
    db.run(sql`UPDATE agent_definitions SET
      role = NULL, goal = NULL, backstory = NULL, system_prompt = NULL,
      capabilities = NULL, tools = NULL, constraints = NULL,
      workspace_path = ${'data/agents/' + a.id}, addressable = 1
    WHERE id = ${a.id}`)
  }
}

describe('restoreFromSnapshot', () => {
  let db: Db

  beforeEach(() => {
    db = setupDb()
  })

  it('throws if snapshot table does not exist', async () => {
    await expect(restoreFromSnapshot(db as never)).rejects.toThrow('agent_definitions_v1_snapshot table does not exist')
  })

  it('throws if snapshot table is empty', async () => {
    db.run(sql`CREATE TABLE agent_definitions_v1_snapshot (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, snapshot_at TEXT NOT NULL
    )`)
    await expect(restoreFromSnapshot(db as never)).rejects.toThrow('Snapshot table exists but contains no rows')
  })

  it('restores all v1 columns from snapshot and clears workspace_path / addressable', async () => {
    insertAgents(db)
    await snapshotV1AgentRows(db as never)
    mutateAgents(db)

    // Verify mutation is in place
    const mutated = db.all<AgentRow>(sql`SELECT * FROM agent_definitions WHERE id = 'agent-1'`)
    expect(mutated[0].system_prompt).toBeNull()
    expect(mutated[0].workspace_path).toBe('data/agents/agent-1')

    const count = await restoreFromSnapshot(db as never)
    expect(count).toBe(3)

    const rows = db.all<AgentRow>(sql`SELECT * FROM agent_definitions ORDER BY id`)

    // agent-1 (Jarvis) — all v1 data restored
    expect(rows[0].id).toBe('agent-1')
    expect(rows[0].role).toBe('primary-assistant')
    expect(rows[0].goal).toBe('Help with everything')
    expect(rows[0].backstory).toBe('My first agent')
    expect(rows[0].system_prompt).toBe('You are Jarvis.')
    expect(rows[0].capabilities).toBe('["reasoning","planning"]')
    expect(rows[0].tools).toBe('["search","code"]')
    expect(rows[0].constraints).toBe('["no-harm"]')
    expect(rows[0].workspace_path).toBeNull()
    expect(rows[0].addressable).toBe(0)

    // agent-2 (Dev Helper) — nulls preserved correctly
    expect(rows[1].id).toBe('agent-2')
    expect(rows[1].role).toBe('developer')
    expect(rows[1].system_prompt).toBeNull()
    expect(rows[1].workspace_path).toBeNull()
    expect(rows[1].addressable).toBe(0)

    // agent-3 (QA Bot) — mixed nulls
    expect(rows[2].id).toBe('agent-3')
    expect(rows[2].role).toBe('quality-assurance')
    expect(rows[2].system_prompt).toBe('You are a tester.')
    expect(rows[2].tools).toBeNull()
    expect(rows[2].workspace_path).toBeNull()
    expect(rows[2].addressable).toBe(0)
  })

  it('is idempotent — running restore twice leaves the same state', async () => {
    insertAgents(db)
    await snapshotV1AgentRows(db as never)
    mutateAgents(db)

    await restoreFromSnapshot(db as never)
    const count2 = await restoreFromSnapshot(db as never)
    expect(count2).toBe(3)

    const rows = db.all<AgentRow>(sql`SELECT * FROM agent_definitions ORDER BY id`)
    for (const row of rows) {
      expect(row.workspace_path).toBeNull()
      expect(row.addressable).toBe(0)
    }
  })
})
