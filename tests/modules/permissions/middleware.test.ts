import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { errorHandler } from '@core/http/middleware/error-handler'
import type { AppAbility } from '@modules/permissions/roles'

function createTestApp(ability: AppAbility) {
  const app = new Hono<{ Variables: { ability: AppAbility; userId: string } }>()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('ability', ability)
    c.set('userId', 'test-user-id')
    await next()
  })
  return app
}

describe('requirePermission middleware', () => {
  it('allows request when user has permission', async () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', {
      actions: ['read'],
      defaults: { admin: ['read'] },
    })
    const ability = buildAbilityForRole('admin', registry)
    const app = createTestApp(ability)
    app.get('/test', requirePermission('read', 'task'), (c) => c.json({ ok: true }))

    const res = await app.request('/test')
    expect(res.status).toBe(200)
  })

  it('denies request when user lacks permission', async () => {
    const registry = createPermissionRegistry()
    registry.registerSubject('task', {
      actions: ['read', 'delete'],
      defaults: { guest: ['read'] },
    })
    const ability = buildAbilityForRole('guest', registry)
    const app = createTestApp(ability)
    app.delete('/test', requirePermission('delete', 'task'), (c) => c.json({ ok: true }))

    const res = await app.request('/test', { method: 'DELETE' })
    expect(res.status).toBe(403)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toContain('Forbidden')
  })

  it('returns 401 when no ability is set (unauthenticated)', async () => {
    const app = new Hono()
    app.onError(errorHandler)
    app.get('/test', requirePermission('read', 'task'), (c) => c.json({ ok: true }))

    const res = await app.request('/test')
    expect(res.status).toBe(401)
  })
})
