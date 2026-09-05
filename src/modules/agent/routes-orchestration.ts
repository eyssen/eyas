// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { OrchestrationEventService } from './orchestration-event-service.js'
import type { OrchestrationOwnership } from './orchestration-ownership.js'

/**
 * Replay + discovery surface for persisted orchestration runs: the RunTree
 * hydrates from here on reload, and the board orchestration graph uses the
 * run list as its data source. Mounted under /api/v1 by the agent module.
 *
 * D14 — the REST twin of the orchestration WS topic ACL: `requirePermission`
 * only checks the 'Conversation' SUBJECT (even a guest passes), so without
 * per-run scoping any authenticated user could list and replay every run on
 * the box. Reuses the SAME ownership walk as the WS ACL resolver (see
 * orchestration-ownership.ts) rather than a second implementation.
 */
export function createOrchestrationRoutes(
  app: Hono,
  events: OrchestrationEventService,
  ownership: OrchestrationOwnership,
): void {
  const isElevated = (role: string | undefined): boolean => role === 'owner' || role === 'admin'

  app.get('/orchestration/runs', requirePermission('read', 'Conversation'), (c: any) => {
    const raw = Number(c.req.query('limit') ?? '20')
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100) : 20
    const userId = c.get('userId') as string | undefined
    const role = c.get('role') as string | undefined
    const runs = events.listRuns(limit)
    const scoped = isElevated(role)
      ? runs
      : userId
        ? runs.filter((r) => ownership.ownsOrchestrationRun(r.runId, userId))
        : [] // no authenticated caller on record — fail closed, not fail open
    return c.json({ runs: scoped })
  })

  app.get('/orchestration/runs/:runId/events', requirePermission('read', 'Conversation'), (c: any) => {
    const runId = c.req.param('runId')
    const userId = c.get('userId') as string | undefined
    const role = c.get('role') as string | undefined
    if (!isElevated(role) && (!userId || !ownership.ownsOrchestrationRun(runId, userId))) {
      // Unresolvable and foreign look identical to the caller — both 404 —
      // so a probe can't distinguish "not yours" from "never existed".
      throw new HTTPException(404, { message: 'Run not found' })
    }
    return c.json({ events: events.listByRun(runId) })
  })
}
