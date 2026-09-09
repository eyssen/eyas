// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { Logger } from 'pino'
import { requirePermission } from '@modules/permissions/middleware.js'
import type { EventStore } from './event-store.js'
import type { ReplayEngine } from './replay-engine.js'
import type { SnapshotManager } from './snapshot-manager.js'

/**
 * HTTP routes for the event-store module.
 *
 * GET  /api/v1/events/:sessionId           — list events (fromSeq, toSeq, types)
 * GET  /api/v1/events/:sessionId/latest    — latest seq + count
 * GET  /api/v1/events/:sessionId/replay    — reconstructed state
 * POST /api/v1/events/:sessionId/snapshot  — force a snapshot
 * GET  /api/v1/events/:sessionId/snapshot  — latest snapshot
 */
export function createEventStoreRoutes(
  app: Hono,
  store: EventStore,
  replay: ReplayEngine,
  snapshots: SnapshotManager,
  logger: Logger,
) {
  app.get('/api/v1/events/:sessionId', requirePermission('read', 'AgentEvent'), async (c) => {
    try {
      const sessionId = c.req.param('sessionId')
      const fromSeq = c.req.query('fromSeq')
      const toSeq = c.req.query('toSeq')
      const typesQ = c.req.query('types')
      const limit = c.req.query('limit')

      const events = await store.queryArray(sessionId, {
        fromSeq: fromSeq !== undefined ? Number(fromSeq) : undefined,
        toSeq: toSeq !== undefined ? Number(toSeq) : undefined,
        types: typesQ ? typesQ.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        limit: limit !== undefined ? Number(limit) : undefined,
      })
      return c.json({ sessionId, count: events.length, events })
    } catch (err: any) {
      logger.error({ err }, 'event-store: query failed')
      return c.json({ error: 'query failed', message: String(err?.message ?? err) }, 500)
    }
  })

  app.get('/api/v1/events/:sessionId/latest', requirePermission('read', 'AgentEvent'), async (c) => {
    try {
      const sessionId = c.req.param('sessionId')
      const latestSeq = await store.latestSeq(sessionId)
      const count = await store.countBySession(sessionId)
      return c.json({ sessionId, latestSeq, count })
    } catch (err: any) {
      logger.error({ err }, 'event-store: latest failed')
      return c.json({ error: 'latest failed', message: String(err?.message ?? err) }, 500)
    }
  })

  app.get('/api/v1/events/:sessionId/replay', requirePermission('replay', 'AgentEvent'), async (c) => {
    try {
      const sessionId = c.req.param('sessionId')
      const toSeq = c.req.query('toSeq')
      const fromSnapshot = c.req.query('snapshot') !== 'false'
      const state = await replay.replay(sessionId, {
        toSeq: toSeq !== undefined ? Number(toSeq) : undefined,
        fromSnapshot,
      })
      return c.json(state)
    } catch (err: any) {
      logger.error({ err }, 'event-store: replay failed')
      return c.json({ error: 'replay failed', message: String(err?.message ?? err) }, 500)
    }
  })

  app.post('/api/v1/events/:sessionId/snapshot', requirePermission('snapshot', 'AgentEvent'), async (c) => {
    try {
      const sessionId = c.req.param('sessionId')
      const snap = await snapshots.createSnapshot(sessionId)
      return c.json(snap, 201)
    } catch (err: any) {
      logger.error({ err }, 'event-store: snapshot failed')
      return c.json({ error: 'snapshot failed', message: String(err?.message ?? err) }, 500)
    }
  })

  app.get('/api/v1/events/:sessionId/snapshot', requirePermission('read', 'AgentEvent'), async (c) => {
    try {
      const sessionId = c.req.param('sessionId')
      const snap = await snapshots.loadLatest(sessionId)
      if (!snap) return c.json({ error: 'no snapshot' }, 404)
      return c.json(snap)
    } catch (err: any) {
      logger.error({ err }, 'event-store: get snapshot failed')
      return c.json({ error: 'get snapshot failed', message: String(err?.message ?? err) }, 500)
    }
  })
}
