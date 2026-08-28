// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { setCookie, deleteCookie } from 'hono/cookie'
import { sql } from 'drizzle-orm'
import { generateId, sha256 } from '@shared/crypto'
import { hashPassword, verifyPassword } from '@modules/auth/providers/local'
import { generateApiKey, getKeyPrefix, hashApiKey } from '@modules/auth/api-key'
import { createAuthMiddleware, csrfProtection } from '@modules/auth/middleware'
import {
  loginSchema,
  createUserSchema,
  updateUserSchema,
  updateProfileSchema,
  createApiKeySchema,
  refreshTokenSchema,
} from '@modules/auth/types'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { requirePermission } from '@modules/permissions/middleware'
import { isRoleAtLeast } from '@modules/permissions/types'
import type { PermissionRegistry } from '@modules/permissions/registry'
import type { TokenService } from '@modules/auth/token'
import type { RoleId } from '@modules/permissions/types'
import { createRateLimitMiddleware } from '@core/http/middleware/rate-limit'

export interface AuthRouteDeps {
  db: any
  registry: PermissionRegistry
  tokenService: TokenService
  sessionDuration: number
  accessTokenDuration: number
  refreshTokenDuration: number
  /**
   * D14 — closes a user's live WebSocket sockets on logout/suspend/archive.
   * Lazy by necessity: ctx.wsRegistry is only created post-bootstrap in
   * main.ts/serve.ts, well after this route module is wired, so the caller
   * passes a closure that resolves it fresh at call time. Best-effort —
   * failures must never fail the auth action itself.
   */
  closeUserSockets?: (userId: string) => void
}

interface UserRow {
  id: string
  username: string
  display_name: string
  email: string | null
  password_hash: string | null
  role: string
  is_root_owner: number
  is_agent: number
  agent_definition_id: string | null
  status: string
  created_at: string
  updated_at: string
}

function userToPublic(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    email: u.email,
    role: u.role,
    isRootOwner: !!u.is_root_owner,
    isAgent: !!u.is_agent,
    agentDefinitionId: u.agent_definition_id ?? null,
    status: u.status,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  }
}

// drizzle-orm/bun-sqlite: db.get() returns arrays, db.all() returns objects
// Use db.all() + [0] for single-row queries to get named columns
function getOne<T>(db: any, query: any): T | undefined {
  const rows = db.all(query) as T[]
  return rows[0]
}

type AuthEnv = {
  Variables: {
    userId: string
    role: string
    ability: any
    authMethod: string
  }
}

