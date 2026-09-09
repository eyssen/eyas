// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { Logger } from 'pino'
import { requirePermission } from '@modules/permissions/middleware'
import type { EyasBus } from '@core/types'
import type { DocumentService } from './document-service.js'

export function createDocumentRoutes(
  app: Hono,
  documents: DocumentService,
  bus: EyasBus,
  logger: Logger,
) {
  // POST /api/v1/documents/upload — multipart/form-data
  app.post('/api/v1/documents/upload', requirePermission('create', 'Document'), async (c) => {
    const body = await c.req.parseBody()
    const file = body['file']
    if (!(file instanceof File)) {
      return c.json({ error: 'file field is required and must be a file upload' }, 400)
    }

    let metadata: Record<string, unknown> | undefined
    if (typeof body['metadata'] === 'string') {
      try {
        metadata = JSON.parse(body['metadata'])
      } catch {
        return c.json({ error: 'metadata must be valid JSON' }, 400)
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    try {
      const doc = await documents.upload({
        file: buffer,
        filename: file.name,
        metadata,
      })

      bus.emit('eyas.documents.uploaded', {
        documentId: doc.id,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        storageKey: doc.storageKey,
      })

      return c.json(doc, 201)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('size')) return c.json({ error: msg }, 413)
      if (msg.includes('type')) return c.json({ error: msg }, 415)
      logger.error({ err }, 'Document upload failed')
      return c.json({ error: 'Upload failed' }, 500)
    }
  })

  // GET /api/v1/documents — list
  app.get('/api/v1/documents', requirePermission('read', 'Document'), (c) => {
    const ownerModule = c.req.query('owner_module')
    const ownerId = c.req.query('owner_id')
    const mimeType = c.req.query('mime_type')
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined
    const offset = c.req.query('offset') ? Number(c.req.query('offset')) : undefined

    if (ownerModule && ownerId) {
      return c.json(documents.listByOwner(ownerModule, ownerId))
    }

    return c.json(documents.listAll({ mimeType, limit, offset }))
  })

  // GET /api/v1/documents/stats — document statistics
  app.get('/api/v1/documents/stats', requirePermission('read', 'Document'), (c) => {
    return c.json(documents.getStats())
  })

  // GET /api/v1/documents/:id — metadata
  app.get('/api/v1/documents/:id', requirePermission('read', 'Document'), (c) => {
    const doc = documents.getById(c.req.param('id'))
    if (!doc) return c.json({ error: 'Document not found' }, 404)
    return c.json(doc)
  })

  // GET /api/v1/documents/:id/download — file download
  app.get('/api/v1/documents/:id/download', requirePermission('read', 'Document'), async (c) => {
    const id = c.req.param('id')
    const doc = documents.getById(id)
    if (!doc) return c.json({ error: 'Document not found' }, 404)

    const result = await documents.download(id)
    if (!result) return c.json({ error: 'File not available' }, 404)

    const encodedFilename = encodeURIComponent(result.meta.filename)
    c.header('Content-Type', result.meta.mimeType)
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`)
    c.header('Content-Length', String(result.meta.sizeBytes))

    return c.body(result.data as any)
  })

  // DELETE /api/v1/documents/:id — soft delete
  app.delete('/api/v1/documents/:id', requirePermission('delete', 'Document'), async (c) => {
    const id = c.req.param('id')
    const doc = documents.getById(id)
    if (!doc) return c.json({ error: 'Document not found' }, 404)

    await documents.softDelete(id)

    bus.emit('eyas.documents.deleted', { documentId: id })

    return c.body(null, 204)
  })

  // POST /api/v1/documents/:id/link — link to entity
  app.post('/api/v1/documents/:id/link', requirePermission('update', 'Document'), async (c) => {
    const id = c.req.param('id')
    const doc = documents.getById(id)
    if (!doc) return c.json({ error: 'Document not found' }, 404)

    const body = await c.req.json()
    const { owner_module, owner_id } = body
    if (!owner_module || !owner_id) {
      return c.json({ error: 'owner_module and owner_id are required' }, 400)
    }

    const source = body.source || 'user'
    documents.link(id, owner_module, owner_id, source)
    return c.json(documents.getById(id))
  })

  // POST /api/v1/documents/:id/unlink — unlink from entity
  app.post('/api/v1/documents/:id/unlink', requirePermission('update', 'Document'), async (c) => {
    const id = c.req.param('id')
    const doc = documents.getById(id)
    if (!doc) return c.json({ error: 'Document not found' }, 404)

    const body = await c.req.json()
    const { owner_module, owner_id } = body
    if (!owner_module || !owner_id) {
      return c.json({ error: 'owner_module and owner_id are required' }, 400)
    }

    documents.unlink(id, owner_module, owner_id)
    return c.json(documents.getById(id))
  })

  // GET /api/v1/documents/:id/links — list links for a document
  app.get('/api/v1/documents/:id/links', requirePermission('read', 'Document'), (c) => {
    const id = c.req.param('id')
    const doc = documents.getById(id)
    if (!doc) return c.json({ error: 'Document not found' }, 404)

    return c.json(documents.getLinks(id))
  })

  logger.info('Documents routes registered')
}
