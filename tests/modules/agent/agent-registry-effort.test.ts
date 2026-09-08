// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createAgentRegistry } from '@modules/agent/agent-registry'

function makeDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  db.run(sql`CREATE TABLE agent_definitions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT, description TEXT,
    goal TEXT, backstory TEXT,
    tier TEXT NOT NULL DEFAULT 'specialist', agent_type TEXT NOT NULL DEFAULT 'assistant',
    system_prompt TEXT, capabilities TEXT, tools TEXT, constraints TEXT,
    model TEXT, max_turns INTEGER, effort TEXT,
    enabled INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'seed',
    avatar TEXT, tags TEXT,
    monthly_token_budget INTEGER DEFAULT 0, tokens_used_month INTEGER DEFAULT 0,
    budget_reset_at TEXT, config TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  return db
}

const baseInput = {
  id: 'dev',
  name: 'Dev',
  role: 'developer',
  description: 'writes code',
  systemPrompt: 'You write code',
  capabilities: [],
  tools: [],
  constraints: [],
}

describe('agent registry — per-agent effort', () => {
  let registry: ReturnType<typeof createAgentRegistry>

  beforeEach(() => {
    registry = createAgentRegistry(makeDb())
  })

  it('persists effort on create and returns it on read', () => {
    registry.create({ ...baseInput, effort: 'high' } as any)
    expect(registry.get('dev')?.effort).toBe('high')
    expect(registry.list()[0].effort).toBe('high')
  })

  it('defaults to undefined (= auto) when not set', () => {
    registry.create(baseInput as any)
    expect(registry.get('dev')?.effort).toBeUndefined()
  })

  it('update can set and clear effort', () => {
    registry.create(baseInput as any)
    registry.update('dev', { effort: 'max' } as any)
    expect(registry.get('dev')?.effort).toBe('max')
    registry.update('dev', { effort: null } as any)
    expect(registry.get('dev')?.effort).toBeUndefined()
  })
})
