import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppAbility } from './roles.js'

/**
 * Hono middleware that enforces CASL permission checks.
 * Expects `ability` to be set on the context (typically by the auth middleware).
 * Returns 401 if no ability is present (unauthenticated), 403 if the action is denied.
 */
export const requirePermission = (action: string, subject: string): MiddlewareHandler => {
  return async (c, next) => {
    const ability = c.get('ability') as AppAbility | undefined
    if (!ability) {
      throw new HTTPException(401, { message: 'Unauthorized' })
    }
    if (!ability.can(action, subject)) {
      throw new HTTPException(403, { message: `Forbidden: cannot ${action} ${subject}` })
    }
    await next()
  }
}
