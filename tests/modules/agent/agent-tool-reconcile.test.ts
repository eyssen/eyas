// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { reconcileAgentTools, type ToolsetUpgrade } from '@modules/agent/agent-tool-reconcile'
import { PRIOR_TOOLSETS } from '@modules/agent/agent-templates'

let db: any

const PRIOR = ['read_file', 'write_file', 'grep']
const CURRENT = ['read_file', 'write_file', 'grep', 'design_read']
const UPGRADES: ToolsetUpgrade[] = [{ prior: PRIOR, current: CURRENT }]

function seedAgent(id: string, name: string, tools: string[], source = 'seed') {
  db.run(sql`INSERT INTO agent_definitions (id, name, tools, source, created_at, updated_at)
    VALUES (${id}, ${name}, ${JSON.stringify(tools)}, ${source}, datetime('now'), datetime('now'))`)
}
function toolsOf(id: string): string[] {
  const row = (db.all(sql`SELECT tools FROM agent_definitions WHERE id = ${id}`) as any[])[0]
  return JSON.parse(row.tools)
}

beforeEach(() => {
  db = createMemoryDb()
  db.run(sql`CREATE TABLE agent_definitions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, tools TEXT, source TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
})

describe('reconcileAgentTools', () => {
  it('upgrades an agent still carrying a previously shipped list', () => {
    seedAgent('a1', 'Jarvis', PRIOR)
    expect(reconcileAgentTools(db, UPGRADES)).toBe(1)
    expect(toolsOf('a1')).toEqual(CURRENT)
  })

  it('matches as a SET, so a reordered list still upgrades', () => {
    seedAgent('a1', 'Jarvis', ['grep', 'read_file', 'write_file'])
    expect(reconcileAgentTools(db, UPGRADES)).toBe(1)
    expect(toolsOf('a1')).toContain('design_read')
  })

  it('leaves an edited list alone — that was somebody deciding', () => {
    seedAgent('a1', 'Jarvis', ['read_file', 'grep'])
    expect(reconcileAgentTools(db, UPGRADES)).toBe(0)
    expect(toolsOf('a1')).toEqual(['read_file', 'grep'])
  })

  it('leaves an already-upgraded agent alone, so it is idempotent', () => {
    seedAgent('a1', 'Jarvis', CURRENT)
    expect(reconcileAgentTools(db, UPGRADES)).toBe(0)
    reconcileAgentTools(db, UPGRADES)
    expect(toolsOf('a1')).toEqual(CURRENT)
  })

  it('never touches an agent the operator created', () => {
    seedAgent('a1', 'Mine', PRIOR, 'user')
    expect(reconcileAgentTools(db, UPGRADES)).toBe(0)
  })

  it('survives an unparseable tools column', () => {
    db.run(sql`INSERT INTO agent_definitions (id, name, tools, source, created_at, updated_at)
      VALUES ('a1', 'Broken', 'not json', 'seed', datetime('now'), datetime('now'))`)
    expect(() => reconcileAgentTools(db, UPGRADES)).not.toThrow()
  })

  it('never throws when the table is not there at all', () => {
    const empty = createMemoryDb()
    expect(reconcileAgentTools(empty, UPGRADES)).toBe(0)
  })
})

describe('the shipped upgrade table', () => {
  it('offers an upgrade for every template that gained a design tool', () => {
    expect(PRIOR_TOOLSETS.length).toBeGreaterThan(0)
    for (const u of PRIOR_TOOLSETS) {
      expect(u.current.length).toBeGreaterThan(u.prior.length)
      expect(u.current.some((t) => t.startsWith('design_') || t === 'render_html_document')).toBe(true)
    }
  })

  it('would actually upgrade the primary assistant', () => {
    // The concrete case: the agent that gets asked to make things.
    const primary = PRIOR_TOOLSETS.find((u) => u.prior.includes('run_command') && u.prior.includes('create_page'))
    expect(primary).toBeDefined()
    seedAgent('a1', 'Jarvis', [...primary!.prior])
    expect(reconcileAgentTools(db, PRIOR_TOOLSETS)).toBe(1)
    expect(toolsOf('a1')).toContain('design_read')
  })
})
