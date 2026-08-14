// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createClientWikiTables } from '../../../src/modules/client-wiki/schema.js'
import { createClientWikiService } from '../../../src/modules/client-wiki/wiki-service.js'
import { createClientWikiRoutes } from '../../../src/modules/client-wiki/routes.js'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { errorHandler } from '@core/http/middleware/error-handler'
import type { AppAbility } from '@modules/permissions/roles'
import type { RoleId } from '@modules/permissions/types'

function createTestApp(
  service: ReturnType<typeof createClientWikiService>,
  ability: AppAbility,
) {
  const app = new Hono<{ Variables: { ability: AppAbility } }>()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('ability', ability)
    await next()
  })
  const logger = { info: () => {}, warn: () => {}, error: () => {} } as any
  createClientWikiRoutes(app, service, logger)
  return app
}

describe('Client wiki routes', () => {
  let db: ReturnType<typeof createMemoryDb>
  let service: ReturnType<typeof createClientWikiService>
  let ownerApp: Hono<any>
  let guestApp: Hono<any>

  beforeEach(() => {
    db = createMemoryDb()
    createClientWikiTables(db)
    service = createClientWikiService(db)
    const registry = createPermissionRegistry()
    const ownerAbility = buildAbilityForRole('owner' as RoleId, registry)
    const guestAbility = buildAbilityForRole('guest' as RoleId, registry)
    ownerApp = createTestApp(service, ownerAbility)
    guestApp = createTestApp(service, guestAbility)
  })

  const json = { 'Content-Type': 'application/json' }

  describe('permission enforcement', () => {
    it('denies guest on GET list (403)', async () => {
      const res = await guestApp.request('/api/v1/client-wiki/acme/pages')
      expect(res.status).toBe(403)
    })

    it('denies guest on POST create (403)', async () => {
      const res = await guestApp.request('/api/v1/client-wiki/acme/pages', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ title: 'T', contentMd: 'x' }),
      })
      expect(res.status).toBe(403)
    })

    it('returns 401 when no ability is set', async () => {
      const bare = new Hono()
      bare.onError(errorHandler)
      createClientWikiRoutes(bare, service, { info: () => {} } as any)
      const res = await bare.request('/api/v1/client-wiki/acme/pages')
      expect(res.status).toBe(401)
    })
  })

  describe('POST /pages', () => {
    it('creates a page (201)', async () => {
      const res = await ownerApp.request('/api/v1/client-wiki/acme/pages', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ title: 'Overview', contentMd: 'hello', tags: ['core'] }),
      })
      expect(res.status).toBe(201)
      const page = await res.json() as any
      expect(page.id).toBeTruthy()
      expect(page.clientId).toBe('acme')
      expect(page.slug).toBe('overview')
      expect(page.tags).toEqual(['core'])
    })

    it('returns 400 when required fields missing', async () => {
      const r1 = await ownerApp.request('/api/v1/client-wiki/acme/pages', {
        method: 'POST', headers: json, body: JSON.stringify({ contentMd: 'x' }),
      })
      expect(r1.status).toBe(400)

      const r2 = await ownerApp.request('/api/v1/client-wiki/acme/pages', {
        method: 'POST', headers: json, body: JSON.stringify({ title: 'T' }),
      })
      expect(r2.status).toBe(400)
    })

    it('returns 409 on duplicate (clientId, slug)', async () => {
      await ownerApp.request('/api/v1/client-wiki/acme/pages', {
        method: 'POST', headers: json,
        body: JSON.stringify({ title: 'Overview', contentMd: 'a' }),
      })
      const res = await ownerApp.request('/api/v1/client-wiki/acme/pages', {
        method: 'POST', headers: json,
        body: JSON.stringify({ title: 'Overview', contentMd: 'b' }),
      })
      expect(res.status).toBe(409)
    })
  })

  describe('GET /pages/:slug', () => {
    beforeEach(() => {
      service.createPage({ clientId: 'acme', title: 'Architecture', contentMd: '# hi\n\nbody' })
    })

    it('returns a page', async () => {
      const res = await ownerApp.request('/api/v1/client-wiki/acme/pages/architecture')
      expect(res.status).toBe(200)
      const body = await res.json() as any
      expect(body.title).toBe('Architecture')
    })

    it('returns 404 for missing page', async () => {
      const res = await ownerApp.request('/api/v1/client-wiki/acme/pages/does-not-exist')
      expect(res.status).toBe(404)
    })

    it('returns rendered HTML with ?render=html', async () => {
      const res = await ownerApp.request('/api/v1/client-wiki/acme/pages/architecture?render=html')
      expect(res.status).toBe(200)
      const body = await res.json() as any
      expect(body.html).toContain('<h1>hi</h1>')
      expect(body.html).toContain('<p>body</p>')
    })
  })

  describe('GET /pages list and search', () => {
    beforeEach(() => {
      service.createPage({ clientId: 'acme', title: 'A', contentMd: 'lorem' })
      service.createPage({ clientId: 'acme', title: 'B', contentMd: 'ipsum' })
      service.createPage({ clientId: 'beta', title: 'C', contentMd: 'scoped' })
    })

    it('lists pages for a client', async () => {
      const res = await ownerApp.request('/api/v1/client-wiki/acme/pages')
      expect(res.status).toBe(200)
      const pages = await res.json() as any[]
      expect(pages).toHaveLength(2)
    })

    it('search returns matches by content', async () => {
      const res = await ownerApp.request('/api/v1/client-wiki/acme/search?q=ipsum')
      expect(res.status).toBe(200)
      const hits = await res.json() as any[]
      expect(hits).toHaveLength(1)
      expect(hits[0].title).toBe('B')
    })
  })

  describe('PUT /pages/:slug', () => {
    it('updates and creates a revision when content changes', async () => {
      await ownerApp.request('/api/v1/client-wiki/acme/pages', {
        method: 'POST', headers: json,
        body: JSON.stringify({ title: 'T', contentMd: 'v1' }),
      })
      const res = await ownerApp.request('/api/v1/client-wiki/acme/pages/t', {
        method: 'PUT', headers: json,
        body: JSON.stringify({ contentMd: 'v2', changeSummary: 'edit', author: 'carol' }),
      })
      expect(res.status).toBe(200)
      const updated = await res.json() as any
      expect(updated.contentMd).toBe('v2')
      expect(updated.updatedBy).toBe('carol')

      const hist = await ownerApp.request('/api/v1/client-wiki/acme/pages/t/history')
      const revs = await hist.json() as any[]
      expect(revs).toHaveLength(2)
      expect(revs[0].changeSummary).toBe('edit')
    })

    it('returns 404 for missing page', async () => {
      const res = await ownerApp.request('/api/v1/client-wiki/acme/pages/no-such', {
        method: 'PUT', headers: json,
        body: JSON.stringify({ contentMd: 'x' }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /pages/:slug', () => {
    it('deletes an existing page (204) and returns 404 afterwards', async () => {
      service.createPage({ clientId: 'acme', title: 'Gone', contentMd: 'x' })
      const del = await ownerApp.request('/api/v1/client-wiki/acme/pages/gone', { method: 'DELETE' })
      expect(del.status).toBe(204)
      const get = await ownerApp.request('/api/v1/client-wiki/acme/pages/gone')
      expect(get.status).toBe(404)
    })

    it('returns 404 when nothing to delete', async () => {
      const res = await ownerApp.request('/api/v1/client-wiki/acme/pages/missing', { method: 'DELETE' })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /pages/:slug/backlinks', () => {
    it('returns pages linking TO the target', async () => {
      const a = service.createPage({ clientId: 'acme', title: 'A', contentMd: 'x' })
      const b = service.createPage({ clientId: 'acme', title: 'B', contentMd: 'x' })
      service.addLink(a.id, b.id, 'mentions')
      const res = await ownerApp.request('/api/v1/client-wiki/acme/pages/b/backlinks')
      expect(res.status).toBe(200)
      const backs = await res.json() as any[]
      expect(backs).toHaveLength(1)
      expect(backs[0].title).toBe('A')
    })
  })
})
