// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { TraceCollector } from './trace-collector.js'
import type { ModuleContext } from '@core/types'
import { recordUserFeedback } from './quality-scorer.js'
import { runAnomalyDetection } from './anomaly-detector.js'

export function createObservabilityRoutes(
  app: Hono,
  collector: TraceCollector,
  ctx: ModuleContext,
): void {
  // List traces with pagination and filters
  app.get('/api/v1/observability/traces', requirePermission('read', 'AuditEntry'), (c) => {
    const filters = {
      model: c.req.query('model'),
      provider: c.req.query('provider'),
      conversationId: c.req.query('conversationId'),
      from: c.req.query('from'),
      to: c.req.query('to'),
      minCost: c.req.query('minCost') ? parseFloat(c.req.query('minCost')!) : undefined,
      limit: c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined,
      offset: c.req.query('offset') ? parseInt(c.req.query('offset')!, 10) : undefined,
    }

    const result = collector.query(filters)
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
}
