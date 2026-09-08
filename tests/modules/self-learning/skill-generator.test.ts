import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createSkillGenerator } from '@modules/self-learning/skill-generator'
import { createMemoryDb } from '../../helpers/test-db'

let db: ReturnType<typeof createMemoryDb>
let generator: ReturnType<typeof createSkillGenerator>

function createTables(database: any) {
  // The skill-generator queries conversations table for goal_description
  database.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    goal_description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)
}

function recentDate(): string {
  return new Date().toISOString()
}

beforeEach(() => {
  db = createMemoryDb()
  createTables(db)
  generator = createSkillGenerator(db)
})

describe('SkillGenerator', () => {
  it('returns empty suggestions when no data', () => {
    const suggestions = generator.suggest(30)
    expect(suggestions).toEqual([])
  })

  it('suggests skills for recurring conversation goals', () => {
    const now = recentDate()
    // Same goal 5 times
    for (let i = 0; i < 5; i++) {
      db.run(sql`INSERT INTO conversations (id, goal_description, status, created_at, updated_at)
        VALUES (${`conv-${i}`}, 'Deploy to production', 'idle', ${now}, ${now})`)
    }

    const suggestions = generator.suggest(30)
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].name).toContain('auto-')
    expect(suggestions[0].name).toContain('deploy')
    expect(suggestions[0].description).toContain('Deploy to production')
    expect(suggestions[0].triggerPatterns).toContain('deploy to production')
    expect(suggestions[0].basedOnTasks).toBe(5)
    expect(suggestions[0].confidence).toBe(0.5) // 5/10
  })

  it('ignores goals with fewer than 3 occurrences', () => {
    const now = recentDate()
    for (let i = 0; i < 2; i++) {
      db.run(sql`INSERT INTO conversations (id, goal_description, status, created_at, updated_at)
        VALUES (${`conv-${i}`}, 'Rare task', 'idle', ${now}, ${now})`)
    }

    const suggestions = generator.suggest(30)
    expect(suggestions).toHaveLength(0)
  })

  it('ignores conversations without goal_description', () => {
    const now = recentDate()
    for (let i = 0; i < 5; i++) {
      db.run(sql`INSERT INTO conversations (id, goal_description, status, created_at, updated_at)
        VALUES (${`conv-${i}`}, ${null}, 'idle', ${now}, ${now})`)
    }

    const suggestions = generator.suggest(30)
    expect(suggestions).toHaveLength(0)
  })

  it('limits suggestions to top 5', () => {
    const now = recentDate()
    // Create 7 different goals, each with 5 occurrences
    for (let g = 0; g < 7; g++) {
      for (let i = 0; i < 5; i++) {
        db.run(sql`INSERT INTO conversations (id, goal_description, status, created_at, updated_at)
          VALUES (${`conv-${g}-${i}`}, ${`Goal number ${g}`}, 'idle', ${now}, ${now})`)
      }
    }

    const suggestions = generator.suggest(30)
    expect(suggestions.length).toBeLessThanOrEqual(5)
  })

  it('respects daysBack parameter', () => {
    const old = new Date(Date.now() - 40 * 86400_000).toISOString()
    for (let i = 0; i < 5; i++) {
      db.run(sql`INSERT INTO conversations (id, goal_description, status, created_at, updated_at)
        VALUES (${`conv-${i}`}, 'Old task', 'idle', ${old}, ${old})`)
    }

    const suggestions30 = generator.suggest(30)
    expect(suggestions30).toHaveLength(0)

    const suggestions60 = generator.suggest(60)
    expect(suggestions60).toHaveLength(1)
  })

  it('confidence caps at 1.0', () => {
    const now = recentDate()
    for (let i = 0; i < 15; i++) {
      db.run(sql`INSERT INTO conversations (id, goal_description, status, created_at, updated_at)
        VALUES (${`conv-${i}`}, 'Very common task', 'idle', ${now}, ${now})`)
    }

    const suggestions = generator.suggest(30)
    expect(suggestions[0].confidence).toBe(1) // 15/10 capped at 1
  })

  it('generates kebab-case name from goal description', () => {
    const now = recentDate()
    for (let i = 0; i < 3; i++) {
      db.run(sql`INSERT INTO conversations (id, goal_description, status, created_at, updated_at)
        VALUES (${`conv-${i}`}, 'Run database migration scripts', 'idle', ${now}, ${now})`)
    }

    const suggestions = generator.suggest(30)
    expect(suggestions[0].name).toMatch(/^auto-[a-z-]+$/)
  })
})
