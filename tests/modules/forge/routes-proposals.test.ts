// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { createForgeRoutes } from '../../../src/modules/forge/routes.js'
import { createProposalStore } from '../../../src/modules/forge/proposal-store.js'
import { buildAbilityForRole } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'
import { errorHandler } from '../../../src/core/http/middleware/error-handler.js'

// ─── Setup ──────────────────────────────────────────────

function setupDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  db.run(sql`CREATE TABLE forge_feedback (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    target_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    agent_id TEXT,
    useful INTEGER NOT NULL,
    friction TEXT,
    better_approach TEXT,
    created_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE forge_proposals (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
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
  db.run(sql`CREATE TABLE forge_experiments (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    result TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT
  )`)
  return db
}

function makeAbility() {
  const reg = createPermissionRegistry()
  reg.registerSubject('Forge', {
    actions: ['read', 'write', 'manage'],
    defaults: {
      admin: ['read', 'write', 'manage'],
      owner: ['read', 'write', 'manage'],
      user: ['read', 'write'],
      agent: [],
      guest: [],
    },
  })
  return buildAbilityForRole('owner', reg)
}

interface TestAppOptions {
  soulApplier?: {
    apply: (id: string) => Promise<{ ok: boolean; reason?: string }>
    reject: (id: string) => Promise<void>
  }
}

function createTestApp(db: ReturnType<typeof setupDb>, opts: TestAppOptions = {}) {
  const proposalStore = createProposalStore(db)
  const ability = makeAbility()

  // Minimal stub implementations for unused services
  const collector = { listForTarget: vi.fn().mockReturnValue([]), record: vi.fn() }
  const analyzer = { analyze: vi.fn().mockReturnValue([]) }
  const proposalEngine = { generateFromFriction: vi.fn().mockReturnValue([]) }
  const experimentRunner = { create: vi.fn(), listForProposal: vi.fn().mockReturnValue([]) }
  const applier = {
    apply: vi.fn().mockReturnValue({ success: true, message: 'applied' }),
  }

  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c: any, next: any) => {
    c.set('ability', ability)
    c.set('userId', 'test-user')
    await next()
  })

  createForgeRoutes(app as any, {
    collector: collector as any,
    analyzer: analyzer as any,
    proposalStore,
    proposalEngine: proposalEngine as any,
    experimentRunner: experimentRunner as any,
    applier: applier as any,
    soulApplier: opts.soulApplier as any,
  })

  return { app, proposalStore, applier }
}

// ─── Helpers ────────────────────────────────────────────

function seedProposal(
  store: ReturnType<typeof createProposalStore>,
  overrides: Partial<Parameters<ReturnType<typeof createProposalStore>['add']>[0]> & { target?: string } = {},
) {
  return store.add({
    target: (overrides.target ?? 'skill') as 'skill' | 'tool',
    targetId: 'tool-search',
    scope: 'description',
    title: 'Test Proposal',
    description: 'Some proposal',
    currentValue: 'old',
    proposedValue: 'new',
    reasoning: 'because',
    confidence: 0.7,
    basedOnFeedbacks: 3,
    ...overrides,
  } as any)
}

// ─── Tests ──────────────────────────────────────────────

describe('Forge Routes — proposals', () => {
  let db: ReturnType<typeof setupDb>

  beforeEach(() => {
    db = setupDb()
  })

  describe('GET /api/v1/forge/proposals', () => {
    it('returns all proposals when no filter', async () => {
      const { app, proposalStore } = createTestApp(db)
      seedProposal(proposalStore, { target: 'skill' })
      seedProposal(proposalStore, { target: 'tool' })

      const res = await app.request('/api/v1/forge/proposals')
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.proposals).toHaveLength(2)
    })

    it('filters proposals by target=soul', async () => {
      const { app } = createTestApp(db)
      const store = createProposalStore(db)
      // Insert a soul proposal manually since store.add enforces ForgeTarget type
      db.run(sql`INSERT INTO forge_proposals (
        id, target, target_id, scope, title, description, current_value, proposed_value,
        reasoning, confidence, based_on_feedbacks, status, created_at
      ) VALUES ('p-soul', 'soul', 'jarvis', 'internal', 'Soul change', 'desc', 'old', 'new', 'reason', 0.5, 1, 'pending', '2026-04-27T00:00:00Z')`)
      seedProposal(store, { target: 'skill' })

      const res = await app.request('/api/v1/forge/proposals?target=soul')
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.proposals).toHaveLength(1)
      expect(body.proposals[0].target).toBe('soul')
    })

    it('filters proposals by target=skill', async () => {
      const { app, proposalStore } = createTestApp(db)
      seedProposal(proposalStore, { target: 'skill' })
      seedProposal(proposalStore, { target: 'tool' })

      const res = await app.request('/api/v1/forge/proposals?target=skill')
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.proposals).toHaveLength(1)
      expect(body.proposals[0].target).toBe('skill')
    })

    it('returns empty array when no proposals exist', async () => {
      const { app } = createTestApp(db)
      const res = await app.request('/api/v1/forge/proposals')
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.proposals).toHaveLength(0)
    })
  })

  describe('POST /api/v1/forge/proposals/:id/apply', () => {
    it('applies skill/tool proposal via generic applier', async () => {
      const { app, proposalStore, applier } = createTestApp(db)
      const p = seedProposal(proposalStore, { target: 'skill' })

      const res = await app.request(`/api/v1/forge/proposals/${p.id}/apply`, { method: 'POST' })
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.applyResult.success).toBe(true)
      expect(applier.apply).toHaveBeenCalledOnce()
    })

    it('returns 404 for unknown proposal', async () => {
      const { app } = createTestApp(db)
      const res = await app.request('/api/v1/forge/proposals/nonexistent/apply', { method: 'POST' })
      expect(res.status).toBe(404)
    })

    it('applies soul proposal via soulApplier', async () => {
      const soulApplier = {
        apply: vi.fn().mockResolvedValue({ ok: true }),
        reject: vi.fn().mockResolvedValue(undefined),
      }
      const { app } = createTestApp(db, { soulApplier })

      db.run(sql`INSERT INTO forge_proposals (
        id, target, target_id, scope, title, description, current_value, proposed_value,
        reasoning, confidence, based_on_feedbacks, status, created_at
      ) VALUES ('soul-1', 'soul', 'jarvis', 'internal', 'Soul change', 'desc', 'old', 'new', 'reason', 0.5, 1, 'pending', '2026-04-27T00:00:00Z')`)

      const res = await app.request('/api/v1/forge/proposals/soul-1/apply', { method: 'POST' })
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.applyResult.ok).toBe(true)
      expect(soulApplier.apply).toHaveBeenCalledWith('soul-1')
    })

    it('returns 503 when soul proposal applied without soulApplier', async () => {
      const { app } = createTestApp(db, { soulApplier: undefined })

      db.run(sql`INSERT INTO forge_proposals (
        id, target, target_id, scope, title, description, current_value, proposed_value,
        reasoning, confidence, based_on_feedbacks, status, created_at
      ) VALUES ('soul-2', 'soul', 'jarvis', 'internal', 'Soul change', 'desc', 'old', 'new', 'reason', 0.5, 1, 'pending', '2026-04-27T00:00:00Z')`)

      const res = await app.request('/api/v1/forge/proposals/soul-2/apply', { method: 'POST' })
      expect(res.status).toBe(503)
    })

    it('returns 400 when proposal status is already applied', async () => {
      const { app } = createTestApp(db)
      db.run(sql`INSERT INTO forge_proposals (
        id, target, target_id, scope, title, description, current_value, proposed_value,
        reasoning, confidence, based_on_feedbacks, status, created_at
      ) VALUES ('p-done', 'skill', 'sk-1', 'description', 'Done', 'desc', 'old', 'new', 'reason', 0.5, 1, 'applied', '2026-04-27T00:00:00Z')`)
      const res = await app.request('/api/v1/forge/proposals/p-done/apply', { method: 'POST' })
      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/v1/forge/proposals/:id/reject', () => {
    it('rejects skill/tool proposal via proposalStore', async () => {
      const { app, proposalStore } = createTestApp(db)
      const p = seedProposal(proposalStore, { target: 'tool' })

      const res = await app.request(`/api/v1/forge/proposals/${p.id}/reject`, { method: 'POST' })
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.proposal.status).toBe('rejected')
    })

    it('rejects soul proposal via soulApplier.reject', async () => {
      const soulApplier = {
        apply: vi.fn().mockResolvedValue({ ok: true }),
        reject: vi.fn().mockResolvedValue(undefined),
      }
      const { app } = createTestApp(db, { soulApplier })

      db.run(sql`INSERT INTO forge_proposals (
        id, target, target_id, scope, title, description, current_value, proposed_value,
        reasoning, confidence, based_on_feedbacks, status, created_at
      ) VALUES ('soul-3', 'soul', 'jarvis', 'internal', 'Soul change', 'desc', 'old', 'new', 'reason', 0.5, 1, 'pending', '2026-04-27T00:00:00Z')`)

      const res = await app.request('/api/v1/forge/proposals/soul-3/reject', { method: 'POST' })
      expect(res.status).toBe(200)
      expect(soulApplier.reject).toHaveBeenCalledWith('soul-3')
    })

    it('returns 404 for unknown proposal', async () => {
      const { app } = createTestApp(db)
      const res = await app.request('/api/v1/forge/proposals/nonexistent/reject', { method: 'POST' })
      expect(res.status).toBe(404)
    })

    it('returns 400 when proposal is already rejected', async () => {
      const { app } = createTestApp(db)
      db.run(sql`INSERT INTO forge_proposals (
        id, target, target_id, scope, title, description, current_value, proposed_value,
        reasoning, confidence, based_on_feedbacks, status, created_at
      ) VALUES ('p-rej', 'skill', 'sk-1', 'description', 'Already rejected', 'desc', 'old', 'new', 'reason', 0.5, 1, 'rejected', '2026-04-27T00:00:00Z')`)
      const res = await app.request('/api/v1/forge/proposals/p-rej/reject', { method: 'POST' })
      expect(res.status).toBe(400)
    })
  })
})
