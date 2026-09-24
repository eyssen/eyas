// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// S1 — GET /api/v1/autonomy/approvals ownership scoping. Owner/admin keep
// seeing everything (including raw tool args); every other caller only sees
// approvals whose conversation resolves — walking the parent chain so a
// 'system'-owned orchestrator child resolves through its ancestors — to a
// conversation THEY own, and never sees input_json (raw tool arguments:
// commands, paths, message bodies) regardless of which rows are visible.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { createTestDb } from '../../helpers/test-db'
import { createSecurityGateRoutes, countApprovalsFor, countStuckResumesFor } from '@modules/security-gate/routes.js'
import { createAutonomyTables, createAutonomyPolicy } from '@modules/security-gate/autonomy-policy.js'
import { createConversationService } from '@modules/conversations/conversation-service.js'
import { DEFAULT_CONFIG } from '@modules/security-gate/types.js'

function insertConversation(db: any, opts: { id: string; userId: string; parentConversationId?: string | null }) {
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO conversations (id, task_id, title, status, user_id, tokens_used, mode, parent_conversation_id, created_at, updated_at)
    VALUES (${opts.id}, ${opts.id}, 'title', 'idle', ${opts.userId}, 0, 'simple', ${opts.parentConversationId ?? null}, ${now}, ${now})`)
}

function setup(caller: { role?: string; userId?: string } = {}) {
  const db = createTestDb('scoping').open()
  createAutonomyTables(db)
  const policy = createAutonomyPolicy(db)
  const conversations = createConversationService(db)
  const app = new Hono()
  app.use('*', async (c, next) => {
    ;(c as any).set('ability', { can: () => true })
    if (caller.userId) (c as any).set('userId', caller.userId)
    if (caller.role) (c as any).set('role', caller.role)
    await next()
  })
  createSecurityGateRoutes(app as any, db as any, DEFAULT_CONFIG, policy, undefined, undefined, conversations)
  return { app, policy, db, conversations }
}

async function listApprovals(app: Hono) {
  const res = await app.request('/api/v1/autonomy/approvals')
  expect(res.status).toBe(200)
  return (await res.json()) as { approvals: any[] }
}

describe('GET /autonomy/approvals — S1 ownership scoping', () => {
  it('owner sees every row, including input_json', async () => {
    const { app, policy, db } = setup({ role: 'owner', userId: 'alice' })
    insertConversation(db, { id: 'conv-1', userId: 'alice' })
    policy.createApproval({ category: 'data_delete', conversationId: 'conv-1', inputJson: '{"path":"/etc/passwd"}' })

    const body = await listApprovals(app)
    expect(body.approvals).toHaveLength(1)
    expect(body.approvals[0].inputJson).toBe('{"path":"/etc/passwd"}')
  })

  it('admin sees every row too, unfiltered', async () => {
    const { app, policy, db } = setup({ role: 'admin', userId: 'bob' })
    insertConversation(db, { id: 'conv-1', userId: 'alice' })
    policy.createApproval({ category: 'data_delete', conversationId: 'conv-1', inputJson: '{"path":"/etc/passwd"}' })

    const body = await listApprovals(app)
    expect(body.approvals).toHaveLength(1)
    expect(body.approvals[0].inputJson).toBe('{"path":"/etc/passwd"}')
  })

  it("a plain 'user' sees their OWN conversation's approval, with input_json OMITTED (not null — the key itself is gone)", async () => {
    const { app, policy, db } = setup({ role: 'user', userId: 'alice' })
    insertConversation(db, { id: 'conv-1', userId: 'alice' })
    policy.createApproval({ category: 'data_delete', conversationId: 'conv-1', inputJson: '{"path":"/etc/passwd"}' })

    const body = await listApprovals(app)
    expect(body.approvals).toHaveLength(1)
    expect('inputJson' in body.approvals[0]).toBe(false)
  })

  it("a plain 'user' does NOT see another user's conversation approval", async () => {
    const { app, policy, db } = setup({ role: 'user', userId: 'alice' })
    insertConversation(db, { id: 'conv-1', userId: 'mallory' })
    policy.createApproval({ category: 'data_delete', conversationId: 'conv-1' })

    const body = await listApprovals(app)
    expect(body.approvals).toHaveLength(0)
  })

  it('resolves a system-owned orchestrator child through the parent chain to the human owner', async () => {
    const { app, policy, db } = setup({ role: 'user', userId: 'alice' })
    insertConversation(db, { id: 'root', userId: 'alice' })
    insertConversation(db, { id: 'child', userId: 'system', parentConversationId: 'root' })
    policy.createApproval({ category: 'data_delete', conversationId: 'child' })

    const body = await listApprovals(app)
    expect(body.approvals).toHaveLength(1)
  })

  it('a system-owned child whose root belongs to someone else stays invisible', async () => {
    const { app, policy, db } = setup({ role: 'user', userId: 'alice' })
    insertConversation(db, { id: 'root', userId: 'mallory' })
    insertConversation(db, { id: 'child', userId: 'system', parentConversationId: 'root' })
    policy.createApproval({ category: 'data_delete', conversationId: 'child' })

    const body = await listApprovals(app)
    expect(body.approvals).toHaveLength(0)
  })

  it('a row with NO conversation_id at all is admin-only — invisible to a plain user', async () => {
    const { app, policy } = setup({ role: 'user', userId: 'alice' })
    policy.createApproval({ category: 'ops_apply' }) // no conversationId

    const body = await listApprovals(app)
    expect(body.approvals).toHaveLength(0)
  })

  it('a row with NO conversation_id IS visible to owner/admin', async () => {
    const { app, policy } = setup({ role: 'owner', userId: 'alice' })
    policy.createApproval({ category: 'ops_apply' })

    const body = await listApprovals(app)
    expect(body.approvals).toHaveLength(1)
  })

  it('returns an empty list (fail-closed) when no userId is on the context, even with the read permission', async () => {
    const { app, policy, db } = setup({ role: 'user' }) // no userId set
    insertConversation(db, { id: 'conv-1', userId: 'alice' })
    policy.createApproval({ category: 'data_delete', conversationId: 'conv-1' })

    const body = await listApprovals(app)
    expect(body.approvals).toHaveLength(0)
  })
})

// F2 T6 fix round 1 / Important 2 — the autonomy dashboard needs decided
// approvals whose resume refused, but it refetches on EVERY autonomy WS event.
// An unbounded ?status=approved history (carrying input_json for admins) is
// the wrong way to serve that; the server filters and bounds it instead.
describe('GET /autonomy/approvals — bounded listings (F2 T6 fix 1)', () => {
  it('?resumeFailed=1 returns only decided-but-stuck rows', async () => {
    const { app, policy, db } = setup({ role: 'owner', userId: 'alice' })
    insertConversation(db, { id: 'conv-1', userId: 'alice' })
    const stuck = policy.createApproval({ category: 'data_delete', conversationId: 'conv-1', runId: 'run-1' })
    policy.decide(stuck, 'approved', 'alice')
    policy.setResumeError(stuck, 'event_store_required')
    // Approved and resumed fine → not stuck.
    const fine = policy.createApproval({ category: 'data_delete', conversationId: 'conv-1', toolName: 't', argHash: 'h', runId: 'run-2' })
    policy.decide(fine, 'approved', 'alice')
    policy.consumeGrant({ conversationId: 'conv-1', toolName: 't', argHash: 'h' })
    // Still waiting on a human → belongs to the pending list, not this one.
    policy.createApproval({ category: 'data_delete', conversationId: 'conv-1', runId: 'run-3' })

    const res = await app.request('/api/v1/autonomy/approvals?resumeFailed=1')
    const body = (await res.json()) as { approvals: any[] }

    expect(body.approvals).toHaveLength(1)
    expect(body.approvals[0]).toMatchObject({ id: stuck, resumeError: 'event_store_required' })
  })

  it('a stuck row a non-admin does not own is still scoped away', async () => {
    const { app, policy, db } = setup({ role: 'user', userId: 'bob' })
    insertConversation(db, { id: 'conv-1', userId: 'alice' })
    const id = policy.createApproval({ category: 'data_delete', conversationId: 'conv-1', runId: 'run-1' })
    policy.decide(id, 'approved', 'alice')
    policy.setResumeError(id, 'over_budget')

    const res = await app.request('/api/v1/autonomy/approvals?resumeFailed=1')
    expect((await res.json() as { approvals: any[] }).approvals).toHaveLength(0)
  })

  it('a generic status listing is capped rather than returning the whole history', async () => {
    const { app, policy, db } = setup({ role: 'owner', userId: 'alice' })
    insertConversation(db, { id: 'conv-1', userId: 'alice' })
    for (let i = 0; i < 105; i++) {
      policy.createApproval({ category: 'data_delete', conversationId: 'conv-1', toolName: `t${i}`, argHash: `h${i}` })
    }

    const res = await app.request('/api/v1/autonomy/approvals?status=pending')
    expect((await res.json() as { approvals: any[] }).approvals).toHaveLength(100)
  })
})

// Fix round 2 / Important 2 — the page limit used to be applied BEFORE the
// ownership scoping, so a plain user whose approval sat behind 100 newer
// foreign rows got an empty queue and could never decide the run parked on it.
// The bound has to apply to the caller's OWN visible set.
describe('GET /autonomy/approvals — the limit applies after scoping (F2 T6 fix 2)', () => {
  it('a user sees their older pending row behind a wall of newer foreign ones', async () => {
    const { app, policy, db } = setup({ role: 'user', userId: 'bob' })
    insertConversation(db, { id: 'conv-bob', userId: 'bob' })
    insertConversation(db, { id: 'conv-alice', userId: 'alice' })

    // Bob's approval is the OLDEST row in the table…
    const mine = policy.createApproval({ category: 'data_delete', conversationId: 'conv-bob', toolName: 'delete_record', argHash: 'mine' })
    db.run(sql`UPDATE autonomy_approvals SET requested_at = '2020-01-01T00:00:00Z' WHERE id = ${mine}`)
    // …behind 150 newer ones he cannot see.
    for (let i = 0; i < 150; i++) {
      policy.createApproval({ category: 'data_delete', conversationId: 'conv-alice', toolName: `t${i}`, argHash: `h${i}` })
    }

    const body = await listApprovals(app)

    expect(body.approvals.map((a) => a.id)).toEqual([mine])
  })

  it('the same holds for the stuck-resume list', async () => {
    const { app, policy, db } = setup({ role: 'user', userId: 'bob' })
    insertConversation(db, { id: 'conv-bob', userId: 'bob' })
    insertConversation(db, { id: 'conv-alice', userId: 'alice' })

    const mine = policy.createApproval({ category: 'data_delete', conversationId: 'conv-bob', runId: 'run-mine' })
    policy.decide(mine, 'approved', 'bob')
    policy.setResumeError(mine, 'event_store_required')
    db.run(sql`UPDATE autonomy_approvals SET requested_at = '2020-01-01T00:00:00Z' WHERE id = ${mine}`)
    for (let i = 0; i < 150; i++) {
      const id = policy.createApproval({ category: 'data_delete', conversationId: 'conv-alice', toolName: `t${i}`, argHash: `h${i}`, runId: `r${i}` })
      policy.decide(id, 'approved', 'alice')
      policy.setResumeError(id, 'over_budget')
    }

    const res = await app.request('/api/v1/autonomy/approvals?resumeFailed=1')
    const body = (await res.json()) as { approvals: any[] }

    expect(body.approvals.map((a) => a.id)).toEqual([mine])
  })

  it('an admin still gets a bounded page of the whole queue', async () => {
    const { app, policy, db } = setup({ role: 'admin', userId: 'root' })
    insertConversation(db, { id: 'conv-alice', userId: 'alice' })
    for (let i = 0; i < 105; i++) {
      policy.createApproval({ category: 'data_delete', conversationId: 'conv-alice', toolName: `t${i}`, argHash: `h${i}` })
    }

    const body = await listApprovals(app)
    expect(body.approvals).toHaveLength(100)
  })
})

// Fix round 1 (I-2/I-3) — countApprovalsFor/countStuckResumesFor are the
// exported counting path home's pulse tile calls through the security-gate
// service handle. They reuse the SAME ownership resolution as GET
// /autonomy/approvals above (via routes.ts's shared ownedConversationIds),
// so scoping can never drift between "list mine" and "count mine" — proven
// here against the identical fixtures the listing tests above use.
describe('countApprovalsFor / countStuckResumesFor — same ownership as GET /autonomy/approvals', () => {
  it('a non-admin only counts approvals whose conversation resolves to them, including past the 100-row page cap', async () => {
    const { policy, db, conversations } = setup()
    insertConversation(db, { id: 'conv-bob', userId: 'bob' })
    insertConversation(db, { id: 'conv-alice', userId: 'alice' })
    for (let i = 0; i < 105; i++) {
      policy.createApproval({ category: 'data_delete', conversationId: 'conv-bob', toolName: `t${i}`, argHash: `h${i}` })
    }
    policy.createApproval({ category: 'data_delete', conversationId: 'conv-alice' }) // not bob's

    expect(countApprovalsFor(policy, conversations, { userId: 'bob', privileged: false, status: 'pending' })).toBe(105)
    expect(countApprovalsFor(policy, conversations, { userId: 'alice', privileged: false, status: 'pending' })).toBe(1)
  })

  it('resolves a system-owned orchestrator child through the parent chain, exactly like the listing route', async () => {
    const { policy, db, conversations } = setup()
    insertConversation(db, { id: 'root', userId: 'alice' })
    insertConversation(db, { id: 'child', userId: 'system', parentConversationId: 'root' })
    policy.createApproval({ category: 'data_delete', conversationId: 'child' })

    expect(countApprovalsFor(policy, conversations, { userId: 'alice', privileged: false, status: 'pending' })).toBe(1)
    expect(countApprovalsFor(policy, conversations, { userId: 'mallory', privileged: false, status: 'pending' })).toBe(0)
  })

  it('privileged (admin/owner) gets the installation-wide count, unfiltered by conversations', async () => {
    const { policy, db, conversations } = setup()
    insertConversation(db, { id: 'conv-alice', userId: 'alice' })
    for (let i = 0; i < 105; i++) {
      policy.createApproval({ category: 'data_delete', conversationId: 'conv-alice', toolName: `t${i}`, argHash: `h${i}` })
    }
    policy.createApproval({ category: 'ops_apply' }) // no conversation_id — admin-visible only

    expect(countApprovalsFor(policy, conversations, { userId: 'root', privileged: true, status: 'pending' })).toBe(106)
  })

  it('without a conversations handle, a non-admin count degrades to 0 rather than guessing', () => {
    const { policy } = setup()
    policy.createApproval({ category: 'ops_apply', conversationId: 'conv-1' })

    expect(countApprovalsFor(policy, undefined, { userId: 'alice', privileged: false, status: 'pending' })).toBe(0)
  })

  it('countStuckResumesFor scopes the same way for the stuck-resume filter', async () => {
    const { policy, db, conversations } = setup()
    insertConversation(db, { id: 'conv-bob', userId: 'bob' })
    insertConversation(db, { id: 'conv-alice', userId: 'alice' })
    const mine = policy.createApproval({ category: 'data_delete', conversationId: 'conv-bob', runId: 'run-1' })
    policy.decide(mine, 'approved', 'bob')
    policy.setResumeError(mine, 'event_store_required')
    const theirs = policy.createApproval({ category: 'data_delete', conversationId: 'conv-alice', runId: 'run-2' })
    policy.decide(theirs, 'approved', 'alice')
    policy.setResumeError(theirs, 'over_budget')

    expect(countStuckResumesFor(policy, conversations, { userId: 'bob', privileged: false })).toBe(1)
    expect(countStuckResumesFor(policy, conversations, { userId: 'root', privileged: true })).toBe(2)
  })
})
