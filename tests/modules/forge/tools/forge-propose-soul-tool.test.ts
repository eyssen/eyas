// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it, beforeEach } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createForgeProposeSoulTool } from '../../../../src/modules/forge/tools/forge-propose-soul-tool.js'

interface ForgeProposalRow {
  id: string
  target: string
  target_id: string
  scope: string
  field: string | null
  title: string
  description: string
  current_value: string
  proposed_value: string
  reasoning: string
  confidence: number
  based_on_feedbacks: number
  status: string
  created_at: string
}

function setupDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  db.run(sql`CREATE TABLE forge_proposals (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL CHECK (target IN ('skill', 'tool', 'soul', 'project_rule')),
    target_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    field TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    current_value TEXT NOT NULL,
    proposed_value TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    based_on_feedbacks INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    experiment_id TEXT,
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  )`)
  return db
}

describe('forge_propose_soul_change tool', () => {
  let db: ReturnType<typeof setupDb>

  beforeEach(() => {
    db = setupDb()
  })

  it('creates a forge_proposals row with target=soul and the agent id', async () => {
    const tool = createForgeProposeSoulTool({ db: db as never })

    const result = await tool.invoke('jarvis', {
      scope: 'external',
      field: 'tone',
      currentValue: 'kiegyensúlyozott',
      proposedValue: 'baráti',
      reasoning: 'Multiple users requested a friendlier tone after the last release feedback round.',
      evidenceCount: 5,
    })

    expect(result.ok).toBe(true)
    expect(result.proposalId).toMatch(/^fp_/)

    const rows = db.all<ForgeProposalRow>(sql`SELECT * FROM forge_proposals WHERE id = ${result.proposalId}`)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.target).toBe('soul')
    expect(row.target_id).toBe('jarvis')
    expect(row.scope).toBe('external')
    expect(row.field).toBe('tone')
    expect(row.title).toBe('Update external.tone')
    expect(row.status).toBe('pending')
    expect(JSON.parse(row.current_value)).toBe('kiegyensúlyozott')
    expect(JSON.parse(row.proposed_value)).toBe('baráti')
    expect(row.based_on_feedbacks).toBe(5)
  })

  it('rejects input with reasoning shorter than 50 characters', () => {
    const tool = createForgeProposeSoulTool({ db: db as never })
    expect(() =>
      tool.inputSchema.parse({
        scope: 'internal',
        field: 'humor',
        currentValue: 'nincs',
        proposedValue: 'száraz/szellemes',
        reasoning: 'too short',
        evidenceCount: 1,
      }),
    ).toThrow()
  })

  it('caps confidence at 1.0 when evidenceCount exceeds 10', async () => {
    const tool = createForgeProposeSoulTool({ db: db as never })

    const lowResult = await tool.invoke('jarvis', {
      scope: 'internal',
      field: 'verbosity',
      currentValue: 'lényegre törő',
      proposedValue: 'kiegyensúlyozott',
      reasoning: 'Three users mentioned that responses feel terse in casual conversations across multiple sessions.',
      evidenceCount: 3,
    })
    const highResult = await tool.invoke('jarvis', {
      scope: 'internal',
      field: 'verbosity',
      currentValue: 'lényegre törő',
      proposedValue: 'részletező',
      reasoning: 'Many users requested more detailed answers when asked technical questions about the system architecture.',
      evidenceCount: 25,
    })

    const lowRow = db.all<ForgeProposalRow>(sql`SELECT confidence FROM forge_proposals WHERE id = ${lowResult.proposalId}`)[0]
    const highRow = db.all<ForgeProposalRow>(sql`SELECT confidence FROM forge_proposals WHERE id = ${highResult.proposalId}`)[0]
    expect(lowRow.confidence).toBeCloseTo(0.3, 5)
    expect(highRow.confidence).toBe(1)
  })
})