export function createAuthRoutes(app: Hono, deps: AuthRouteDeps): void {
  const router = app as unknown as Hono<AuthEnv>
  const { db, registry, tokenService, sessionDuration, accessTokenDuration, refreshTokenDuration } = deps

  // ─── Middleware ───────────────────────────────────────

  const authenticate = createAuthMiddleware({
    verifyAccessToken: (token) => tokenService.verifyAccessToken(token),
    findSessionByHash: async (hash) => {
      const s = getOne<{ user_id: string; expires_at: string }>(
        db, sql`SELECT * FROM sessions WHERE token_hash = ${hash}`
      )
      return s ? { userId: s.user_id, expiresAt: s.expires_at } : null
    },
    findApiKeyByHash: async (hash) => {
      const now = new Date().toISOString()
      const k = getOne<{ user_id: string; key_hash: string }>(
        db, sql`SELECT * FROM api_keys WHERE key_hash = ${hash} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ${now})`
      )
      if (k) {
        db.run(sql`UPDATE api_keys SET last_used_at = ${new Date().toISOString()} WHERE key_hash = ${hash}`)
        return { userId: k.user_id }
      }
      return null
    },
    findUserById: async (id) => {
      const u = getOne<UserRow>(db, sql`SELECT * FROM users WHERE id = ${id}`)
      return u ? { id: u.id, role: u.role, status: u.status } : null
    },
    buildAbilityForUser: (role) => buildAbilityForRole(role as RoleId, registry),
  })

  // ─── Deny-by-default authentication ──────────────────
  // Every /api/v1 route requires auth UNLESS it is on the explicit public list.
  // This makes new modules secure by default — they no longer need to be added
  // to a per-prefix allowlist to be protected. The per-prefix
  // router.use(..., authenticate) lines below are now redundant for coverage
  // (authenticate simply runs again, idempotently) but are kept because they
  // also pair csrfProtection; they can be pruned once verified end-to-end.
  const isPublicApiRoute = (path: string): boolean => {
    if (path === '/api/v1/health') return true
    if (path === '/api/v1/setup' || path.startsWith('/api/v1/setup/')) return true
    if (path === '/api/v1/auth/login') return true
    if (path === '/api/v1/auth/token') return true
    if (path === '/api/v1/auth/token/refresh') return true
    // Device pairing: the one-time pairing code is the credential.
    // NOTE: /api/v1/hands/pair/generate stays protected (issues codes).
    if (path === '/api/v1/hands/pair') return true
    // Inbound WhatsApp webhook: authenticated by verify-token / HMAC signature,
    // not a session — the provider cannot present our bearer/cookie.
    if (path === '/api/v1/webhooks/whatsapp') return true
    return false
  }
  router.use('/api/v1/*', async (c, next) => {
    if (isPublicApiRoute(c.req.path)) return next()
    return authenticate(c, next)
  })

  // Auth + CSRF on secrets endpoints (registered here because auth module owns the middleware)
  router.use('/api/v1/secrets/*', authenticate)
  router.use('/api/v1/secrets/*', csrfProtection)

  // Auth + CSRF on model endpoints
  router.use('/api/v1/model/*', authenticate)
  router.use('/api/v1/model/*', csrfProtection)

  // Auth + CSRF on home endpoints (layout GET/PUT/DELETE, widgets, pulse,
  // setup-status, layout/ack-version POST). Redundant with the deny-by-default
  // catch-all above for `authenticate` coverage, but the catch-all does NOT
  // apply csrfProtection — this pairing is the only thing guarding the
  // mutating PUT/DELETE/POST layout routes against CSRF. Listed here (rather
  // than relying on the catch-all alone) to follow this file's convention and
  // to make the CSRF decision for this prefix explicit and reviewable.
  router.use('/api/v1/home/*', authenticate)
  router.use('/api/v1/home/*', csrfProtection)

  // Auth + CSRF on the brand endpoints — the PUT/POST/DELETE routes mutate a
  // shared design system, so the pairing is explicit here rather than left to
  // the deny-by-default catch-all (which applies `authenticate` only).
  router.use('/api/v1/brands/*', authenticate)
  router.use('/api/v1/brands/*', csrfProtection)

  // Auth + CSRF on the design endpoints — the mutating routes store
  // AI-authored HTML that later executes in a sandboxed iframe, so the pairing
  // is explicit here rather than left to the deny-by-default catch-all.
  router.use('/api/v1/designs/*', authenticate)
  router.use('/api/v1/designs/*', csrfProtection)

  // Auth + CSRF on God Mode roster (Settings PUT)
  router.use('/api/v1/god-mode/*', authenticate)
  router.use('/api/v1/god-mode/*', csrfProtection)

  // Auth + CSRF on conversation endpoints
  router.use('/api/v1/conversations/*', authenticate)
  router.use('/api/v1/conversations/*', csrfProtection)

  // Auth + CSRF on board endpoints
  router.use('/api/v1/project-types', authenticate)
  router.use('/api/v1/project-types', csrfProtection)
  router.use('/api/v1/project-types/*', authenticate)
  router.use('/api/v1/project-types/*', csrfProtection)
  router.use('/api/v1/projects', authenticate)
  router.use('/api/v1/projects', csrfProtection)
  router.use('/api/v1/projects/*', authenticate)
  router.use('/api/v1/projects/*', csrfProtection)
  router.use('/api/v1/stages', authenticate)
  router.use('/api/v1/stages', csrfProtection)
  router.use('/api/v1/stages/*', authenticate)
  router.use('/api/v1/stages/*', csrfProtection)

  // Auth + CSRF on documents endpoints
  router.use('/api/v1/documents', authenticate)
  router.use('/api/v1/documents', csrfProtection)
  router.use('/api/v1/documents/*', authenticate)
  router.use('/api/v1/documents/*', csrfProtection)

  // Auth + CSRF on knowledge endpoints
  router.use('/api/v1/knowledge/*', authenticate)
  router.use('/api/v1/knowledge/*', csrfProtection)

  // Auth + CSRF on memory endpoints
  router.use('/api/v1/memory/*', authenticate)
  router.use('/api/v1/memory/*', csrfProtection)

  // Auth + CSRF on search endpoints
  router.use('/api/v1/search', authenticate)
  router.use('/api/v1/search', csrfProtection)
  router.use('/api/v1/search/*', authenticate)
  router.use('/api/v1/search/*', csrfProtection)

  // Auth + CSRF on activity endpoints
  router.use('/api/v1/activities', authenticate)
  router.use('/api/v1/activities', csrfProtection)
  router.use('/api/v1/activities/*', authenticate)
  router.use('/api/v1/activities/*', csrfProtection)
  router.use('/api/v1/activity-types', authenticate)
  router.use('/api/v1/activity-types', csrfProtection)

  // Auth + CSRF on chatter endpoints
  router.use('/api/v1/chatter/*', authenticate)
  router.use('/api/v1/chatter/*', csrfProtection)

  // Auth + CSRF on agent endpoints
  router.use('/api/v1/agents', authenticate)
  router.use('/api/v1/agents', csrfProtection)
  router.use('/api/v1/agents/*', authenticate)
  router.use('/api/v1/agents/*', csrfProtection)
  // Singular /api/v1/agent/* (run supervision: runs/:id/cancel|retry|refresh) —
  // a distinct prefix from plural /agents, so it needs its own CSRF coverage.
  router.use('/api/v1/agent/*', authenticate)
  router.use('/api/v1/agent/*', csrfProtection)

  // Auth + CSRF on event-store endpoints (agent event histories + snapshots)
  router.use('/api/v1/events/*', authenticate)
  router.use('/api/v1/events/*', csrfProtection)

  // Auth + CSRF on mission-control endpoints (agent fleet snapshot + controls)
  router.use('/api/v1/mission-control/*', authenticate)
  router.use('/api/v1/mission-control/*', csrfProtection)

  // Auth + CSRF on tools endpoints
  router.use('/api/v1/tools', authenticate)
  router.use('/api/v1/tools', csrfProtection)
  router.use('/api/v1/tools/*', authenticate)
  router.use('/api/v1/tools/*', csrfProtection)

  // Auth + CSRF on skills endpoints
  router.use('/api/v1/skills', authenticate)
  router.use('/api/v1/skills', csrfProtection)
  router.use('/api/v1/skills/*', authenticate)
  router.use('/api/v1/skills/*', csrfProtection)

  // Auth + CSRF on scheduler endpoints
  router.use('/api/v1/scheduler/*', authenticate)
  router.use('/api/v1/scheduler/*', csrfProtection)

  // Auth + CSRF on security endpoints
  router.use('/api/v1/security/*', authenticate)
  router.use('/api/v1/security/*', csrfProtection)

  // Auth + CSRF on autonomy endpoints (human-in-the-loop approval queue:
  // PUT /:key sets the autonomy level, POST /approvals/:id/approve|reject
  // sign off on autonomous actions — all state-changing, so CSRF-guarded
  // like every other mutation prefix).
  router.use('/api/v1/autonomy/*', authenticate)
  router.use('/api/v1/autonomy/*', csrfProtection)

  // Auth + CSRF on self-learning endpoints
  router.use('/api/v1/self-learning/*', authenticate)
  router.use('/api/v1/self-learning/*', csrfProtection)

  // Auth + CSRF on proactive-assistant endpoints
  router.use('/api/v1/proactive/*', authenticate)
  router.use('/api/v1/proactive/*', csrfProtection)

  // Auth + CSRF on prompts endpoints
  router.use('/api/v1/prompts', authenticate)
  router.use('/api/v1/prompts', csrfProtection)
  router.use('/api/v1/prompts/*', authenticate)
  router.use('/api/v1/prompts/*', csrfProtection)

  // Auth + CSRF on tag endpoints
  router.use('/api/v1/tags', authenticate)
  router.use('/api/v1/tags', csrfProtection)
  router.use('/api/v1/tags/*', authenticate)
  router.use('/api/v1/tags/*', csrfProtection)
  router.use('/api/v1/tag-categories', authenticate)
  router.use('/api/v1/tag-categories', csrfProtection)
  router.use('/api/v1/tag-categories/*', authenticate)
  router.use('/api/v1/tag-categories/*', csrfProtection)

  // Auth + CSRF on routing endpoints
  router.use('/api/v1/routing/*', authenticate)
  router.use('/api/v1/routing/*', csrfProtection)

  // Auth + CSRF on research endpoints
  router.use('/api/v1/research', authenticate)
  router.use('/api/v1/research', csrfProtection)
  router.use('/api/v1/research/*', authenticate)
  router.use('/api/v1/research/*', csrfProtection)

  // Auth + CSRF on observability endpoints
  router.use('/api/v1/observability/*', authenticate)
  router.use('/api/v1/observability/*', csrfProtection)

  // Auth + CSRF on audit endpoints
  router.use('/api/v1/audit', authenticate)
  router.use('/api/v1/audit', csrfProtection)
  router.use('/api/v1/audit/*', authenticate)
  router.use('/api/v1/audit/*', csrfProtection)

  // Auth + CSRF on communication endpoints
  router.use('/api/v1/communication/*', authenticate)
  router.use('/api/v1/communication/*', csrfProtection)

  // Auth + CSRF on MCP management endpoints
  router.use('/api/v1/mcp/*', authenticate)
  router.use('/api/v1/mcp/*', csrfProtection)

  // Auth on incoming MCP server endpoints (external agents calling our tools)
  router.use('/mcp/*', authenticate)

  // Auth + CSRF on ingress endpoints
  router.use('/api/v1/ingress/*', authenticate)
  router.use('/api/v1/ingress/*', csrfProtection)

  // Auth + CSRF on remote-node endpoints
  router.use('/api/v1/nodes', authenticate)
  router.use('/api/v1/nodes', csrfProtection)
  router.use('/api/v1/nodes/*', authenticate)
  router.use('/api/v1/nodes/*', csrfProtection)

  // Auth + CSRF on hand hub endpoints (pair endpoint excluded — code is the auth)
  router.use('/api/v1/hands', authenticate)
  router.use('/api/v1/hands', csrfProtection)
  router.use('/api/v1/hands/pair/generate', authenticate)
  router.use('/api/v1/hands/pair/generate', csrfProtection)
  router.use('/api/v1/hands/:handId', authenticate)
  router.use('/api/v1/hands/:handId', csrfProtection)

  // Auth + CSRF on backup endpoints
  router.use('/api/v1/backup/*', authenticate)
  router.use('/api/v1/backup/*', csrfProtection)

  // Auth + CSRF on meetings endpoints
  router.use('/api/v1/meetings', authenticate)
  router.use('/api/v1/meetings', csrfProtection)
  router.use('/api/v1/meetings/*', authenticate)
  router.use('/api/v1/meetings/*', csrfProtection)

  // Auth + CSRF on notification endpoints
  router.use('/api/v1/notifications', authenticate)
  router.use('/api/v1/notifications', csrfProtection)
  router.use('/api/v1/notifications/*', authenticate)
  router.use('/api/v1/notifications/*', csrfProtection)
  router.use('/api/v1/notification-preferences', authenticate)
  router.use('/api/v1/notification-preferences', csrfProtection)
  router.use('/api/v1/notification-webhooks', authenticate)
  router.use('/api/v1/notification-webhooks', csrfProtection)

  // Extensions
  router.use('/api/v1/extensions', authenticate)
  router.use('/api/v1/extensions', csrfProtection)
  router.use('/api/v1/extensions/*', authenticate)
  router.use('/api/v1/extensions/*', csrfProtection)

  // Skill Evolution (deprecated → Forge)
  router.use('/api/v1/skill-evolution/*', authenticate)
  router.use('/api/v1/skill-evolution/*', csrfProtection)

  // Forge (unified evolution)
  router.use('/api/v1/forge/*', authenticate)
  router.use('/api/v1/forge/*', csrfProtection)

  // Channel configs (PATCH sets agent/mode — a privileged mutation, so CSRF too)
  router.use('/api/v1/channels', authenticate)
  router.use('/api/v1/channels', csrfProtection)
  router.use('/api/v1/channels/*', authenticate)
  router.use('/api/v1/channels/*', csrfProtection)

  // CSRF on mutation routes
  router.use('/api/v1/auth/*', csrfProtection)
  router.use('/api/v1/users/*', csrfProtection)
  router.use('/api/v1/api-keys/*', csrfProtection)

  // Brute-force protection on the unauthenticated login endpoint.
  // Per-IP sliding window: 10 attempts per minute. An attacker trying
  // dictionary passwords against a single account is throttled to a
  // rate where even a 100-word list takes 10 minutes per IP; moving
  // to a new IP requires infrastructure the typical script kiddie
  // doesn't have. Honest users get >= 10 retries before the cap bites.
  const loginRateLimit = createRateLimitMiddleware({
    windowMs: 60_000,
    max: 10,
    message: 'Too many login attempts. Try again in a minute.',
  })
  // Bind to EVERY unauthenticated password/refresh endpoint. /auth/token
  // performs the identical getOne+verifyPassword as /auth/login, so it must be
  // throttled too — otherwise an attacker just brute-forces /auth/token. Note
  // the real refresh route is /auth/token/refresh (there is no /auth/refresh).
  router.use('/api/v1/auth/login', loginRateLimit)
  router.use('/api/v1/auth/token', loginRateLimit)
  router.use('/api/v1/auth/token/refresh', loginRateLimit)

  // ─── Login (unauthenticated) ─────────────────────────

  router.post('/api/v1/auth/login', async (c) => {
    const body = await c.req.json()
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues[0].message })
    }

    const { username, password } = parsed.data
    const user = getOne<UserRow>(db, sql`SELECT * FROM users WHERE username = ${username}`)
    if (!user || !user.password_hash) {
      throw new HTTPException(401, { message: 'Invalid credentials' })
    }

    const valid = await verifyPassword(password, user.password_hash)
    if (!valid) {
      throw new HTTPException(401, { message: 'Invalid credentials' })
    }

    if (user.status !== 'active') {
      throw new HTTPException(403, { message: 'Account suspended' })
    }

    // Create session
    const sessionId = generateId()
    const sessionToken = generateId() + generateId()
    const tokenHash = await sha256(sessionToken)
    const expiresAt = new Date(Date.now() + sessionDuration * 1000).toISOString()
    const now = new Date().toISOString()

    db.run(sql`INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES (${sessionId}, ${user.id}, ${tokenHash}, ${expiresAt}, ${now})`)

    const isSecure = c.req.url.startsWith('https')
    setCookie(c, 'eyas_session', sessionToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? 'Strict' : 'Lax',
      path: '/',
      maxAge: sessionDuration,
    })

    return c.json({ user: userToPublic(user) })
  })

  router.post('/api/v1/auth/logout', authenticate, async (c) => {
    const sessionToken = c.req.header('Cookie')?.match(/eyas_session=([^;]+)/)?.[1]
    if (sessionToken) {
      const hash = await sha256(sessionToken)
      db.run(sql`DELETE FROM sessions WHERE token_hash = ${hash}`)
    }
    deleteCookie(c, 'eyas_session', { path: '/' })
    // D14 — a logged-out session must not leave a live socket subscribed to
    // per-user content (notifications:<userId>, etc.). Best-effort: a close
    // failure must never fail the logout itself.
    try { deps.closeUserSockets?.(c.get('userId')) } catch { /* best-effort */ }
    return c.json({ message: 'Logged out' })
  })

  // ─── Token (unauthenticated) ─────────────────────────

  router.post('/api/v1/auth/token', async (c) => {
    const body = await c.req.json()
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues[0].message })
    }

    const { username, password } = parsed.data
    const user = getOne<UserRow>(db, sql`SELECT * FROM users WHERE username = ${username}`)
    if (!user || !user.password_hash) {
      throw new HTTPException(401, { message: 'Invalid credentials' })
    }

    const valid = await verifyPassword(password, user.password_hash)
    if (!valid) {
      throw new HTTPException(401, { message: 'Invalid credentials' })
    }

    const accessToken = await tokenService.signAccessToken(
      { sub: user.id, role: user.role },
      accessTokenDuration
    )
    const refreshToken = tokenService.generateRefreshToken()
    const refreshHash = await sha256(refreshToken)
    const expiresAt = new Date(Date.now() + refreshTokenDuration * 1000).toISOString()
    const now = new Date().toISOString()
    const sessionId = generateId()

    db.run(sql`INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES (${sessionId}, ${user.id}, ${refreshHash}, ${expiresAt}, ${now})`)

    return c.json({
      accessToken,
      refreshToken,
      expiresIn: accessTokenDuration,
    })
  })

  router.post('/api/v1/auth/token/refresh', async (c) => {
    const body = await c.req.json()
    const parsed = refreshTokenSchema.safeParse(body)
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues[0].message })
    }

    const { refreshToken } = parsed.data
    const hash = await sha256(refreshToken)
    const session = getOne<{ user_id: string; expires_at: string }>(
      db, sql`SELECT * FROM sessions WHERE token_hash = ${hash}`
    )

    if (!session) {
      throw new HTTPException(401, { message: 'Invalid refresh token' })
    }
    if (new Date(session.expires_at) < new Date()) {
      throw new HTTPException(401, { message: 'Refresh token expired' })
    }

    const user = getOne<UserRow>(db, sql`SELECT * FROM users WHERE id = ${session.user_id}`)
    if (!user) {
      throw new HTTPException(401, { message: 'User not found' })
    }
    // Re-check account status: a refresh issued while active must stop working
    // once the account is disabled/deleted, otherwise it would keep minting
    // fresh access tokens for a revoked user.
    if (user.status !== 'active') {
      throw new HTTPException(401, { message: 'Account is not active' })
    }

    const accessToken = await tokenService.signAccessToken(
      { sub: user.id, role: user.role },
      accessTokenDuration
    )

    return c.json({
      accessToken,
      expiresIn: accessTokenDuration,
    })
  })

  // ─── WebSocket token (authenticated) ─────────────────
  router.post('/api/v1/auth/ws-token', authenticate, async (c) => {
    const userId = c.get('userId')
    const role = c.get('role') as string
    const token = await deps.tokenService.signAccessToken({ sub: userId, role }, 30) // 30s short-lived
    return c.json({ token })
  })

  // ─── Me (authenticated) ──────────────────────────────

  router.get('/api/v1/auth/me', authenticate, (c) => {
    const userId = c.get('userId')
    const user = getOne<UserRow>(db, sql`SELECT * FROM users WHERE id = ${userId}`)
    if (!user) {
      throw new HTTPException(404, { message: 'User not found' })
    }
    return c.json({ user: userToPublic(user) })
  })

  router.patch('/api/v1/auth/me', authenticate, async (c) => {
    const userId = c.get('userId')
    const body = await c.req.json()
    const parsed = updateProfileSchema.safeParse(body)
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues[0].message })
    }

    const user = getOne<UserRow>(db, sql`SELECT * FROM users WHERE id = ${userId}`)
    if (!user) {
      throw new HTTPException(404, { message: 'User not found' })
    }

    const { displayName, email, currentPassword, newPassword } = parsed.data
    const now = new Date().toISOString()

    if (newPassword) {
      if (!user.password_hash || !currentPassword) {
        throw new HTTPException(400, { message: 'Current password required' })
      }
      const valid = await verifyPassword(currentPassword, user.password_hash)
      if (!valid) {
        throw new HTTPException(400, { message: 'Current password incorrect' })
      }
      const newHash = await hashPassword(newPassword)
      db.run(sql`UPDATE users SET password_hash = ${newHash}, updated_at = ${now} WHERE id = ${userId}`)
    }

    if (displayName !== undefined) {
      db.run(sql`UPDATE users SET display_name = ${displayName}, updated_at = ${now} WHERE id = ${userId}`)
    }

    if (email !== undefined) {
      db.run(sql`UPDATE users SET email = ${email}, updated_at = ${now} WHERE id = ${userId}`)
    }

    const updated = getOne<UserRow>(db, sql`SELECT * FROM users WHERE id = ${userId}`)
    return c.json({ user: userToPublic(updated!) })
  })

  // ─── Users (authenticated, owner/admin) ──────────────

  router.get('/api/v1/users', authenticate, requirePermission('read', 'User'), (c) => {
    const status = c.req.query('status')
    // Default view: active AND suspended users (excludes archived AND legacy 'deleted' rows).
    // '?status=archived': archived view, includes legacy 'deleted' rows so they
    // remain visible/recoverable even though the app no longer produces that status.
    const users = status === 'archived'
      ? db.all(sql`SELECT * FROM users WHERE status IN ('archived', 'deleted') ORDER BY updated_at DESC`) as UserRow[]
      : db.all(sql`SELECT * FROM users WHERE status NOT IN ('archived', 'deleted') ORDER BY created_at ASC`) as UserRow[]
    return c.json({ users: users.map(userToPublic) })
  })

  router.post('/api/v1/users', authenticate, requirePermission('create', 'User'), async (c) => {
    const body = await c.req.json()
    const parsed = createUserSchema.safeParse(body)
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues[0].message })
    }

    const { username, password, displayName, email, role, isAgent } = parsed.data

    if ((role as string) === 'owner') {
      throw new HTTPException(403, { message: 'Cannot create owner role' })
    }

    // Check duplicate username
    const existing = getOne<UserRow>(db, sql`SELECT id FROM users WHERE username = ${username}`)
    if (existing) {
      throw new HTTPException(409, { message: 'Username already exists' })
    }

    const id = generateId()
    const now = new Date().toISOString()
    const passwordHash = password ? await hashPassword(password) : null

    db.run(sql`INSERT INTO users (id, username, display_name, email, password_hash, role, is_root_owner, is_agent, status, created_at, updated_at)
      VALUES (${id}, ${username}, ${displayName}, ${email || null}, ${passwordHash}, ${role}, 0, ${isAgent ? 1 : 0}, 'active', ${now}, ${now})`)

    const user = getOne<UserRow>(db, sql`SELECT * FROM users WHERE id = ${id}`)
    return c.json({ user: userToPublic(user!) }, 201)
  })

  // Create agent-type user + linked agent_definitions in one call
  router.post('/api/v1/users/agents', authenticate, requirePermission('create', 'User'), async (c) => {
    const body = await c.req.json()
    const { name, avatar, email } = body
    if (!name) return c.json({ error: 'name is required' }, 400)

    const agentDefId = generateId()
    const userId = generateId()
    const now = new Date().toISOString()
    const username = name.toLowerCase().replace(/\s+/g, '-')

    // Check username uniqueness
    const existing = getOne<UserRow>(db, sql`SELECT id FROM users WHERE username = ${username}`)
    if (existing) return c.json({ error: 'Username already exists' }, 409)

    // 1. Create agent_definitions record
    db.run(sql`INSERT INTO agent_definitions
      (id, name, role, description, goal, backstory, system_prompt, capabilities, tools, constraints, enabled, source, tier, agent_type, created_at, updated_at)
      VALUES (
        ${agentDefId}, ${name}, ${''},
        ${''}, ${''}, ${''}, ${''},
        ${JSON.stringify([])}, ${JSON.stringify([])}, ${JSON.stringify([])},
        ${1}, ${'user'}, ${'primary'}, ${'assistant'},
        ${now}, ${now}
      )`)

    // 2. Create linked user record
    db.run(sql`INSERT INTO users
      (id, username, display_name, email, password_hash, role, is_root_owner, is_agent, agent_definition_id, status, created_at, updated_at)
      VALUES (${userId}, ${username}, ${name}, ${email ?? null}, ${null}, 'agent', 0, 1, ${agentDefId}, 'active', ${now}, ${now})`)

    const user = getOne<UserRow>(db, sql`SELECT * FROM users WHERE id = ${userId}`)
    return c.json({ user: userToPublic(user!), agentDefinitionId: agentDefId }, 201)
  })

  router.get('/api/v1/users/:id', authenticate, requirePermission('read', 'User'), (c) => {
    const id = c.req.param('id')
    const user = getOne<UserRow>(db, sql`SELECT * FROM users WHERE id = ${id}`)
    if (!user) {
      throw new HTTPException(404, { message: 'User not found' })
    }
    return c.json({ user: userToPublic(user) })
  })

  router.patch('/api/v1/users/:id', authenticate, requirePermission('update', 'User'), async (c) => {
    const id = c.req.param('id')
    const callerId = c.get('userId')
    const callerRole = c.get('role') as RoleId
    const body = await c.req.json()
    const parsed = updateUserSchema.safeParse(body)
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues[0].message })
    }

    // ─── Authorization hardening ──────────────────────────
    // Role 'user'/'agent' hold an unconditional can('update','User') (subject
    // level only — CASL has no per-instance owner condition here), so without
    // these checks any logged-in user could PATCH an arbitrary id and, because
    // updateUserSchema permits role:'owner', escalate to owner. Profile
    // self-service already lives at PATCH /api/v1/auth/me, so tightening this
    // endpoint is safe.

    // 1. Non-admins may only touch their own record.
    if (!isRoleAtLeast(callerRole, 'admin') && id !== callerId) {
      throw new HTTPException(403, { message: 'Forbidden: cannot modify other users' })
    }
    // 2. Non-admins may not change privilege-bearing fields (role, status) —
    //    that would allow self-promotion or self-suspension (DoS).
    if (!isRoleAtLeast(callerRole, 'admin') && (parsed.data.role !== undefined || parsed.data.status !== undefined)) {
      throw new HTTPException(403, { message: 'Forbidden: cannot change role or status' })
    }
    // 3. No caller may grant a role higher than their own (an admin cannot
    //    mint an owner). Closes the privilege-escalation path entirely.
    if (parsed.data.role !== undefined && !isRoleAtLeast(callerRole, parsed.data.role as RoleId)) {
      throw new HTTPException(403, { message: 'Cannot assign a role higher than your own' })
    }

    const user = getOne<UserRow>(db, sql`SELECT * FROM users WHERE id = ${id}`)
    if (!user) {
      throw new HTTPException(404, { message: 'User not found' })
    }

    // Protect root owner
    if (user.is_root_owner) {
      if (parsed.data.role && parsed.data.role !== 'owner') {
        throw new HTTPException(403, { message: 'Cannot change root owner role' })
      }
      if (parsed.data.status === 'suspended') {
        throw new HTTPException(403, { message: 'Cannot suspend root owner' })
      }
    }

    const { displayName, email, role, status } = parsed.data
    const now = new Date().toISOString()

    if (displayName !== undefined) {
      db.run(sql`UPDATE users SET display_name = ${displayName}, updated_at = ${now} WHERE id = ${id}`)
    }
    if (email !== undefined) {
      db.run(sql`UPDATE users SET email = ${email}, updated_at = ${now} WHERE id = ${id}`)
    }
    if (role !== undefined) {
      db.run(sql`UPDATE users SET role = ${role}, updated_at = ${now} WHERE id = ${id}`)
    }
    if (status !== undefined) {
      db.run(sql`UPDATE users SET status = ${status}, updated_at = ${now} WHERE id = ${id}`)
      // D14 — a suspended user must not keep a live socket subscribed to
      // per-user content. Best-effort: a close failure must never fail the
      // PATCH itself. Only fires on an actual suspend, not a restore-to-active.
      if (status === 'suspended') {
        try { deps.closeUserSockets?.(id) } catch { /* best-effort */ }
      }
    }

    const updated = getOne<UserRow>(db, sql`SELECT * FROM users WHERE id = ${id}`)
    return c.json({ user: userToPublic(updated!) })
  })

  // Archives a user (soft). Agent users and the root owner can never be
  // archived here — agents back live AI agents, so "deleting" one breaks it;
  // use POST /api/v1/users/:id/restore to recover a mistakenly archived user.
  router.delete('/api/v1/users/:id', authenticate, requirePermission('delete', 'User'), (c) => {
    const id = c.req.param('id')
    const callerRole = c.get('role') as RoleId
    // Defense-in-depth: archiving users is an admin/owner operation. The CASL
    // 'delete User' permission is already admin-only, but pin it here too so a
    // future roles.ts change can't silently open self/other archiving.
    if (!isRoleAtLeast(callerRole, 'admin')) {
      throw new HTTPException(403, { message: 'Forbidden: cannot archive users' })
    }
    const user = getOne<UserRow>(db, sql`SELECT * FROM users WHERE id = ${id}`)
    if (!user) {
      throw new HTTPException(404, { message: 'User not found' })
    }

    if (user.is_root_owner) {
      throw new HTTPException(403, { message: 'Cannot archive root owner' })
    }
    if (user.is_agent) {
      throw new HTTPException(403, { message: 'Cannot archive agent users' })
    }

    const now = new Date().toISOString()
    db.run(sql`UPDATE users SET status = 'archived', updated_at = ${now} WHERE id = ${id}`)
    // D14 — an archived user must not keep a live socket around.
    try { deps.closeUserSockets?.(id) } catch { /* best-effort */ }
    return c.json({ message: 'User archived' })
  })

  // Restores an archived (or legacy 'deleted') user back to active. Allowed
  // for ANY status, including agent users — this is how an agent user that
  // was archived/deleted before this protection existed gets recovered.
  router.post('/api/v1/users/:id/restore', authenticate, requirePermission('update', 'User'), (c) => {
    const id = c.req.param('id')
    const callerRole = c.get('role') as RoleId
    // Defense-in-depth: like the archive route, restoring is an admin/owner
    // operation. The 'user' role holds an unconditional can('update','User')
    // (subject level only — see PATCH handler above), so without this check
    // any logged-in user could reactivate an arbitrary archived account.
    if (!isRoleAtLeast(callerRole, 'admin')) {
      throw new HTTPException(403, { message: 'Forbidden: cannot restore users' })
    }
    const user = getOne<UserRow>(db, sql`SELECT * FROM users WHERE id = ${id}`)
    if (!user) {
      throw new HTTPException(404, { message: 'User not found' })
    }

    const now = new Date().toISOString()
    db.run(sql`UPDATE users SET status = 'active', updated_at = ${now} WHERE id = ${id}`)
    return c.json({ message: 'User restored' })
  })

  // ─── API Keys (authenticated) ────────────────────────

  router.get('/api/v1/api-keys', authenticate, requirePermission('read', 'ApiKey'), (c) => {
    const userId = c.get('userId')
    interface ApiKeyRow {
      id: string; user_id: string; name: string; key_prefix: string;
      last_used_at: string | null; expires_at: string | null;
      created_at: string; revoked_at: string | null
    }
    const keys = db.all(sql`SELECT * FROM api_keys WHERE user_id = ${userId} AND revoked_at IS NULL ORDER BY created_at DESC`) as ApiKeyRow[]

    return c.json({
      apiKeys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.key_prefix,
        lastUsedAt: k.last_used_at,
        expiresAt: k.expires_at,
        createdAt: k.created_at,
      })),
    })
  })

  router.post('/api/v1/api-keys', authenticate, requirePermission('create', 'ApiKey'), async (c) => {
    const body = await c.req.json()
    const parsed = createApiKeySchema.safeParse(body)
    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues[0].message })
    }

    const userId = c.get('userId')
    const { name, expiresInDays } = parsed.data
    const rawKey = generateApiKey()
    const keyHash = await hashApiKey(rawKey)
    const prefix = getKeyPrefix(rawKey)
    const id = generateId()
    const now = new Date().toISOString()
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 86400 * 1000).toISOString()
      : null

    db.run(sql`INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, expires_at, created_at)
      VALUES (${id}, ${userId}, ${name}, ${prefix}, ${keyHash}, ${expiresAt}, ${now})`)

    return c.json({
      apiKey: {
        id,
        name,
        keyPrefix: prefix,
        key: rawKey,
        expiresAt,
        createdAt: now,
      },
    }, 201)
  })

  router.delete('/api/v1/api-keys/:id', authenticate, requirePermission('delete', 'ApiKey'), (c) => {
    const id = c.req.param('id')
    const userId = c.get('userId')
    const key = getOne<{ id: string; user_id: string }>(
      db, sql`SELECT * FROM api_keys WHERE id = ${id} AND user_id = ${userId} AND revoked_at IS NULL`
    )
    if (!key) {
      throw new HTTPException(404, { message: 'API key not found' })
    }

    const now = new Date().toISOString()
    db.run(sql`UPDATE api_keys SET revoked_at = ${now} WHERE id = ${id}`)
    return c.json({ message: 'API key revoked' })
  })
}
