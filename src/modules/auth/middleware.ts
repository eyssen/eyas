import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getCookie } from 'hono/cookie'
import { sha256 } from '@shared/crypto'
import { isApiKeyFormat } from './api-key.js'
import type { AppAbility } from '@modules/permissions/roles'

export interface AuthMiddlewareDeps {
  verifyAccessToken(token: string): Promise<{ sub: string; role: string }>
  findSessionByHash(hash: string): Promise<{ userId: string; expiresAt: string } | null>
  findApiKeyByHash(hash: string): Promise<{ userId: string } | null>
  findUserById(id: string): Promise<{ id: string; role: string; status: string } | null>
  buildAbilityForUser(role: string): AppAbility
}

export function createAuthMiddleware(deps: AuthMiddlewareDeps): MiddlewareHandler {
  return async (c, next) => {
    // 1. Try session cookie
    const sessionToken = getCookie(c, 'eyas_session')
    if (sessionToken) {
      const hash = await sha256(sessionToken)
      const session = await deps.findSessionByHash(hash)
      if (session) {
        if (new Date(session.expiresAt) < new Date()) {
          throw new HTTPException(401, { message: 'Session expired' })
        }
        const user = await deps.findUserById(session.userId)
        if (!user || user.status !== 'active') {
          throw new HTTPException(403, { message: 'Account suspended or deleted' })
        }
        c.set('userId', user.id)
        c.set('role', user.role)
        c.set('ability', deps.buildAbilityForUser(user.role))
        c.set('authMethod', 'session')
        return next()
      }
    }

    // 2. Try Authorization header
    const authHeader = c.req.header('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)

      // 2a. API key
      if (isApiKeyFormat(token)) {
        const hash = await sha256(token)
        const apiKey = await deps.findApiKeyByHash(hash)
        if (!apiKey) {
          throw new HTTPException(401, { message: 'Invalid API key' })
        }
        const user = await deps.findUserById(apiKey.userId)
        if (!user || user.status !== 'active') {
          throw new HTTPException(403, { message: 'Account suspended or deleted' })
        }
        c.set('userId', user.id)
        c.set('role', user.role)
        c.set('ability', deps.buildAbilityForUser(user.role))
        c.set('authMethod', 'api_key')
        return next()
      }

      // 2b. JWT
      try {
        const payload = await deps.verifyAccessToken(token)
        const user = await deps.findUserById(payload.sub)
        if (!user || user.status !== 'active') {
          throw new HTTPException(403, { message: 'Account suspended or deleted' })
        }
        c.set('userId', user.id)
        c.set('role', user.role)
        c.set('ability', deps.buildAbilityForUser(user.role))
        c.set('authMethod', 'jwt')
        return next()
      } catch (err) {
        if (err instanceof HTTPException) throw err
        throw new HTTPException(401, { message: 'Invalid or expired token' })
      }
    }

    // 3. No auth
    throw new HTTPException(401, { message: 'Authentication required' })
  }
}

export const csrfProtection: MiddlewareHandler = async (c, next) => {
  const method = c.req.method
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next()
  }
  const hasCookie = c.req.header('Cookie')?.includes('eyas_session')
  if (hasCookie && !c.req.header('X-Eyas-Request')) {
    throw new HTTPException(403, { message: 'CSRF protection: X-Eyas-Request header required' })
  }
  return next()
}
