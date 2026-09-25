// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requirePermission } from '@modules/permissions/middleware'
import { TRACE_PURPOSE_GROUPS, type TraceCollector } from './trace-collector.js'
import type { ModuleContext } from '@core/types'
import { recordUserFeedback } from './quality-scorer.js'
import { runAnomalyDetection } from './anomaly-detector.js'
import { listGodModeRuns, summarizeGodMode } from './god-mode-report.js'

/** The largest page the traces list serves (the Context tab reads 200). */
const MAX_TRACE_LIMIT = 500

/** GET /api/v1/observability/traces query. Empty values are treated as absent. */
const TraceListQuerySchema = z.object({
  model: z.string().max(200).optional(),
  provider: z.string().max(100).optional(),
  conversationId: z.string().max(200).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  minCost: z.coerce.number().finite().min(0).optional(),
  /** Background calls of one purpose group only. */
  purposeGroup: z.enum(TRACE_PURPOSE_GROUPS).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_TRACE_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
}).strip()

function withoutEmpty(query: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(query).filter(([, v]) => v !== ''))
}

export function createObservabilityRoutes(
  app: Hono,
  collector: TraceCollector,
  ctx: ModuleContext,
): void {
  // List traces with pagination and filters
  app.get('/api/v1/observability/traces', requirePermission('read', 'AuditEntry'), (c) => {
    const parsed = TraceListQuerySchema.safeParse(withoutEmpty(c.req.query()))
    if (!parsed.success) {
      return c.json({ error: 'Invalid query', details: parsed.error.issues }, 400)
    }

    const result = collector.query(parsed.data)
    return c.json(result)
  })

  // Trace detail
  app.get('/api/v1/observability/traces/:id', requirePermission('read', 'AuditEntry'), (c) => {
    const id = c.req.param('id')
    const trace = collector.getById(id)
    if (!trace) {
      throw new HTTPException(404, { message: 'Trace not found' })
    }
    return c.json({ trace })
  })

  // User quality feedback
  app.post('/api/v1/observability/traces/:id/feedback', requirePermission('read', 'AuditEntry'), async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json<{ score: 'good' | 'bad' }>()

    if (!body.score || !['good', 'bad'].includes(body.score)) {
      throw new HTTPException(400, { message: 'score must be "good" or "bad"' })
    }

    const trace = collector.getById(id)
    if (!trace) {
      throw new HTTPException(404, { message: 'Trace not found' })
    }

    recordUserFeedback(id, body.score, collector)
    return c.json({ ok: true })
  })

  // Aggregated stats
  app.get('/api/v1/observability/stats', requirePermission('read', 'AuditEntry'), (c) => {
    const from = c.req.query('from')
    const to = c.req.query('to')
    const stats = collector.getStats(from ?? undefined, to ?? undefined)
    return c.json({ stats })
  })

  // Anomalies — on-demand check
  app.get('/api/v1/observability/anomalies', requirePermission('read', 'AuditEntry'), (c) => {
    const anomalies = runAnomalyDetection(collector, ctx)
    return c.json({ anomalies })
  })

  app.get('/api/v1/observability/god-mode/summary', requirePermission('read', 'AuditEntry'), (c) => {
    return c.json(summarizeGodMode(ctx.db))
  })

  app.get('/api/v1/observability/god-mode/runs', requirePermission('read', 'AuditEntry'), (c) => {
    const limitRaw = c.req.query('limit')
    const offsetRaw = c.req.query('offset')
    const limit = limitRaw ? parseInt(limitRaw, 10) : undefined
    const offset = offsetRaw ? parseInt(offsetRaw, 10) : undefined
    return c.json(listGodModeRuns(ctx.db, { limit, offset }))
  })
}
