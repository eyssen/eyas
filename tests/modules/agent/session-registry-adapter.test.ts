// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Mission Control reads its live grid through the AgentSessionRegistry port.
// This adapter is the only implementation that returns real runs — without it
// the dashboard renders the empty fallback registry forever.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { ensureRunSupervisionSchema, createRunSupervisor } from '@modules/agent/run-supervisor'
import { createAgentSessionRegistryAdapter } from '@modules/agent/session-registry-adapter'

function setup(opts: { withConversations?: boolean } = {}) {
  const db = createMemoryDb()
  ensureRunSupervisionSchema(db)
  if (opts.withConversations !== false) {
    // Minimal stand-in for the conversations module's table — the adapter
    // only needs the owner column plus (F2 T4 / S7) parent_conversation_id to
    // walk a 'system'-owned child up to its nearest human-owned ancestor.
    db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, parent_conversation_id TEXT)`)
  }
  const supervisor = createRunSupervisor({ db })
  const agents = new Map<string, { name: string; maxTurns?: number; monthlyTokenBudget?: number }>()
  const registry = createAgentSessionRegistryAdapter({
    db,
    supervisor,
    agents: { get: (id: string) => agents.get(id) },
  })
  return { db, supervisor, registry, agents }
}

const conv = (db: any, id: string, userId: string, parentId: string | null = null) =>
  db.run(sql`INSERT INTO conversations (id, user_id, parent_conversation_id) VALUES (${id}, ${userId}, ${parentId})`)

describe('agent session registry adapter', () => {
  it('lists active runs with the owning user resolved through the conversation', () => {
    const { db, supervisor, registry, agents } = setup()
    agents.set('a1', { name: 'Alpha', maxTurns: 12, monthlyTokenBudget: 50_000 })
    conv(db, 'c1', 'alice')
    supervisor.beginRun({ sessionId: 's1', conversationId: 'c1', agentId: 'a1', kind: 'background' })

    const entries = registry.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      sessionId: 's1',
      agentId: 'a1',
      agentName: 'Alpha',
      ownerUserId: 'alice',
      status: 'running',
      maxTurns: 12,
      tokensBudget: 50_000,
    })
    expect(entries[0]!.startedAt).toBeGreaterThan(0)
  })

  it('falls back to the agent id as name and an empty owner when nothing resolves', () => {
    const { supervisor, registry } = setup()
    supervisor.beginRun({ sessionId: 's1', conversationId: 'missing', agentId: 'a1' })

    const entry = registry.get('s1')!
    expect(entry.agentName).toBe('a1')
    // Fail CLOSED: an unresolvable owner must never match a caller's user id.
    expect(entry.ownerUserId).toBe('')
  })

  it('maps supervisor-internal statuses onto the dashboard vocabulary', () => {
    const { db, registry } = setup()
    const insert = (id: string, status: string) =>
      db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at)
        VALUES (${id}, 'c1', 'a1', ${status}, '2026-01-01T00:00:00Z')`)
    insert('s-stuck', 'stuck')
    insert('s-refresh', 'refreshing')
    insert('s-done', 'completed')
    insert('s-maxturns', 'max_turns')

    expect(registry.get('s-stuck')!.status).toBe('running')
    expect(registry.get('s-refresh')!.status).toBe('running')
    expect(registry.get('s-done')!.status).toBe('completed')
    // D6: 'max_turns' is a terminal agent_sessions-only status with no
    // dedicated AgentRunStatus slot — reads as 'completed', same as 'done'.
    expect(registry.get('s-maxturns')!.status).toBe('completed')
    // Terminal runs are not part of the live grid.
    expect(registry.list().map((e) => e.sessionId).sort()).toEqual(['s-refresh', 's-stuck'])
  })

  it('get() returns undefined for an unknown session', () => {
    const { registry } = setup()
    expect(registry.get('nope')).toBeUndefined()
  })

  it('interrupt() cancels the run through the supervisor', async () => {
    const { db, supervisor, registry } = setup()
    conv(db, 'c1', 'alice')
    const handle = supervisor.beginRun({ sessionId: 's1', conversationId: 'c1', agentId: 'a1' })

    await registry.interrupt('s1')

    expect(handle.signal.aborted).toBe(true)
  })

  it('interrupt() on a run this process is not watching reports the failure', async () => {
    const { registry } = setup()
    await expect(registry.interrupt('ghost')).rejects.toThrow(/not active/i)
  })

  it('pause/resume are rejected — in-process runs cannot be suspended', async () => {
    const { registry } = setup()
    await expect(registry.pause('s1')).rejects.toThrow(/not supported/i)
    await expect(registry.resume('s1')).rejects.toThrow(/not supported/i)
  })

  it('returns empty instead of throwing when agent_sessions is absent', () => {
    const db = createMemoryDb()
    const registry = createAgentSessionRegistryAdapter({
      db,
      supervisor: createRunSupervisor({ db }),
    })
    expect(registry.list()).toEqual([])
    expect(registry.get('s1')).toBeUndefined()
  })

  // F2 T4 (S7) — orchestrator/executeAgent child conversations are created
  // with userId 'system' (team/delegation runs have no human at the
  // keyboard). Without walking the parent chain every such run would surface
  // with owner 'system' and vanish from every human owner's Mission Control
  // view (the routes filter list() by owner).
  describe('S7 — owner resolution walks the parent chain for system-owned conversations', () => {
    it('resolves ownerUserId to the human root owner when the run\'s conversation is system-owned', () => {
      const { db, supervisor, registry } = setup()
      conv(db, 'root', 'alice')
      conv(db, 'child', 'system', 'root')
      supervisor.beginRun({ sessionId: 's1', conversationId: 'child', agentId: 'a1' })

      expect(registry.get('s1')!.ownerUserId).toBe('alice')
    })

    it('walks multiple system-owned hops to find the nearest human owner', () => {
      const { db, supervisor, registry } = setup()
      conv(db, 'root', 'alice')
      conv(db, 'mid', 'system', 'root')
      conv(db, 'leaf', 'system', 'mid')
      supervisor.beginRun({ sessionId: 's1', conversationId: 'leaf', agentId: 'a1' })

      expect(registry.get('s1')!.ownerUserId).toBe('alice')
    })

    it('does not walk (and does not extra-query) when the conversation is already human-owned', () => {
      const { db, supervisor, registry } = setup()
      conv(db, 'root', 'alice')
      conv(db, 'child', 'bob', 'root')
      supervisor.beginRun({ sessionId: 's1', conversationId: 'child', agentId: 'a1' })

      // Direct owner wins — the chain's root ('alice') must NOT be surfaced.
      expect(registry.get('s1')!.ownerUserId).toBe('bob')
    })

    it('fails closed to an empty owner when a system-owned chain never reaches a human owner', () => {
      const { db, supervisor, registry } = setup()
      conv(db, 'child', 'system', null)
      supervisor.beginRun({ sessionId: 's1', conversationId: 'child', agentId: 'a1' })

      expect(registry.get('s1')!.ownerUserId).toBe('')
    })

    it('is reflected in list() as well as get()', () => {
      const { db, supervisor, registry } = setup()
      conv(db, 'root', 'alice')
      conv(db, 'child', 'system', 'root')
      supervisor.beginRun({ sessionId: 's1', conversationId: 'child', agentId: 'a1' })

      expect(registry.list()[0]!.ownerUserId).toBe('alice')
    })
  })
})
