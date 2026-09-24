import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createEfficiencyReporter } from '@modules/self-learning/efficiency-reporter'
import { createMemoryDb } from '../../helpers/test-db'

let db: ReturnType<typeof createMemoryDb>
let reporter: ReturnType<typeof createEfficiencyReporter>

function createTables(database: any) {
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
  database.run(sql`CREATE TABLE IF NOT EXISTS tool_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    tool_name TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  )`)
}

function recentDate(): string {
  return new Date().toISOString()
}

beforeEach(() => {
  db = createMemoryDb()
  createTables(db)
  reporter = createEfficiencyReporter(db)
})

describe('EfficiencyReporter', () => {
  it('returns empty report when no data', () => {
    const report = reporter.generate('weekly')
    expect(report.period).toBe('weekly')
    expect(report.totalTokens).toBe(0)
    expect(report.totalCostUsd).toBe(0)
    expect(report.totalSessions).toBe(0)
    expect(report.successRate).toBe(0)
    expect(report.avgTokensPerSession).toBe(0)
    expect(report.topAgents).toEqual([])
    expect(report.topTools).toEqual([])
    expect(report.insights).toEqual([])
    expect(report.generatedAt).toBeTruthy()
  })

  it('calculates correct session stats', () => {
    const now = recentDate()
    db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
      VALUES ('s1', 'agent-a', 'completed', 10000, 0.05, ${now})`)
    db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
      VALUES ('s2', 'agent-a', 'completed', 20000, 0.10, ${now})`)
    db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
      VALUES ('s3', 'agent-b', 'failed', 5000, 0.02, ${now})`)

    const report = reporter.generate('weekly')
    expect(report.totalSessions).toBe(3)
    expect(report.totalTokens).toBe(35000)
    expect(report.totalCostUsd).toBeCloseTo(0.17)
    expect(report.successRate).toBeCloseTo(2 / 3)
    expect(report.avgTokensPerSession).toBe(Math.round(35000 / 3))
  })

  it('ranks top agents by session count', () => {
    const now = recentDate()
    for (let i = 0; i < 5; i++) {
      db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
        VALUES (${`s-a-${i}`}, 'popular-agent', 'completed', 1000, 0.01, ${now})`)
    }
    for (let i = 0; i < 2; i++) {
      db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
        VALUES (${`s-b-${i}`}, 'rare-agent', 'completed', 1000, 0.01, ${now})`)
    }

    const report = reporter.generate('weekly')
    expect(report.topAgents).toHaveLength(2)
    expect(report.topAgents[0].agentId).toBe('popular-agent')
    expect(report.topAgents[0].sessions).toBe(5)
    expect(report.topAgents[0].successRate).toBe(1)
  })

  it('ranks top tools by call count', () => {
    const now = recentDate()
    for (let i = 0; i < 8; i++) {
      db.run(sql`INSERT INTO tool_executions (tool_name, success, duration_ms, created_at)
        VALUES ('hot_tool', ${i < 6 ? 1 : 0}, ${100 + i * 10}, ${now})`)
    }
    for (let i = 0; i < 3; i++) {
      db.run(sql`INSERT INTO tool_executions (tool_name, success, duration_ms, created_at)
        VALUES ('cold_tool', 1, 50, ${now})`)
    }

    const report = reporter.generate('weekly')
    expect(report.topTools).toHaveLength(2)
    expect(report.topTools[0].toolName).toBe('hot_tool')
    expect(report.topTools[0].calls).toBe(8)
    expect(report.topTools[0].errorRate).toBeCloseTo(2 / 8)
    expect(report.topTools[0].avgDurationMs).toBeGreaterThan(0)
  })

  it('uses correct time window for daily period', () => {
    const now = recentDate()
    const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString()

    db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
      VALUES ('s-recent', 'agent', 'completed', 1000, 0.01, ${now})`)
    db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
      VALUES ('s-old', 'agent', 'completed', 1000, 0.01, ${threeDaysAgo})`)

    const daily = reporter.generate('daily')
    expect(daily.period).toBe('daily')
    expect(daily.totalSessions).toBe(1)
  })

  it('uses correct time window for monthly period', () => {
    const now = recentDate()
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400_000).toISOString()

    db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
      VALUES ('s-recent', 'agent', 'completed', 1000, 0.01, ${now})`)
    db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
      VALUES ('s-older', 'agent', 'completed', 2000, 0.02, ${twoWeeksAgo})`)

    const weekly = reporter.generate('weekly')
    expect(weekly.totalSessions).toBe(1) // Only recent

    const monthly = reporter.generate('monthly')
    expect(monthly.totalSessions).toBe(2) // Both
  })

  it('limits top agents to 5', () => {
    const now = recentDate()
    for (let a = 0; a < 8; a++) {
      db.run(sql`INSERT INTO agent_sessions (id, agent_id, status, tokens_used, cost_usd, started_at)
        VALUES (${`s-${a}`}, ${`agent-${a}`}, 'completed', 1000, 0.01, ${now})`)
    }

    const report = reporter.generate('weekly')
    expect(report.topAgents.length).toBeLessThanOrEqual(5)
  })

  it('limits top tools to 10', () => {
    const now = recentDate()
    for (let t = 0; t < 15; t++) {
      db.run(sql`INSERT INTO tool_executions (tool_name, success, duration_ms, created_at)
        VALUES (${`tool-${t}`}, 1, 100, ${now})`)
    }

    const report = reporter.generate('weekly')
    expect(report.topTools.length).toBeLessThanOrEqual(10)
  })
})
