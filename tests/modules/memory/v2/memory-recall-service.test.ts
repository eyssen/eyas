// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// I4 — ctx.memoryRecall (createMemoryRecall): the only door to recall. The
// query is composed inside (J6) and the scope is the conversation's own, so a
// caller can neither search with something else nor widen the scope. Fictive
// conversations throughout.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { createMemoryRecall, type MemoryRecallInput } from '@modules/memory/v2/assemble'
import { makeD1Db, gistRow } from './d1-fixtures'
import { seedRawRow } from './extract-helpers'
import { silentLogger } from './helpers'

const GOAL = 'Harbor invoice reconciliation against the quarterly ledger'
const PROFILE = { providerId: 'api', modelId: 'm-1', toolAddressing: { kind: 'native' as const }, drillDown: true }

function makeDb(): any {
  const { db } = makeD1Db()
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT, goal_description TEXT, project_id TEXT)`)
  db.run(sql`CREATE TABLE conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL,
    role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)`)
  return db
}

function conversation(db: any, id: string, opts: { title?: string | null; goal?: string | null; project?: string | null } = {}): void {
  db.run(sql`INSERT INTO conversations (id, title, goal_description, project_id)
    VALUES (${id}, ${opts.title ?? null}, ${opts.goal ?? null}, ${opts.project ?? null})`)
}

function userMessage(db: any, conversationId: string, content: string): void {
  db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, created_at)
    VALUES (${conversationId}, 'user', ${content}, ${new Date().toISOString()})`)
}

/** Prior work in another conversation: a raw row the query can match (long enough to expand) and its task gist. */
function priorWork(db: any, id: string, text: string, project: string | null = null): void {
  const conversationId = `c-${id}`
  const body = `${text}. ${'The reconciliation notes continue here. '.repeat(12)}`
  seedRawRow(db, { id, conversationId, content: body, projectId: project, projectTypeId: project ? 'T' : null, blob: true, fts: true })
  gistRow(db, `g-${id}`, body, {
    conv: conversationId, ...(project ? { project, projectType: 'T' } : {}),
  })
}

// A raw hit is its own row's text (J4): the fixture rows carry blobs.
beforeAll(async () => { await initZstd() })

const recallOf = (db: any) => createMemoryRecall({ db, logger: silentLogger, includeSecrets: () => false })
const input = (conversationId: string, over: Partial<MemoryRecallInput> = {}): MemoryRecallInput =>
  ({ conversationId, turnText: 'yes, do it', budgetChars: 8_000, profile: PROFILE, turnId: 't-1', ...over })

describe('ctx.memoryRecall', () => {
  it('(+) composes the query through J6: a short follow-up still carries the goal', async () => {
    const db = makeDb()
    priorWork(db, 'w1', 'Harbor invoice reconciliation matched the quarterly ledger')
    conversation(db, 'c-goal', { title: 'Quarter close', goal: GOAL })
    conversation(db, 'c-bare')
    const recall = recallOf(db)
    const withGoal = (await recall(input('c-goal')))!
    const bare = await recall(input('c-bare'))
    // The goal terms found the prior work and it was expanded for this message.
    expect(withGoal.expanded.length).toBeGreaterThan(0)
    // Without them, 'yes, do it' matches nothing: at most the standing notes remain.
    expect(bare?.expanded ?? []).toEqual([])
    expect(bare?.retrieved ?? []).toEqual([])
  })

  it('(+) the previous user turn feeds the query when the current one is empty', async () => {
    const db = makeDb()
    priorWork(db, 'w1', 'Harbor invoice reconciliation matched the quarterly ledger')
    conversation(db, 'c-hist')
    userMessage(db, 'c-hist', 'Can you redo the harbor invoice reconciliation for the quarterly ledger?')
    const out = (await recallOf(db)(input('c-hist', { turnText: '' })))!
    expect(out.expanded.length).toBeGreaterThan(0)
  })

  it('(−) callers cannot pass a query: an extra `query` field is ignored', async () => {
    const db = makeDb()
    priorWork(db, 'w1', 'Harbor invoice reconciliation matched the quarterly ledger')
    conversation(db, 'c-bare')
    const out = await recallOf(db)({ ...input('c-bare'), query: GOAL } as MemoryRecallInput)
    expect(out?.expanded ?? []).toEqual([])
    expect(out?.retrieved ?? []).toEqual([])
  })

  it('(−) the scope is the conversation\'s own: a caller-supplied project is ignored', async () => {
    const db = makeDb()
    priorWork(db, 'wq', 'Harbor invoice reconciliation matched the quarterly ledger for Q', 'Q')
    conversation(db, 'c-p', { goal: GOAL, project: 'P' })
    const out = await recallOf(db)({ ...input('c-p'), projectId: 'Q' } as MemoryRecallInput)
    for (const id of out?.ids ?? []) expect(id).not.toMatch(/wq/)
    expect(out?.content ?? '').not.toContain('for Q')
  })

  it('(−) no conversation → null (no recall), fail closed', async () => {
    const db = makeDb()
    priorWork(db, 'w1', 'Harbor invoice reconciliation matched the quarterly ledger')
    expect(await recallOf(db)(input('c-missing'))).toBeNull()
  })

  it('(−) an external audience, no budget or invalid input → null', async () => {
    const db = makeDb()
    priorWork(db, 'w1', 'Harbor invoice reconciliation matched the quarterly ledger')
    conversation(db, 'c-goal', { goal: GOAL })
    const recall = recallOf(db)
    expect(await recall(input('c-goal', { audience: 'external' }))).toBeNull()
    expect(await recall(input('c-goal', { budgetChars: 0 }))).toBeNull()
    expect(await recall(input(''))).toBeNull()
    expect(await recall({ ...input('c-goal'), budgetChars: Number.NaN })).toBeNull()
    expect(await recall(input('c-goal'))).not.toBeNull()
  })

  it('(−) never throws: a broken database is a turn without recall', async () => {
    const db = makeDb()
    conversation(db, 'c-goal', { goal: GOAL })
    const broken = new Proxy(db, {
      get(target, prop) {
        if (prop === 'all') {
          let calls = 0
          return (...args: unknown[]) => {
            // Let the scope lookup through, then fail every read after it.
            if (calls++ === 0) return (target as any).all(...args)
            throw new Error('disk I/O error')
          }
        }
        return (target as any)[prop]
      },
    })
    await expect(recallOf(broken)(input('c-goal'))).resolves.toBeNull()
  })
})
