// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono, Context } from 'hono'
import type { Logger } from 'pino'
import type { Aggregator } from './aggregator.js'
import type { AgentSessionRegistry } from './types.js'

/**
 * Auth/permission hooks — injected so the mission-control module never
 * imports the auth/permissions source directly. Callers are expected to
 * wire these from middleware that's already running in the Hono app.
 */
export interface MissionControlAuthHooks {
  /** Return the currently authenticated user id, or null if unauthenticated. */
  getUserId(c: Context): string | null
  /** Return true if the user has the "admin" (or equivalent) role. */
  isAdmin(c: Context): boolean
}

export interface MissionControlRouteDeps {
  aggregator: Aggregator
  registry: AgentSessionRegistry
  auth: MissionControlAuthHooks
  logger: Logger
}

/**
 * REST routes for Mission Control.
 *
 *   GET    /api/v1/mission-control/snapshot
 *   POST   /api/v1/mission-control/agents/:sessionId/interrupt
 *   POST   /api/v1/mission-control/agents/:sessionId/pause
 *   POST   /api/v1/mission-control/agents/:sessionId/resume
 *
 * There is deliberately NO dedicated Mission Control socket. Live updates ride
 * the shared WS registry as a thin `mission-control` ping (see index.ts) and
 * the client refetches the snapshot above — which is the only place the
 * per-owner visibility filter is applied. A socket that pushed snapshots
 * directly would hand every subscriber the unfiltered grid.
 */
export function createMissionControlRoutes(app: Hono, deps: MissionControlRouteDeps) {
  const { aggregator, auth, logger } = deps

  app.get('/api/v1/mission-control/snapshot', async (c) => {
    const userId = auth.getUserId(c)
    if (!userId) return c.json({ error: 'unauthorized' }, 401)

    try {
      const snap = await aggregator.getSnapshot()
      // Non-admins see only their own agents.
      const visible = auth.isAdmin(c)
        ? snap.agents
        : snap.agents.filter((a) => a.ownerUserId === userId)
      return c.json({ ...snap, agents: visible })
    } catch (err: any) {
      logger.error({ err }, 'mission-control: snapshot failed')
      return c.json({ error: 'snapshot failed', message: String(err?.message ?? err) }, 500)
    }
  })

  app.post('/api/v1/mission-control/agents/:sessionId/interrupt', async (c) => {
    return runControlAction(c, 'interrupt', deps)
  })

  app.post('/api/v1/mission-control/agents/:sessionId/pause', async (c) => {
    return runControlAction(c, 'pause', deps)
  })

  app.post('/api/v1/mission-control/agents/:sessionId/resume', async (c) => {
    return runControlAction(c, 'resume', deps)
  })

  logger.info('mission-control: routes registered')

  // --- action helper ------------------------------------------------------

  async function runControlAction(
    c: Context,
    action: 'interrupt' | 'pause' | 'resume',
    { registry, auth, logger }: MissionControlRouteDeps,
  ) {
    const userId = auth.getUserId(c)
    if (!userId) return c.json({ error: 'unauthorized' }, 401)

    // Path param `sessionId` is enforced by the route pattern — the `!`
    // asserts that invariant to TS (Hono returns `string | undefined`).
    const sessionId = c.req.param('sessionId')!
    const entry = registry.get(sessionId)
    if (!entry) return c.json({ error: 'not found' }, 404)

    const isOwner = entry.ownerUserId === userId
    if (!isOwner && !auth.isAdmin(c)) {
      return c.json({ error: 'forbidden' }, 403)
    }

    try {
      switch (action) {
        case 'interrupt':
          await registry.interrupt(sessionId)
          break
        case 'pause':
          await registry.pause(sessionId)
          break
        case 'resume':
          await registry.resume(sessionId)
          break
      }
      return c.json({ ok: true, action, sessionId })
    } catch (err: any) {
      logger.error({ err, action, sessionId }, 'mission-control: action failed')
      return c.json({ error: `${action} failed`, message: String(err?.message ?? err) }, 500)
    }
  }
}
