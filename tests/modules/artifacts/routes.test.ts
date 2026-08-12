// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createArtifactTables } from '../../../src/modules/artifacts/schema'
import {
  createArtifactService,
  type ArtifactService,
} from '../../../src/modules/artifacts/artifact-service'
import { createArtifactRoutes } from '../../../src/modules/artifacts/routes'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { errorHandler } from '@core/http/middleware/error-handler'
import type { AppAbility } from '@modules/permissions/roles'
import type { RoleId } from '@modules/permissions/types'

function createTestApp(service: ArtifactService, ability: AppAbility) {
  const app = new Hono<{ Variables: { ability: AppAbility } }>()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('ability', ability)
    await next()
  })
  const logger = { info: () => {}, warn: () => {}, error: () => {} } as any
  createArtifactRoutes(app, service, logger)
  return app
}

const validPrd = {
  problem: 'Users need a faster onboarding experience after the UI refresh',
  personas: [{ name: 'Admin', goals: ['Invite teammates'] }],
  successMetrics: ['TTV < 5 min'],
  requirements: { functional: ['Magic-link invite'] },
  outOfScope: [],
  openQuestions: [],
}

const validDesign = {
  summary: 'Adopt typed artifacts for handoffs between PM/Architect/Dev',
  architecture: {
    components: [{ name: 'ArtifactService', responsibility: 'CRUD + versioning' }],
    dataFlow: [],
  },
  interfaces: [],
  dataModel: [],
  risks: [],
  alternatives: [],
}

