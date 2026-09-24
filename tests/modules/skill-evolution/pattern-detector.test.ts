import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createPatternDetector } from '@modules/skill-evolution/pattern-detector'
import type { EvolutionConfig } from '@modules/skill-evolution/types'

function setupConversationsTable(db: any) {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `)
}

function insertConversation(db: any, id: string, title: string, tokensUsed = 100, createdAt?: string) {
  const ts = createdAt ?? new Date().toISOString()
  db.run(sql`INSERT INTO conversations (id, title, tokens_used, created_at) VALUES (${id}, ${title}, ${tokensUsed}, ${ts})`)
}

const defaultConfig: EvolutionConfig = {
  minSessionsForPattern: 3,
  minConfidence: 0.1,
  analysisWindowDays: 30,
  autoApproveThreshold: 0.9,
}

describe('PatternDetector', () => {
  let db: any
  let detector: ReturnType<typeof createPatternDetector>

  beforeEach(() => {
    db = createMemoryDb()
    setupConversationsTable(db)
    detector = createPatternDetector(db, defaultConfig)
  })

  it('returns empty array when no conversations exist', () => {
    const patterns = detector.detect()
    expect(patterns).toHaveLength(0)
  })

  it('detects a recurring pattern with enough occurrences', () => {
    for (let i = 0; i < 5; i++) {
      insertConversation(db, `id-${i}`, 'Deploy to production', 200)
    }
    const patterns = detector.detect()
    expect(patterns).toHaveLength(1)
    expect(patterns[0].title).toBe('Deploy to production')
    expect(patterns[0].occurrences).toBe(5)
  })

  it('ignores patterns below minSessionsForPattern', () => {
    // Only 2 occurrences, threshold is 3
    insertConversation(db, 'a', 'Rare task', 100)
    insertConversation(db, 'b', 'Rare task', 100)
    const patterns = detector.detect()
    expect(patterns).toHaveLength(0)
  })

  it('calculates confidence as min(count/10, 1)', () => {
    for (let i = 0; i < 5; i++) {
      insertConversation(db, `c-${i}`, 'Medium task')
    }
    const patterns = detector.detect()
    expect(patterns[0].confidence).toBeCloseTo(0.5)

    // Add 5 more → confidence should cap at 1
    for (let i = 5; i < 15; i++) {
      insertConversation(db, `c-${i}`, 'Medium task')
    }
    const patterns2 = createPatternDetector(db, defaultConfig).detect()
    const p = patterns2.find((x) => x.title === 'Medium task')!
    expect(p.confidence).toBe(1)
  })

  it('filters out patterns below minConfidence', () => {
    const strictConfig: EvolutionConfig = { ...defaultConfig, minConfidence: 0.5 }
    const strictDetector = createPatternDetector(db, strictConfig)

    // 3 occurrences = confidence 0.3, below 0.5
    for (let i = 0; i < 3; i++) {
      insertConversation(db, `low-${i}`, 'Low confidence task')
    }
    const patterns = strictDetector.detect()
    expect(patterns).toHaveLength(0)
  })

  it('calculates average tokens correctly', () => {
    insertConversation(db, 'x1', 'Token test', 100)
    insertConversation(db, 'x2', 'Token test', 200)
    insertConversation(db, 'x3', 'Token test', 300)
    const patterns = detector.detect()
    expect(patterns[0].avgTokens).toBe(200)
  })

  it('returns sample conversation ids', () => {
    for (let i = 0; i < 4; i++) {
      insertConversation(db, `sample-${i}`, 'Sample pattern')
    }
    const patterns = detector.detect()
    expect(patterns[0].sampleConversationIds.length).toBeGreaterThan(0)
    expect(patterns[0].sampleConversationIds.length).toBeLessThanOrEqual(5)
  })

  it('ignores conversations outside the analysis window', () => {
    const old = new Date(Date.now() - 60 * 86400_000).toISOString() // 60 days ago
    for (let i = 0; i < 5; i++) {
      insertConversation(db, `old-${i}`, 'Old task', 100, old)
    }
    const patterns = detector.detect()
    expect(patterns).toHaveLength(0)
  })

  it('ignores conversations with null or empty titles', () => {
    db.run(sql`INSERT INTO conversations (id, title, tokens_used, created_at) VALUES ('null-1', NULL, 100, ${new Date().toISOString()})`)
    db.run(sql`INSERT INTO conversations (id, title, tokens_used, created_at) VALUES ('empty-1', '', 100, ${new Date().toISOString()})`)
    db.run(sql`INSERT INTO conversations (id, title, tokens_used, created_at) VALUES ('null-2', NULL, 100, ${new Date().toISOString()})`)
    db.run(sql`INSERT INTO conversations (id, title, tokens_used, created_at) VALUES ('empty-2', '', 100, ${new Date().toISOString()})`)
    db.run(sql`INSERT INTO conversations (id, title, tokens_used, created_at) VALUES ('null-3', NULL, 100, ${new Date().toISOString()})`)
    const patterns = detector.detect()
    expect(patterns).toHaveLength(0)
  })

  it('detects multiple distinct patterns', () => {
    for (let i = 0; i < 4; i++) insertConversation(db, `p1-${i}`, 'Pattern A')
    for (let i = 0; i < 6; i++) insertConversation(db, `p2-${i}`, 'Pattern B')
    const patterns = detector.detect()
    expect(patterns.length).toBe(2)
    const titles = patterns.map((p) => p.title)
    expect(titles).toContain('Pattern A')
    expect(titles).toContain('Pattern B')
  })
})
