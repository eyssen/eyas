import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createApprovalStore } from '@modules/skill-evolution/approval-store'

function setupTable(db: any) {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS skill_candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      trigger_patterns TEXT NOT NULL DEFAULT '[]',
      content TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      based_on_sessions INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    )
  `)
}

const sampleInput = {
  name: 'Deploy to production',
  description: 'Handle production deployment tasks',
  triggerPatterns: ['deploy', 'release', 'production'],
  content: '---\nid: deploy\n---\n# Deploy',
  reasoning: 'Appeared 5 times in the last 30 days',
  confidence: 0.5,
  basedOnSessions: 5,
}

describe('ApprovalStore', () => {
  let db: any
  let store: ReturnType<typeof createApprovalStore>

  beforeEach(() => {
    db = createMemoryDb()
    setupTable(db)
    store = createApprovalStore(db)
  })

  it('adds a new candidate with pending status', () => {
    const candidate = store.add(sampleInput)
    expect(candidate.id).toBeTruthy()
    expect(candidate.name).toBe('Deploy to production')
    expect(candidate.status).toBe('pending')
    expect(candidate.triggerPatterns).toEqual(['deploy', 'release', 'production'])
    expect(candidate.createdAt).toBeTruthy()
    expect(candidate.reviewedAt).toBeUndefined()
  })

  it('gets a candidate by id', () => {
    const added = store.add(sampleInput)
    const found = store.get(added.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(added.id)
    expect(found!.name).toBe('Deploy to production')
  })

  it('returns undefined for non-existent id', () => {
    const result = store.get('nonexistent-id')
    expect(result).toBeUndefined()
  })

  it('lists all candidates', () => {
    store.add(sampleInput)
    store.add({ ...sampleInput, name: 'Code review' })
    const list = store.list()
    expect(list).toHaveLength(2)
  })

  it('lists candidates filtered by status', () => {
    const c1 = store.add(sampleInput)
    store.add({ ...sampleInput, name: 'Code review' })
    store.approve(c1.id)

    const pending = store.list('pending')
    expect(pending).toHaveLength(1)
    expect(pending[0].name).toBe('Code review')

    const approved = store.list('approved')
    expect(approved).toHaveLength(1)
    expect(approved[0].name).toBe('Deploy to production')
  })

  it('approves a candidate', () => {
    const added = store.add(sampleInput)
    const approved = store.approve(added.id)
    expect(approved).toBeDefined()
    expect(approved!.status).toBe('approved')
    expect(approved!.reviewedAt).toBeTruthy()
  })

  it('rejects a candidate', () => {
    const added = store.add(sampleInput)
    const rejected = store.reject(added.id)
    expect(rejected).toBeDefined()
    expect(rejected!.status).toBe('rejected')
    expect(rejected!.reviewedAt).toBeTruthy()
  })

  it('approve returns undefined for non-existent id', () => {
    const result = store.approve('nonexistent')
    expect(result).toBeUndefined()
  })

  it('reject returns undefined for non-existent id', () => {
    const result = store.reject('nonexistent')
    expect(result).toBeUndefined()
  })

  it('persists triggerPatterns as JSON and parses them back', () => {
    const added = store.add({ ...sampleInput, triggerPatterns: ['one', 'two', 'three'] })
    const found = store.get(added.id)
    expect(found!.triggerPatterns).toEqual(['one', 'two', 'three'])
  })

  it('lists rejected candidates', () => {
    const c = store.add(sampleInput)
    store.reject(c.id)
    const rejected = store.list('rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0].status).toBe('rejected')
  })
})
