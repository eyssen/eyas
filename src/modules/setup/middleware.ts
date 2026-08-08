import type { MiddlewareHandler } from 'hono'
import type { SetupRegistry } from './types.js'

export function setupGuard(registry: SetupRegistry): MiddlewareHandler {
  return async (c, next) => {
    if (registry.isComplete()) {
      return next()
    }
    const path = c.req.path
    if (path.startsWith('/api/v1/setup') || path === '/api/v1/health') {
      return next()
    }
    return c.json({ error: 'Setup required', setupRequired: true }, 503)
  }
}
