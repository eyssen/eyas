// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { BackupService } from './backup-service.js'
import { testDestination } from './backup-service.js'
import {
  loadDestinationStore,
  upsertDestination,
  removeDestination,
  setPrimaryDestination,
} from './destinations/store.js'
import { listDestinationTypes } from './destinations/registry.js'
import type { DestinationConfig, DestinationType } from './destinations/types.js'
import { generateId } from '@shared/crypto'

export function createDisasterRecoveryRoutes(
  app: Hono,
  backupService: BackupService,
  getSecret?: (key: string) => Promise<string | null>,
): void {
  app.post('/api/v1/backup/create', requirePermission('manage', 'Backup'), async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}))
      const metadata = await backupService.createBackup(body.paths)
      const remoteFailed = metadata.paths.some((p) => p.startsWith('// remote-upload-failed'))
      return c.json(
        {
          backup: {
            ...metadata,
            paths: metadata.paths.filter((p) => !p.startsWith('// ')),
            remoteUploads: (metadata as any).remoteUploads ?? [],
            remoteWarning: remoteFailed
              ? metadata.paths.find((p) => p.startsWith('// remote'))
              : undefined,
          },
        },
        201,
      )
    } catch (err: any) {
      throw new HTTPException(500, { message: err.message ?? 'Failed to create backup' })
    }
  })

  app.get('/api/v1/backup/list', requirePermission('read', 'Backup'), async (c) => {
    const backups = await backupService.listBackups()
    return c.json({ backups })
  })

  app.post('/api/v1/backup/:id/restore', requirePermission('manage', 'Backup'), async (c) => {
    const id = c.req.param('id')
    try {
      const body = await c.req.json().catch(() => ({}))
      await backupService.restoreBackup(id, body.targetDir)
      return c.json({ message: `Backup ${id} restored successfully` })
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        throw new HTTPException(404, { message: err.message })
      }
      throw new HTTPException(500, { message: err.message ?? 'Failed to restore backup' })
    }
  })

  // ── Destinations ──────────────────────────────────────────────────────────

  app.get('/api/v1/backup/destination-types', requirePermission('read', 'Backup'), (c) => {
    return c.json({ types: listDestinationTypes() })
  })

  app.get('/api/v1/backup/destinations', requirePermission('read', 'Backup'), (c) => {
    const store = loadDestinationStore()
    // Never return secret values — only refs
    return c.json({
      primaryDestinationId: store.primaryDestinationId,
      destinations: store.destinations.map(publicDest),
    })
  })

  app.post('/api/v1/backup/destinations', requirePermission('manage', 'Backup'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Partial<DestinationConfig>
    const type = body.type as DestinationType
    if (!type || type === 'local') {
      throw new HTTPException(400, { message: 'type required (s3|ftp|dropbox|ssh)' })
    }
    if (!listDestinationTypes().some((t) => t.type === type)) {
      throw new HTTPException(400, { message: `Unsupported type: ${type}` })
    }
    const dest: DestinationConfig = {
      id: body.id || generateId().slice(0, 12),
      type,
      name: body.name || type,
      enabled: body.enabled !== false,
      settings: body.settings ?? {},
      secretRefs: body.secretRefs ?? {},
    }
    const store = upsertDestination(dest)
    return c.json({ destination: publicDest(dest), store: { primaryDestinationId: store.primaryDestinationId } }, 201)
  })

  app.put('/api/v1/backup/destinations/:id', requirePermission('manage', 'Backup'), async (c) => {
    const id = c.req.param('id')
    const store = loadDestinationStore()
    const existing = store.destinations.find((d) => d.id === id)
    if (!existing) throw new HTTPException(404, { message: 'Destination not found' })
    const body = await c.req.json().catch(() => ({})) as Partial<DestinationConfig>
    const dest: DestinationConfig = {
      ...existing,
      ...body,
      id,
      type: existing.type,
      settings: body.settings ?? existing.settings,
      secretRefs: body.secretRefs ?? existing.secretRefs,
    }
    upsertDestination(dest)
    return c.json({ destination: publicDest(dest) })
  })

  app.delete('/api/v1/backup/destinations/:id', requirePermission('manage', 'Backup'), (c) => {
    const id = c.req.param('id')
    removeDestination(id)
    return c.json({ ok: true })
  })

  app.post('/api/v1/backup/destinations/:id/primary', requirePermission('manage', 'Backup'), (c) => {
    const id = c.req.param('id')
    try {
      const store = setPrimaryDestination(id)
      return c.json({ primaryDestinationId: store.primaryDestinationId })
    } catch (err: any) {
      throw new HTTPException(404, { message: err.message })
    }
  })

  app.post('/api/v1/backup/destinations/primary/clear', requirePermission('manage', 'Backup'), (c) => {
    const store = setPrimaryDestination(null)
    return c.json({ primaryDestinationId: store.primaryDestinationId })
  })

  app.post('/api/v1/backup/destinations/:id/test', requirePermission('manage', 'Backup'), async (c) => {
    const id = c.req.param('id')
    const store = loadDestinationStore()
    const dest = store.destinations.find((d) => d.id === id)
    if (!dest) throw new HTTPException(404, { message: 'Destination not found' })
    const result = await testDestination(dest, getSecret)
    return c.json(result)
  })
}

function publicDest(d: DestinationConfig) {
  return {
    id: d.id,
    type: d.type,
    name: d.name,
    enabled: d.enabled,
    settings: d.settings,
    secretRefs: d.secretRefs,
    // hint which secrets are configured (env present) without values
    secretsConfigured: Object.fromEntries(
      Object.entries(d.secretRefs ?? {}).map(([field, ref]) => [
        field,
        !!(ref && process.env[ref]),
      ]),
    ),
  }
}
