// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createHomeTables } from '@modules/home/schema'
import { createLayoutService } from '@modules/home/layout-service'
import { createHomeRoutes, type HomeServices } from '@modules/home/routes'
import { DEFAULT_LAYOUT, DEFAULT_LAYOUT_VERSION, factoryWidgetIds } from '@modules/home/default-layout'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import type { RoleId } from '@modules/permissions/types'

const registry = createPermissionRegistry()
const ability = buildAbilityForRole('user' as RoleId, registry)

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any

function mountApp(services: HomeServices) {
  const a = new Hono()
  a.use('*', async (c: any, next: any) => { c.set('userId', 'user-1'); c.set('ability', ability); await next() })
  createHomeRoutes(a, services)
  return a
}

/** One module declaring every factory widget id — used where the test's point is "the full factory layout", not the I-1 filtering itself. */
function allFactoryWidgetsListModules() {
  return [{ id: 'every-module', frontend: { widgets: factoryWidgetIds().map((id) => ({ id, titleKey: 'k' })) }, enabled: true }]
}

let app: Hono
let layouts: ReturnType<typeof createLayoutService>

beforeEach(() => {
  const db = createMemoryDb()
  createHomeTables(db)
  layouts = createLayoutService(db)
  app = mountApp({
    layouts,
    listModules: () => [{ id: 'scheduler', frontend: { widgets: [{ id: 'scheduler.upcoming', titleKey: 'k' }] }, enabled: true }],
    logger: noopLogger,
  })
})

describe('GET /api/v1/home/layout', () => {
  it('serves the factory layout when the user has no row', async () => {
    const fullApp = mountApp({ layouts, listModules: allFactoryWidgetsListModules, logger: noopLogger })
    const res = await fullApp.request('/api/v1/home/layout?breakpoint=lg')
    const body = await res.json()
    expect(body.source).toBe('factory')
    expect(body.items).toEqual(DEFAULT_LAYOUT)
    expect(body.newWidgets).toEqual([])
  })

  it('offers newly shipped factory widgets to a customised user without inserting them', async () => {
    // Two declared widgets here (not just `scheduler.upcoming`, as the
    // module-level `app` mocks) so the offer itself has something to point
    // at: `costops.summary` is what the user already placed, and
    // `scheduler.upcoming` is what factoryWidgetIds() can still offer.
    const twoWidgetApp = mountApp({
      layouts,
      listModules: () => [
        { id: 'scheduler', frontend: { widgets: [{ id: 'scheduler.upcoming', titleKey: 'k' }] }, enabled: true },
        { id: 'costops', frontend: { widgets: [{ id: 'costops.summary', titleKey: 'k' }] }, enabled: true },
      ],
      logger: noopLogger,
    })
    layouts.save('user-1', 'lg', [{ i: 'costops.summary#1', x: 0, y: 0, w: 3, h: 2 }], DEFAULT_LAYOUT_VERSION - 1)
    const res = await twoWidgetApp.request('/api/v1/home/layout?breakpoint=lg')
    const body = await res.json()
    expect(body.source).toBe('custom')
    expect(body.items).toHaveLength(1)                       // nothing was inserted
    expect(body.newWidgets.length).toBeGreaterThan(0)        // but the offer is present
  })

  it('does not return an item whose module is no longer declared, though the row still holds it', async () => {
    // `research.digest` is not in the mocked catalogue (only `scheduler.upcoming`
    // is) — simulating a widget saved while its module was enabled, then the
    // module got disabled.
    layouts.save('user-1', 'lg', [{ i: 'research.digest#1', x: 0, y: 0, w: 3, h: 2 }])
    const res = await app.request('/api/v1/home/layout?breakpoint=lg')
    const body = await res.json()
    expect(body.items).toEqual([])
    // The row itself is untouched — this is what makes re-enabling possible.
    expect(layouts.get('user-1', 'lg')?.items).toEqual([{ i: 'research.digest#1', x: 0, y: 0, w: 3, h: 2 }])
  })

  it('re-declaring the module makes the hidden item reappear, at its original position and config', async () => {
    const hiddenItem = { i: 'research.digest#1', x: 2, y: 3, w: 4, h: 5, config: { limit: 7 } }
    layouts.save('user-1', 'lg', [hiddenItem])

    const withResearch = mountApp({
      layouts,
      listModules: () => [
        { id: 'scheduler', frontend: { widgets: [{ id: 'scheduler.upcoming', titleKey: 'k' }] }, enabled: true },
        { id: 'research', frontend: { widgets: [{ id: 'research.digest', titleKey: 'k' }] }, enabled: true },
      ],
      logger: noopLogger,
    })
    const body = await (await withResearch.request('/api/v1/home/layout?breakpoint=lg')).json()
    expect(body.items).toEqual([hiddenItem])
  })

  it('filters the factory layout to declared widgets too (I-1)', async () => {
    // The default `app` fixture only declares `scheduler.upcoming` — every
    // other factory tile's module is "not installed" from its point of view.
    const res = await app.request('/api/v1/home/layout?breakpoint=lg')
    const body = await res.json()
    expect(body.source).toBe('factory')
    expect(body.items).toEqual(DEFAULT_LAYOUT.filter((item) => item.i.startsWith('scheduler.upcoming#')))
  })

  it('rejects an invalid breakpoint query parameter (I-3)', async () => {
    const res = await app.request('/api/v1/home/layout?breakpoint=xl')
    expect(res.status).toBe(400)
  })

  it('serves the factory layout when the stored items are unparseable JSON', async () => {
    const db = createMemoryDb()
    createHomeTables(db)
    const { sql } = await import('drizzle-orm')
    db.run(sql`INSERT INTO home_layouts (user_id, breakpoint, items, base_version, updated_at)
               VALUES ('user-1', 'lg', 'not-json{', 0, datetime('now'))`)
    const corruptLayouts = createLayoutService(db)
    const corruptApp = mountApp({
      layouts: corruptLayouts,
      listModules: allFactoryWidgetsListModules,
      logger: noopLogger,
    })
    const res = await corruptApp.request('/api/v1/home/layout?breakpoint=lg')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('factory')
    expect(body.items).toEqual(DEFAULT_LAYOUT)
  })
})

