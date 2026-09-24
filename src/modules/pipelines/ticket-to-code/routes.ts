// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { Logger } from 'pino'
import { requirePermission } from '@modules/permissions/middleware'
import {
  InvalidPipelineStateError,
  PipelineNotFoundError,
  type TicketToCodeOrchestrator,
} from './orchestrator.js'
import { STAGE_NAMES, TICKET_SOURCES, type StageName, type TicketSource } from './types.js'

function isTicketSource(x: unknown): x is TicketSource {
  return typeof x === 'string' && (TICKET_SOURCES as readonly string[]).includes(x)
}

function isStageName(x: unknown): x is StageName {
  return typeof x === 'string' && (STAGE_NAMES as readonly string[]).includes(x)
}

export function createTicketToCodeRoutes(
  app: Hono<any>,
  orchestrator: TicketToCodeOrchestrator,
  logger: Logger,
) {
  const base = '/api/v1/pipelines/ticket-to-code'

  // Start a new pipeline run
  app.post(base + '/start', requirePermission('create', 'Pipeline'), async (c) => {
    let body: any
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const { ticketSource, ticketId, startedBy, config } = body ?? {}
    if (!isTicketSource(ticketSource)) {
      return c.json({ error: `ticketSource must be one of ${TICKET_SOURCES.join(', ')}` }, 400)
    }
    if (typeof ticketId !== 'string' || ticketId.length === 0) {
      return c.json({ error: 'ticketId is required' }, 400)
    }
    try {
      const state = await orchestrator.start({
        ticketSource,
        ticketId,
        startedBy: typeof startedBy === 'string' ? startedBy : null,
        config: config && typeof config === 'object' ? config : undefined,
      })
      return c.json(state, 201)
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Failed to start pipeline' },
        500,
      )
    }
  })

  // List recent runs
  app.get(base, requirePermission('read', 'Pipeline'), (c) => {
    const limitRaw = c.req.query('limit')
    const limit = limitRaw ? Math.max(1, Math.min(500, Number(limitRaw) || 50)) : 50
    return c.json(orchestrator.listRuns(limit))
  })

  // Get state of a specific run
  app.get(base + '/:id', requirePermission('read', 'Pipeline'), (c) => {
    // Path param `id` is guaranteed present by the route pattern. Hono's
    // typing returns it as `string | undefined`; the `!` encodes the runtime
    // invariant for the type checker.
    const id = c.req.param('id')!
    try {
      return c.json(orchestrator.getState(id))
    } catch (err) {
      if (err instanceof PipelineNotFoundError) return c.json({ error: err.message }, 404)
      throw err
    }
  })

  // Approve a stage awaiting approval
  app.post(
    base + '/:id/approve/:stageName',
    requirePermission('approve', 'Pipeline'),
    async (c) => {
      // Path param `id` is guaranteed present by the route pattern. Hono's
    // typing returns it as `string | undefined`; the `!` encodes the runtime
    // invariant for the type checker.
    const id = c.req.param('id')!
      const stageName = c.req.param('stageName')
      if (!isStageName(stageName)) {
        return c.json({ error: `Unknown stage: ${stageName}` }, 400)
      }
      try {
        const state = await orchestrator.approve(id, stageName)
        return c.json(state)
      } catch (err) {
        if (err instanceof PipelineNotFoundError) return c.json({ error: err.message }, 404)
        if (err instanceof InvalidPipelineStateError) return c.json({ error: err.message }, 409)
        throw err
      }
    },
  )

  // Cancel a run
  app.post(base + '/:id/cancel', requirePermission('manage', 'Pipeline'), (c) => {
    // Path param `id` is guaranteed present by the route pattern. Hono's
    // typing returns it as `string | undefined`; the `!` encodes the runtime
    // invariant for the type checker.
    const id = c.req.param('id')!
    try {
      return c.json(orchestrator.cancel(id))
    } catch (err) {
      if (err instanceof PipelineNotFoundError) return c.json({ error: err.message }, 404)
      throw err
    }
  })

  // Resume a failed or cancelled run
  app.post(base + '/:id/resume', requirePermission('manage', 'Pipeline'), async (c) => {
    // Path param `id` is guaranteed present by the route pattern. Hono's
    // typing returns it as `string | undefined`; the `!` encodes the runtime
    // invariant for the type checker.
    const id = c.req.param('id')!
    try {
      const state = await orchestrator.resume(id)
      return c.json(state)
    } catch (err) {
      if (err instanceof PipelineNotFoundError) return c.json({ error: err.message }, 404)
      if (err instanceof InvalidPipelineStateError) return c.json({ error: err.message }, 409)
      throw err
    }
  })

  logger.info('Ticket-to-code pipeline routes registered')
}
