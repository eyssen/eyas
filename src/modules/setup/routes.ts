import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getCookie } from 'hono/cookie'
import { sql } from 'drizzle-orm'
import { sha256 } from '@shared/crypto'
import type { EyasDb } from '@core/types'
import type { SetupRegistry } from './types.js'

/**
 * True only when the request carries a valid, unexpired session cookie whose
 * user is an active owner. Mirrors the session branch of the auth middleware
 * (cookie only — the first-run wizard authenticates via cookie). Used to gate
 * optional setup-step writes after the required setup is complete: the system
 * is then live and these endpoints are otherwise unauthenticated, so only the
 * owner may finish the remaining optional steps.
 */
export async function isOwnerSession(db: EyasDb, sessionToken: string | undefined): Promise<boolean> {
  if (!sessionToken) return false
  // drizzle-orm sqlite: db.all() returns objects with named columns, db.get()
  // returns positional arrays — use all()[0] for single-row reads (matches the
  // auth module's getOne convention) so this works on both the production db
  // wrapper and the raw drizzle instance used in tests.
  const hash = await sha256(sessionToken)
  const session = (db.all(
    sql`SELECT user_id, expires_at FROM sessions WHERE token_hash = ${hash}`,
  ) as { user_id: string; expires_at: string }[])[0]
  if (!session) return false
  if (new Date(session.expires_at).getTime() < Date.now()) return false
  const user = (db.all(
    sql`SELECT role, status FROM users WHERE id = ${session.user_id}`,
  ) as { role: string; status: string }[])[0]
  return !!user && user.status === 'active' && user.role === 'owner'
}

export function createSetupRoutes(app: Hono, registry: SetupRegistry, db: EyasDb): void {

  // Write endpoints: allow POST only for pending steps (required or optional)
  app.use('/api/v1/setup/steps/*', async (c, next) => {
    if (c.req.method !== 'GET') {
      // Once the required setup is complete the system is live and these write
      // endpoints are otherwise unauthenticated. Optional steps left 'pending'
      // (e.g. 'ai-models', 'team-agents') must NOT stay publicly writable —
      // anyone could otherwise repoint agent models / auth config with no auth.
      // But the first-run wizard still has to finish them, so after completion
      // we require an authenticated owner (the wizard logs in right after
      // creating the root owner) plus the CSRF header; everyone else gets 404.
      // Before completion the required steps run unauthenticated (no account
      // exists yet).
      if (registry.isComplete()) {
        const owner = await isOwnerSession(db, getCookie(c, 'eyas_session'))
        const csrfOk = !!c.req.header('X-Eyas-Request')
        if (!owner || !csrfOk) {
          throw new HTTPException(404, { message: 'Not Found' })
        }
      }
      // Extract step ID from URL path
      const url = new URL(c.req.url)
      const parts = url.pathname.split('/')
      const stepIdx = parts.indexOf('steps')
      const stepId = stepIdx >= 0 ? parts[stepIdx + 1] : null
      if (stepId) {
        const step = registry.getStep(stepId)
        if (!step || step.status !== 'pending') {
          throw new HTTPException(404, { message: 'Not Found' })
        }
      }
    }
    return next()
  })

  app.get('/api/v1/setup/status', (c) => {
    const steps = registry.getSteps()
    const completedSteps = steps.filter(s => s.status === 'completed' || s.status === 'skipped').length
    const pendingRequired = steps.find(s => s.required && s.status === 'pending')
    return c.json({
      complete: registry.isComplete(),
      currentStep: pendingRequired?.id ?? null,
      totalSteps: steps.length,
      completedSteps,
    })
  })

  app.get('/api/v1/setup/steps', (c) => {
    return c.json({ steps: registry.getSteps() })
  })

  app.get('/api/v1/setup/steps/:id', (c) => {
    const step = registry.getStep(c.req.param('id'))
    if (!step) throw new HTTPException(404, { message: 'Step not found' })
    return c.json({ step })
  })

  app.post('/api/v1/setup/steps/:id', async (c) => {
    const stepId = c.req.param('id')
    const step = registry.getStep(stepId)
    if (!step) throw new HTTPException(404, { message: 'Step not found' })

    const data = await c.req.json() as Record<string, unknown>

    // Validate required fields
    for (const field of step.fields) {
      if (field.required && (data[field.name] === undefined || data[field.name] === '')) {
        return c.json({ error: `Field "${field.name}" is required` }, 400)
      }
    }

    try {
      await registry.completeStep(stepId, data)
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }

    return c.json({ step: registry.getStep(stepId) })
  })

  app.post('/api/v1/setup/steps/:id/skip', async (c) => {
    const stepId = c.req.param('id')
    const step = registry.getStep(stepId)
    if (!step) throw new HTTPException(404, { message: 'Step not found' })

    try {
      await registry.skipStep(stepId)
    } catch (err: any) {
      return c.json({ error: err.message }, 403)
    }

    return c.json({ step: registry.getStep(stepId) })
  })
}
