// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import { ScopeDeniedError, type Requester, type SecretsRegistry } from './types.js'

function buildRequester(c: any): Requester {
  const userId = c.get('userId') as string | undefined
  if (!userId) throw new HTTPException(401, { message: 'Authentication required' })
  const role = (c.get('role') as string | undefined) ?? 'guest'
  const isAgent = !!c.get('isAgent')
  return { userId, role, isAgent }
}

function rethrowScopeDenied<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    if (err instanceof ScopeDeniedError) {
      throw new HTTPException(403, { message: 'Access denied to this scope' })
    }
    throw err
  })
}

export function createSecretsRoutes(app: Hono, secrets: SecretsRegistry | (() => SecretsRegistry), authenticate?: MiddlewareHandler): void {
  const getSecrets = typeof secrets === 'function' ? secrets : () => secrets
  const router = app as any

  if (authenticate) {
    router.use('/api/v1/secrets/*', authenticate)
  }

  router.get('/api/v1/secrets', requirePermission('read', 'Secret'), async (c: any) => {
    const requester = buildRequester(c)
    const scope = c.req.query('scope') || 'system'

    // Registry enforces the final ACL (DB query level). We still pass through
    // ScopeDeniedError → 403 here so clients get a clean status code.
    const list = await rethrowScopeDenied(() => getSecrets().list(scope, requester))
    return c.json({ secrets: list })
  })

  router.post('/api/v1/secrets', requirePermission('create', 'Secret'), async (c: any) => {
    const requester = buildRequester(c)

    const body = await c.req.json() as { name?: string; scope?: string; value?: string }
    if (!body.name || !body.scope || body.value === undefined) {
      throw new HTTPException(400, { message: 'name, scope, and value are required' })
    }

    const existed = await rethrowScopeDenied(() => getSecrets().has(body.name!, body.scope!, requester))
    await rethrowScopeDenied(() => getSecrets().set(body.name!, body.scope!, body.value!, undefined, requester))
    const list = await rethrowScopeDenied(() => getSecrets().list(body.scope!, requester))
    const meta = list.find(s => s.name === body.name)
    return c.json({ secret: meta }, existed ? 200 : 201)
  })

  router.delete('/api/v1/secrets/:name', requirePermission('delete', 'Secret'), async (c: any) => {
    const requester = buildRequester(c)

    const name = c.req.param('name')
    const scope = c.req.query('scope') || 'system'

    const deleted = await rethrowScopeDenied(() => getSecrets().delete(name, scope, requester))
    if (!deleted) throw new HTTPException(404, { message: 'Secret not found' })
    return c.json({ message: 'Secret deleted' })
  })
}
