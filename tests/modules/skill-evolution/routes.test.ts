import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createApprovalStore } from '@modules/skill-evolution/approval-store'
import { createSkillEvolutionRoutes } from '@modules/skill-evolution/routes'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { errorHandler } from '@core/http/middleware/error-handler'
import type { AppAbility } from '@modules/permissions/roles'

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

function createTestApp(store: ReturnType<typeof createApprovalStore>, ability: AppAbility) {
  const app = new Hono<{ Variables: { ability: AppAbility; userId: string } }>()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('ability', ability)
    c.set('userId', 'test-user-id')
    await next()
  })
  createSkillEvolutionRoutes(app, store)
  return app
}

const sampleInput = {
  name: 'Deploy to production',
  description: 'Deployment task',
  triggerPatterns: ['deploy', 'release'],
  content: '---\nid: deploy\n---\n',
  reasoning: 'Seen 5 times',
  confidence: 0.5,
  basedOnSessions: 5,
}

describe('Skill Evolution Routes', () => {
  let db: any
  let store: ReturnType<typeof createApprovalStore>
  let app: Hono<any>

  beforeEach(() => {
    db = createMemoryDb()
    setupTable(db)
    store = createApprovalStore(db)

    const registry = createPermissionRegistry()
    registry.registerSubject('SkillEvolution', {
      actions: ['read', 'write'],
      defaults: {
        admin: ['read', 'write'],
        owner: ['read', 'write'],
        user: ['read', 'write'],
      },
    })
    const ability = buildAbilityForRole('admin', registry)
    app = createTestApp(store, ability)
  })

  describe('GET /api/v1/skill-evolution/candidates', () => {
    it('returns empty list when no candidates exist', async () => {
      const res = await app.request('/api/v1/skill-evolution/candidates')
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.candidates).toHaveLength(0)
    })

    it('returns all candidates', async () => {
      store.add(sampleInput)
      store.add({ ...sampleInput, name: 'Code review' })
      const res = await app.request('/api/v1/skill-evolution/candidates')
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.candidates).toHaveLength(2)
    })

    it('filters candidates by status', async () => {
      const c = store.add(sampleInput)
      store.add({ ...sampleInput, name: 'Another task' })
      store.approve(c.id)

      const res = await app.request('/api/v1/skill-evolution/candidates?status=pending')
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.candidates).toHaveLength(1)
      expect(body.candidates[0].status).toBe('pending')
    })

    it('filters candidates by approved status', async () => {
      const c = store.add(sampleInput)
      store.add({ ...sampleInput, name: 'Another task' })
      store.approve(c.id)

      const res = await app.request('/api/v1/skill-evolution/candidates?status=approved')
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.candidates).toHaveLength(1)
      expect(body.candidates[0].status).toBe('approved')
    })

    it('ignores invalid status filter', async () => {
      store.add(sampleInput)
      const res = await app.request('/api/v1/skill-evolution/candidates?status=invalid')
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.candidates).toHaveLength(1)
    })
  })

  describe('GET /api/v1/skill-evolution/candidates/:id', () => {
    it('returns a single candidate by id', async () => {
      const added = store.add(sampleInput)
      const res = await app.request(`/api/v1/skill-evolution/candidates/${added.id}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.candidate.id).toBe(added.id)
      expect(body.candidate.name).toBe('Deploy to production')
    })

    it('returns 404 for non-existent id', async () => {
      const res = await app.request('/api/v1/skill-evolution/candidates/nonexistent')
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/v1/skill-evolution/candidates/:id/approve', () => {
    it('approves a candidate', async () => {
      const added = store.add(sampleInput)
      const res = await app.request(`/api/v1/skill-evolution/candidates/${added.id}/approve`, {
        method: 'POST',
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.candidate.status).toBe('approved')
      expect(body.candidate.reviewedAt).toBeTruthy()
    })

    it('returns 404 when approving non-existent candidate', async () => {
      const res = await app.request('/api/v1/skill-evolution/candidates/nonexistent/approve', {
        method: 'POST',
      })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/v1/skill-evolution/candidates/:id/reject', () => {
    it('rejects a candidate', async () => {
      const added = store.add(sampleInput)
      const res = await app.request(`/api/v1/skill-evolution/candidates/${added.id}/reject`, {
        method: 'POST',
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.candidate.status).toBe('rejected')
      expect(body.candidate.reviewedAt).toBeTruthy()
    })

    it('returns 404 when rejecting non-existent candidate', async () => {
      const res = await app.request('/api/v1/skill-evolution/candidates/nonexistent/reject', {
        method: 'POST',
      })
      expect(res.status).toBe(404)
    })
  })

  describe('Authentication', () => {
    it('returns 401 without ability set', async () => {
      const unauthApp = new Hono()
      unauthApp.onError(errorHandler)
      createSkillEvolutionRoutes(unauthApp, store)

      const res = await unauthApp.request('/api/v1/skill-evolution/candidates')
      expect(res.status).toBe(401)
    })
  })
})
