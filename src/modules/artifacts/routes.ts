// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { Logger } from 'pino'
import { requirePermission } from '@modules/permissions/middleware'
import {
  ArtifactValidationError,
  UnknownArtifactKindError,
  type ArtifactService,
} from './artifact-service.js'
import { isKnownKind } from './validators/index.js'
import { REF_TYPES, type ArtifactRefType } from './types.js'

// `app: Hono<any>` because bootstrap + tests supply sub-apps with their own
// Variables (CASL ability, userId). Hono's narrower signature otherwise
// rejects the pre-typed app.
export function createArtifactRoutes(app: Hono<any>, service: ArtifactService, logger: Logger) {
  // Create a new artifact
  app.post('/api/v1/artifacts', requirePermission('create', 'Artifact'), async (c) => {
    let body: any
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const { sessionId, kind, title, payload, producedBy, changeNote } = body ?? {}
    if (!kind || !isKnownKind(kind)) {
      return c.json({ error: `Unknown or missing artifact kind` }, 400)
    }
    if (typeof title !== 'string' || title.length === 0) {
      return c.json({ error: 'title is required' }, 400)
    }
    if (payload === undefined) {
      return c.json({ error: 'payload is required' }, 400)
    }
    try {
      const artifact = service.create({
        sessionId: sessionId ?? null,
        kind,
        title,
        payload,
        producedBy: producedBy ?? null,
        changeNote,
      })
      return c.json(artifact, 201)
    } catch (err) {
      if (err instanceof ArtifactValidationError) {
        return c.json({ error: 'ValidationError', kind: err.kind, issues: err.issues }, 400)
      }
      if (err instanceof UnknownArtifactKindError) {
        return c.json({ error: err.message }, 400)
      }
      throw err
    }
  })

  // Get artifact + latest payload
  app.get('/api/v1/artifacts/:id', requirePermission('read', 'Artifact'), (c) => {
    const a = service.getWithPayload(c.req.param('id'))
    if (!a) return c.json({ error: 'Artifact not found' }, 404)
    return c.json(a)
  })

  // Get all versions of an artifact
  app.get('/api/v1/artifacts/:id/versions', requirePermission('read', 'Artifact'), (c) => {
    const id = c.req.param('id')
    if (!service.get(id)) return c.json({ error: 'Artifact not found' }, 404)
    return c.json(service.listVersions(id))
  })

  // List by session
  app.get('/api/v1/artifacts/by-session/:sessionId', requirePermission('read', 'Artifact'), (c) => {
    return c.json(service.listBySession(c.req.param('sessionId')))
  })

  // List by kind (optional ?sessionId=...)
  app.get('/api/v1/artifacts/by-kind/:kind', requirePermission('read', 'Artifact'), (c) => {
    const kind = c.req.param('kind')
    if (!isKnownKind(kind)) return c.json({ error: `Unknown kind: ${kind}` }, 400)
    const sessionId = c.req.query('sessionId') ?? undefined
    return c.json(service.listByKind(kind, sessionId))
  })

  // Create a new version
  app.put('/api/v1/artifacts/:id', requirePermission('update', 'Artifact'), async (c) => {
    const id = c.req.param('id')
    const existing = service.get(id)
    if (!existing) return c.json({ error: 'Artifact not found' }, 404)
    let body: any
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const { payload, actor, note } = body ?? {}
    if (payload === undefined) {
      return c.json({ error: 'payload is required' }, 400)
    }
    try {
      const updated = service.update(id, payload, actor ?? null, note)
      return c.json(updated)
    } catch (err) {
      if (err instanceof ArtifactValidationError) {
        return c.json({ error: 'ValidationError', kind: err.kind, issues: err.issues }, 400)
      }
      throw err
    }
  })

  // Mark consumed by agent
  app.post('/api/v1/artifacts/:id/consume', requirePermission('update', 'Artifact'), async (c) => {
    const id = c.req.param('id')
    if (!service.get(id)) return c.json({ error: 'Artifact not found' }, 404)
    let body: any
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const agentId = body?.agentId
    if (typeof agentId !== 'string' || agentId.length === 0) {
      return c.json({ error: 'agentId is required' }, 400)
    }
    service.markConsumedBy(id, agentId)
    return c.json(service.get(id))
  })

  // Create a ref between artifacts
  app.post('/api/v1/artifacts/:id/link', requirePermission('update', 'Artifact'), async (c) => {
    const fromId = c.req.param('id')
    if (!service.get(fromId)) return c.json({ error: 'Source artifact not found' }, 404)
    let body: any
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const { toId, type } = body ?? {}
    if (typeof toId !== 'string' || !service.get(toId)) {
      return c.json({ error: 'Target artifact not found' }, 404)
    }
    if (!type || !(REF_TYPES as readonly string[]).includes(type)) {
      return c.json({ error: `Invalid ref type; expected one of ${REF_TYPES.join(', ')}` }, 400)
    }
    service.link(fromId, toId, type as ArtifactRefType)
    return c.json({ ok: true }, 201)
  })

  // Backlinks (artifacts linking TO this one)
  app.get('/api/v1/artifacts/:id/backlinks', requirePermission('read', 'Artifact'), (c) => {
    const id = c.req.param('id')
    if (!service.get(id)) return c.json({ error: 'Artifact not found' }, 404)
    return c.json(service.backlinks(id))
  })

  // Forward links (artifacts this one points TO)
  app.get('/api/v1/artifacts/:id/forward-links', requirePermission('read', 'Artifact'), (c) => {
    const id = c.req.param('id')
    if (!service.get(id)) return c.json({ error: 'Artifact not found' }, 404)
    return c.json(service.forwardLinks(id))
  })

  logger.info('Artifacts routes registered')
}
