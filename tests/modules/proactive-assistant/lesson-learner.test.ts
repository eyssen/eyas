import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createLessonLearner } from '@modules/proactive-assistant/lesson-learner'
import { createMemoryDb } from '../../helpers/test-db'

let db: ReturnType<typeof createMemoryDb>
let learner: ReturnType<typeof createLessonLearner>

function createTables(database: any) {
  database.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    goal_description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
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
  learner = createLessonLearner(db)
})

describe('LessonLearner', () => {
  it('returns empty lessons when no data', () => {
    const lessons = learner.analyze(7)
    expect(lessons).toEqual([])
  })

  it('detects recurring tool usage patterns in completed conversations', () => {
    const now = recentDate()
    // Create closed conversations with goals
    for (let i = 0; i < 4; i++) {
      db.run(sql`INSERT INTO conversations (id, title, status, goal_description, created_at, updated_at)
        VALUES (${`conv-${i}`}, ${`Conv ${i}`}, 'idle', ${`Deploy service ${i}`}, ${now}, ${now})`)
      db.run(sql`INSERT INTO tool_executions (conversation_id, tool_name, success, created_at)
        VALUES (${`conv-${i}`}, 'deploy_tool', 1, ${now})`)
    }

    const lessons = learner.analyze(7)
    expect(lessons.length).toBeGreaterThanOrEqual(1)

    const deployLesson = lessons.find(l => l.pattern.includes('deploy_tool'))
    expect(deployLesson).toBeDefined()
    expect(deployLesson!.frequency).toBe(4)
    expect(deployLesson!.solution).toBeTruthy()
    expect(deployLesson!.savedToMemory).toBe(false)
  })

  it('ignores tool usage in non-closed conversations', () => {
    const now = recentDate()
    for (let i = 0; i < 5; i++) {
      db.run(sql`INSERT INTO conversations (id, title, status, goal_description, created_at, updated_at)
        VALUES (${`conv-${i}`}, ${`Conv ${i}`}, 'working', 'Some goal', ${now}, ${now})`)
      db.run(sql`INSERT INTO tool_executions (conversation_id, tool_name, success, created_at)
        VALUES (${`conv-${i}`}, 'active_tool', 1, ${now})`)
    }

    const lessons = learner.analyze(7)
    expect(lessons.find(l => l.pattern.includes('active_tool'))).toBeUndefined()
  })

  it('ignores failed tool executions', () => {
    const now = recentDate()
    for (let i = 0; i < 5; i++) {
      db.run(sql`INSERT INTO conversations (id, title, status, goal_description, created_at, updated_at)
        VALUES (${`conv-${i}`}, ${`Conv ${i}`}, 'idle', 'Some goal', ${now}, ${now})`)
      db.run(sql`INSERT INTO tool_executions (conversation_id, tool_name, success, created_at)
        VALUES (${`conv-${i}`}, 'failing_tool', 0, ${now})`)
    }

    const lessons = learner.analyze(7)
    expect(lessons.find(l => l.pattern.includes('failing_tool'))).toBeUndefined()
  })

  it('requires at least 3 occurrences to generate a lesson', () => {
    const now = recentDate()
    for (let i = 0; i < 2; i++) {
      db.run(sql`INSERT INTO conversations (id, title, status, goal_description, created_at, updated_at)
        VALUES (${`conv-${i}`}, ${`Conv ${i}`}, 'idle', 'Goal', ${now}, ${now})`)
      db.run(sql`INSERT INTO tool_executions (conversation_id, tool_name, success, created_at)
        VALUES (${`conv-${i}`}, 'rare_tool', 1, ${now})`)
    }

    const lessons = learner.analyze(7)
    expect(lessons.find(l => l.pattern.includes('rare_tool'))).toBeUndefined()
  })

  it('respects daysBack parameter', () => {
    const old = new Date(Date.now() - 10 * 86400_000).toISOString()
    for (let i = 0; i < 5; i++) {
      db.run(sql`INSERT INTO conversations (id, title, status, goal_description, created_at, updated_at)
        VALUES (${`conv-${i}`}, ${`Conv ${i}`}, 'idle', 'Goal', ${old}, ${old})`)
      db.run(sql`INSERT INTO tool_executions (conversation_id, tool_name, success, created_at)
        VALUES (${`conv-${i}`}, 'old_tool', 1, ${old})`)
    }

    const lessons7 = learner.analyze(7)
    expect(lessons7.find(l => l.pattern.includes('old_tool'))).toBeUndefined()

    const lessons14 = learner.analyze(14)
    expect(lessons14.find(l => l.pattern.includes('old_tool'))).toBeDefined()
  })

  it('includes conversation goals in solution field', () => {
    const now = recentDate()
    for (let i = 0; i < 3; i++) {
      db.run(sql`INSERT INTO conversations (id, title, status, goal_description, created_at, updated_at)
        VALUES (${`conv-${i}`}, ${`Conv ${i}`}, 'idle', ${`Deploy version ${i}`}, ${now}, ${now})`)
      db.run(sql`INSERT INTO tool_executions (conversation_id, tool_name, success, created_at)
        VALUES (${`conv-${i}`}, 'deploy_cmd', 1, ${now})`)
    }

    const lessons = learner.analyze(7)
    const lesson = lessons.find(l => l.pattern.includes('deploy_cmd'))!
    expect(lesson.solution).toContain('Goals:')
  })

  it('ignores conversations without goal_description', () => {
    const now = recentDate()
    for (let i = 0; i < 5; i++) {
      db.run(sql`INSERT INTO conversations (id, title, status, goal_description, created_at, updated_at)
        VALUES (${`conv-${i}`}, ${`Conv ${i}`}, 'idle', ${null}, ${now}, ${now})`)
      db.run(sql`INSERT INTO tool_executions (conversation_id, tool_name, success, created_at)
        VALUES (${`conv-${i}`}, 'nogoal_tool', 1, ${now})`)
    }

    const lessons = learner.analyze(7)
    expect(lessons.find(l => l.pattern.includes('nogoal_tool'))).toBeUndefined()
  })

  it('considers archived conversations as closed', () => {
    const now = recentDate()
    for (let i = 0; i < 4; i++) {
      db.run(sql`INSERT INTO conversations (id, title, status, goal_description, created_at, updated_at)
        VALUES (${`conv-${i}`}, ${`Conv ${i}`}, 'archived', 'Archived goal', ${now}, ${now})`)
      db.run(sql`INSERT INTO tool_executions (conversation_id, tool_name, success, created_at)
        VALUES (${`conv-${i}`}, 'archive_tool', 1, ${now})`)
    }

    const lessons = learner.analyze(7)
    expect(lessons.find(l => l.pattern.includes('archive_tool'))).toBeDefined()
  })
})
