// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Helper: seeds a v1-shape agent_definitions table with all 16 agent templates
// for migration roundtrip tests. Mirrors the structure that existed before
// the v1→v2 workspace migration.

import { sql } from 'drizzle-orm'
import { ALL_TEMPLATES } from '@modules/agent/agent-templates.js'

export interface SeedV1Options {
  agents?: Array<{
    id: string
    name: string
    tier: 'primary' | 'team' | 'specialist'
    role?: string
    goal?: string
    backstory?: string
    systemPrompt?: string
    capabilities?: string[]
    tools?: string[]
    constraints?: string[]
  }>
}

/**
 * Creates agent_definitions and v1 snapshot tables, then inserts v1-format
 * rows for testing. If no agents are passed, seeds all 16 default templates.
 */
export function seedV1Agents(db: ReturnType<typeof import('drizzle-orm/bun-sqlite').drizzle>, opts: SeedV1Options = {}): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_definitions (
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

  db.run(sql`CREATE TABLE IF NOT EXISTS agent_definitions_v1_snapshot (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    snapshot_at TEXT NOT NULL
  )`)

  const agents = opts.agents ?? ALL_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    tier: t.tier as 'primary' | 'team' | 'specialist',
    role: t.role,
    goal: t.goal,
    backstory: t.backstory,
    systemPrompt: t.systemPrompt,
    capabilities: t.capabilities,
    tools: t.tools,
    constraints: t.constraints,
  }))

  const now = new Date().toISOString()

  for (const a of agents) {
    db.run(sql`INSERT OR IGNORE INTO agent_definitions
      (id, name, role, goal, backstory, tier, system_prompt, capabilities, tools, constraints, created_at, updated_at)
      VALUES (
        ${a.id}, ${a.name}, ${a.role ?? null}, ${a.goal ?? null}, ${a.backstory ?? null},
        ${a.tier}, ${a.systemPrompt ?? null},
        ${a.capabilities ? JSON.stringify(a.capabilities) : null},
        ${a.tools ? JSON.stringify(a.tools) : null},
        ${a.constraints ? JSON.stringify(a.constraints) : null},
        ${now}, ${now}
      )`)
  }
}

/** Simulate what the migration does: clear v1 cols, set workspace_path + addressable */
export function simulateMigration(db: ReturnType<typeof import('drizzle-orm/bun-sqlite').drizzle>, dataDir: string): void {
  const rows = db.all<{ id: string; tier: string }>(sql`SELECT id, tier FROM agent_definitions`)
  for (const row of rows) {
    const addressable = row.tier === 'primary' || row.tier === 'team' ? 1 : 0
    db.run(sql`UPDATE agent_definitions SET
      role = NULL, goal = NULL, backstory = NULL, system_prompt = NULL,
      capabilities = NULL, tools = NULL, constraints = NULL,
      workspace_path = ${`${dataDir}/agents/${row.id}`},
      addressable = ${addressable}
    WHERE id = ${row.id}`)
  }
}