describe('PUT /api/v1/home/layout', () => {
  it('rejects an unknown widget id', async () => {
    const res = await app.request('/api/v1/home/layout', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ breakpoint: 'lg', items: [{ i: 'nope.fake#1', x: 0, y: 0, w: 3, h: 2 }] }),
    })
    expect(res.status).toBe(400)
    expect(layouts.get('user-1', 'lg')).toBeNull()
  })

  it('rejects out-of-range geometry', async () => {
    const res = await app.request('/api/v1/home/layout', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ breakpoint: 'lg', items: [{ i: 'scheduler.upcoming#1', x: 0, y: 0, w: 99, h: 2 }] }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts a valid layout and stamps the current factory version', async () => {
    const res = await app.request('/api/v1/home/layout', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ breakpoint: 'lg', items: [{ i: 'scheduler.upcoming#1', x: 0, y: 0, w: 4, h: 3 }] }),
    })
    expect(res.status).toBe(200)
    expect(layouts.get('user-1', 'lg')?.baseVersion).toBe(DEFAULT_LAYOUT_VERSION)
  })

  it('rejects a malformed (non-JSON) body with 400 instead of 500 (I-2)', async () => {
    const res = await app.request('/api/v1/home/layout', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not-json{',
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_layout')
  })

  it('rejects an oversized config (over 4096 bytes serialised)', async () => {
    const res = await app.request('/api/v1/home/layout', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        breakpoint: 'lg',
        items: [{ i: 'scheduler.upcoming#1', x: 0, y: 0, w: 4, h: 3, config: { blob: 'x'.repeat(4100) } }],
      }),
    })
    expect(res.status).toBe(400)
  })

  it('preserves a hidden (currently-undeclared) item across a save that never mentions it', async () => {
    // `research.digest` is undeclared in this test's `app` — the client can
    // never have known about it (GET hides it), so it cannot appear in the
    // PUT body. It must still survive the save.
    const hiddenItem = { i: 'research.digest#1', x: 6, y: 6, w: 2, h: 2, config: { foo: 'bar' } }
    layouts.save('user-1', 'lg', [hiddenItem])

    const res = await app.request('/api/v1/home/layout', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ breakpoint: 'lg', items: [{ i: 'scheduler.upcoming#1', x: 0, y: 0, w: 4, h: 3 }] }),
    })
    expect(res.status).toBe(200)

    const stored = layouts.get('user-1', 'lg')
    expect(stored?.items).toEqual(
      expect.arrayContaining([{ i: 'scheduler.upcoming#1', x: 0, y: 0, w: 4, h: 3 }, hiddenItem]),
    )
    expect(stored?.items).toHaveLength(2)
  })

  it('preserves a tile from a now-disabled module (D4 guard with disabled modules)', async () => {
    // A tile was saved when its module was enabled, then the module got disabled.
    // GET should not return it, but PUT should preserve it so re-enabling is possible.
    const itemFromDisabledModule = { i: 'disabled.widget#1', x: 1, y: 1, w: 3, h: 2 }
    layouts.save('user-1', 'lg', [itemFromDisabledModule])

    // Request with a modified listModules that disables the module
    const appWithDisabled = mountApp({
      layouts,
      listModules: () => [
        { id: 'scheduler', frontend: { widgets: [{ id: 'scheduler.upcoming', titleKey: 'k' }] }, enabled: true },
        { id: 'disabled', frontend: { widgets: [{ id: 'disabled.widget', titleKey: 'k' }] }, enabled: false },
      ],
      logger: noopLogger,
    })

    // GET should not return the disabled widget
    const getRes = await appWithDisabled.request('/api/v1/home/layout?breakpoint=lg')
    const getBody = await getRes.json()
    expect(getBody.items).not.toContainEqual(itemFromDisabledModule)

    // PUT without mentioning the disabled widget should still preserve it
    const putRes = await appWithDisabled.request('/api/v1/home/layout', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ breakpoint: 'lg', items: [{ i: 'scheduler.upcoming#1', x: 0, y: 0, w: 4, h: 3 }] }),
    })
    expect(putRes.status).toBe(200)

    const stored = layouts.get('user-1', 'lg')
    expect(stored?.items).toContainEqual(itemFromDisabledModule)
  })
})

describe('DELETE /api/v1/home/layout', () => {
  it('restores the factory layout', async () => {
    layouts.save('user-1', 'lg', [{ i: 'cost.summary#1', x: 0, y: 0, w: 3, h: 2 }])
    await app.request('/api/v1/home/layout?breakpoint=lg', { method: 'DELETE' })
    const body = await (await app.request('/api/v1/home/layout?breakpoint=lg')).json()
    expect(body.source).toBe('factory')
  })
})
