import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createActivityAnalyzer } from '@modules/self-learning/activity-analyzer'
import { createMemoryDb } from '../../helpers/test-db'

let db: ReturnType<typeof createMemoryDb>
let analyzer: ReturnType<typeof createActivityAnalyzer>

function createTables(database: any) {
  database.run(sql`CREATE TABLE IF NOT EXISTS tool_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    tool_name TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  )`)
  database.run(sql`CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    conversation_id TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    tokens_used INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT
  )`)
}

function recentDate(hoursAgo: number = 0): string {
  return new Date(Date.now() - hoursAgo * 3600_000).toISOString()
}

beforeEach(() => {
  db = createMemoryDb()
  createTables(db)
  analyzer = createActivityAnalyzer(db)
})

describe('ActivityAnalyzer', () => {
  it('returns empty patterns when no data', () => {
    const patterns = analyzer.analyze(7)
    expect(patterns).toEqual([])
  })

  it('detects high failure rate tool patterns', () => {
    const now = recentDate(0)
    // Insert 10 tool executions, 8 failures
    for (let i = 0; i < 10; i++) {
      db.run(sql`INSERT INTO tool_executions (tool_name, success, created_at)
        VALUES ('broken_tool', ${i < 2 ? 1 : 0}, ${now})`)
    }

    const patterns = analyzer.analyze(7)
    expect(patterns.length).toBeGreaterThanOrEqual(1)

    const errorPattern = patterns.find(p => p.type === 'error_pattern' && p.description.includes('broken_tool'))
    expect(errorPattern).toBeDefined()
    expect(errorPattern!.description).toContain('80%')
    expect(errorPattern!.frequency).toBe(10)
    expect(errorPattern!.suggestion).toBeTruthy()
  })

  it('does not flag tools with low failure rate', () => {
    const now = recentDate(0)
    // Insert 10 tool executions, only 2 failures (20%)
    for (let i = 0; i < 10; i++) {
      db.run(sql`INSERT INTO tool_executions (tool_name, success, created_at)
        VALUES ('good_tool', ${i < 8 ? 1 : 0}, ${now})`)
    }

    const patterns = analyzer.analyze(7)
    const errorPattern = patterns.find(p => p.description.includes('good_tool'))
    expect(errorPattern).toBeUndefined()
  })

  it('ignores tools with fewer than 5 executions', () => {
    const now = recentDate(0)
    for (let i = 0; i < 3; i++) {
      db.run(sql`INSERT INTO tool_executions (tool_name, success, created_at)
        VALUES ('rare_tool', 0, ${now})`)
    }

    const patterns = analyzer.analyze(7)
    expect(patterns.find(p => p.description.includes('rare_tool'))).toBeUndefined()
  })

  it('detects low agent success rate', () => {
    const now = recentDate(0)
    // 6 sessions, only 2 completed
    for (let i = 0; i < 6; i++) {
      const status = i < 2 ? 'completed' : 'failed'
      db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, started_at)
        VALUES (${`sess-${i}`}, 'test-agent', ${status}, 5000, ${now})`)
    }

    const patterns = analyzer.analyze(7)
    const agentPattern = patterns.find(p => p.type === 'error_pattern' && p.description.includes('test-agent'))
    expect(agentPattern).toBeDefined()
    expect(agentPattern!.description).toContain('33%')
  })

  it('detects cost anomaly for high token usage', () => {
    const now = recentDate(0)
    // 3 sessions with very high token usage
    for (let i = 0; i < 3; i++) {
      db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, started_at)
        VALUES (${`sess-${i}`}, 'expensive-agent', 'completed', 80000, ${now})`)
    }

    const patterns = analyzer.analyze(7)
    const costPattern = patterns.find(p => p.type === 'cost_anomaly' && p.description.includes('expensive-agent'))
    expect(costPattern).toBeDefined()
    expect(costPattern!.description).toContain('80000')
    expect(costPattern!.suggestion).toContain('cheaper model')
  })

  it('does not flag agents with normal token usage', () => {
    const now = recentDate(0)
    for (let i = 0; i < 3; i++) {
      db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, started_at)
        VALUES (${`sess-${i}`}, 'normal-agent', 'completed', 5000, ${now})`)
    }

    const patterns = analyzer.analyze(7)
    const costPattern = patterns.find(p => p.type === 'cost_anomaly' && p.description.includes('normal-agent'))
    expect(costPattern).toBeUndefined()
  })

  it('respects daysBack parameter', () => {
    // Old data (10 days ago)
    const old = new Date(Date.now() - 10 * 86400_000).toISOString()
    for (let i = 0; i < 10; i++) {
      db.run(sql`INSERT INTO tool_executions (tool_name, success, created_at)
        VALUES ('old_tool', 0, ${old})`)
    }

    // Should not find anything within 7 days
    const patterns = analyzer.analyze(7)
    expect(patterns.find(p => p.description.includes('old_tool'))).toBeUndefined()

    // Should find it within 14 days
    const patternsWide = analyzer.analyze(14)
    expect(patternsWide.find(p => p.description.includes('old_tool'))).toBeDefined()
  })

  it('does not throw on a non-finite daysBack (NaN falls back to default)', () => {
    // A NaN daysBack would otherwise make `new Date(... NaN ...)` throw RangeError.
    expect(() => analyzer.analyze(NaN as unknown as number)).not.toThrow()
    expect(analyzer.analyze(NaN as unknown as number)).toEqual([])
  })

  it('ignores agents with fewer than 3 sessions', () => {
    const now = recentDate(0)
    for (let i = 0; i < 2; i++) {
      db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, started_at)
        VALUES (${`sess-${i}`}, 'rare-agent', 'failed', 100000, ${now})`)
    }

    const patterns = analyzer.analyze(7)
    expect(patterns.find(p => p.description.includes('rare-agent'))).toBeUndefined()
  })
})