describe('Artifacts routes', () => {
  let db: ReturnType<typeof createMemoryDb>
  let service: ArtifactService
  // Hono<any> because createTestApp returns an app carrying CASL Variables.
  let ownerApp: Hono<any>
  let guestApp: Hono<any>

  beforeEach(() => {
    db = createMemoryDb()
    createArtifactTables(db)
    service = createArtifactService(db)
    const registry = createPermissionRegistry()
    const ownerAbility = buildAbilityForRole('owner' as RoleId, registry)
    const guestAbility = buildAbilityForRole('guest' as RoleId, registry)
    ownerApp = createTestApp(service, ownerAbility)
    guestApp = createTestApp(service, guestAbility)
  })

  const json = { 'Content-Type': 'application/json' }

  describe('permission enforcement', () => {
    it('denies guest on POST create (403)', async () => {
      const res = await guestApp.request('/api/v1/artifacts', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ kind: 'prd', title: 'X', payload: validPrd }),
      })
      expect(res.status).toBe(403)
    })

    it('returns 401 when no ability is set', async () => {
      const bare = new Hono()
      bare.onError(errorHandler)
      createArtifactRoutes(bare, service, { info: () => {} } as any)
      const res = await bare.request('/api/v1/artifacts', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ kind: 'prd', title: 'X', payload: validPrd }),
      })
      expect(res.status).toBe(401)
    })
  })

  describe('POST /artifacts', () => {
    it('creates a valid PRD (201)', async () => {
      const res = await ownerApp.request('/api/v1/artifacts', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          sessionId: 'sess1',
          kind: 'prd',
          title: 'Q3 Billing',
          payload: validPrd,
          producedBy: 'agent_pm',
        }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as any
      expect(body.id).toBeTruthy()
      expect(body.kind).toBe('prd')
      expect(body.currentVersion).toBe(1)
      expect(body.payload.problem).toContain('onboarding')
    })

    it('returns 400 when kind is missing', async () => {
      const res = await ownerApp.request('/api/v1/artifacts', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ title: 'x', payload: validPrd }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 on unknown kind', async () => {
      const res = await ownerApp.request('/api/v1/artifacts', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ kind: 'nope', title: 'x', payload: {} }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 with ValidationError on bad payload', async () => {
      const res = await ownerApp.request('/api/v1/artifacts', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          kind: 'prd',
          title: 'x',
          payload: { problem: 'too short' },
        }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as any
      expect(body.error).toBe('ValidationError')
      expect(body.kind).toBe('prd')
      expect(Array.isArray(body.issues)).toBe(true)
    })

    it('returns 400 on invalid JSON body', async () => {
      const res = await ownerApp.request('/api/v1/artifacts', {
        method: 'POST',
        headers: json,
        body: '{{{not json',
      })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /artifacts/:id', () => {
    it('returns 404 for missing', async () => {
      const res = await ownerApp.request('/api/v1/artifacts/does-not-exist')
      expect(res.status).toBe(404)
    })

    it('returns artifact + payload', async () => {
      const a = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'P',
        payload: validPrd as any,
      })
      const res = await ownerApp.request(`/api/v1/artifacts/${a.id}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.id).toBe(a.id)
      expect(body.payload).toBeDefined()
    })
  })

  describe('PUT /artifacts/:id', () => {
    it('creates a new version', async () => {
      const a = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'P',
        payload: validPrd as any,
      })
      const res = await ownerApp.request(`/api/v1/artifacts/${a.id}`, {
        method: 'PUT',
        headers: json,
        body: JSON.stringify({
          payload: { ...validPrd, outOfScope: ['billing'] },
          actor: 'agent_pm',
          note: 'scope cut',
        }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.currentVersion).toBe(2)
      expect(body.payload.outOfScope).toEqual(['billing'])
    })

    it('returns 400 with detailed error on schema drift', async () => {
      const a = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'P',
        payload: validPrd as any,
      })
      const res = await ownerApp.request(`/api/v1/artifacts/${a.id}`, {
        method: 'PUT',
        headers: json,
        body: JSON.stringify({ payload: { problem: 'short' } }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as any
      expect(body.error).toBe('ValidationError')
      expect(body.issues).toBeDefined()
    })

    it('returns 404 when artifact is missing', async () => {
      const res = await ownerApp.request(`/api/v1/artifacts/missing`, {
        method: 'PUT',
        headers: json,
        body: JSON.stringify({ payload: validPrd }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /artifacts/:id/consume', () => {
    it('adds agent to consumedBy and returns the artifact', async () => {
      const a = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'P',
        payload: validPrd as any,
      })
      const res = await ownerApp.request(`/api/v1/artifacts/${a.id}/consume`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ agentId: 'agent_architect' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.consumedBy).toContain('agent_architect')
    })

    it('returns 400 when agentId missing', async () => {
      const a = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'P',
        payload: validPrd as any,
      })
      const res = await ownerApp.request(`/api/v1/artifacts/${a.id}/consume`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('POST /artifacts/:id/link + backlinks', () => {
    it('creates a ref and resolves backlinks', async () => {
      const prd = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'P',
        payload: validPrd as any,
      })
      const design = service.create({
        sessionId: null,
        kind: 'design-doc',
        title: 'D',
        payload: validDesign as any,
      })
      const linkRes = await ownerApp.request(
        `/api/v1/artifacts/${design.id}/link`,
        {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ toId: prd.id, type: 'derives_from' }),
        },
      )
      expect(linkRes.status).toBe(201)

      const backRes = await ownerApp.request(`/api/v1/artifacts/${prd.id}/backlinks`)
      expect(backRes.status).toBe(200)
      const backs = (await backRes.json()) as any[]
      expect(backs).toHaveLength(1)
      expect(backs[0]!.id).toBe(design.id)
    })

    it('returns 400 on invalid ref type', async () => {
      const a = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'P',
        payload: validPrd as any,
      })
      const b = service.create({
        sessionId: null,
        kind: 'design-doc',
        title: 'D',
        payload: validDesign as any,
      })
      const res = await ownerApp.request(`/api/v1/artifacts/${a.id}/link`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ toId: b.id, type: 'bogus' }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 404 on missing target', async () => {
      const a = service.create({
        sessionId: null,
        kind: 'prd',
        title: 'P',
        payload: validPrd as any,
      })
      const res = await ownerApp.request(`/api/v1/artifacts/${a.id}/link`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ toId: 'nope', type: 'derives_from' }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /artifacts/by-session/:sessionId and /by-kind/:kind', () => {
    beforeEach(() => {
      service.create({ sessionId: 's1', kind: 'prd', title: 'P1', payload: validPrd as any })
      service.create({ sessionId: 's1', kind: 'design-doc', title: 'D1', payload: validDesign as any })
      service.create({ sessionId: 's2', kind: 'prd', title: 'P2', payload: validPrd as any })
    })

    it('lists by session', async () => {
      const res = await ownerApp.request('/api/v1/artifacts/by-session/s1')
      expect(res.status).toBe(200)
      const body = (await res.json()) as any[]
      expect(body).toHaveLength(2)
    })

    it('lists by kind, optionally filtered by session', async () => {
      const all = (await (
        await ownerApp.request('/api/v1/artifacts/by-kind/prd')
      ).json()) as any[]
      expect(all).toHaveLength(2)

      const scoped = (await (
        await ownerApp.request('/api/v1/artifacts/by-kind/prd?sessionId=s2')
      ).json()) as any[]
      expect(scoped).toHaveLength(1)
      expect(scoped[0]!.title).toBe('P2')
    })

    it('returns 400 on unknown kind', async () => {
      const res = await ownerApp.request('/api/v1/artifacts/by-kind/bogus')
      expect(res.status).toBe(400)
    })
  })
})
