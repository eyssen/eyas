// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { EyasModule, ModuleContext } from '@core/types'
import { createDocumentsTables } from './schema.js'
import { createDocumentService } from './document-service.js'
import { createSyncService } from './sync-service.js'
import { createRetentionService } from './retention-service.js'
import { createDocumentRoutes } from './routes.js'
import { createLocalProvider } from './providers/local-provider.js'
import { createS3Provider } from './providers/s3-provider.js'
import { createS3Client } from './providers/s3-client-factory.js'

let syncInterval: ReturnType<typeof setInterval> | null = null
let retentionInterval: ReturnType<typeof setInterval> | null = null

export const documentsModule: EyasModule = {
  id: 'documents',
  name: 'Documents',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'File management with pluggable storage providers, multi-owner document binding, lifecycle retention',
  dependencies: ['auth', 'secrets'],
  optional: ['search', 'activity'],

  frontend: {
    pages: [{ id: 'documents', path: '/documents', title: 'Documents', icon: 'FileText', order: 50 }],
    settings: [{ id: 'documents', title: 'Documents', order: 60 }],
  },

  async onRegister(ctx: ModuleContext) {
    createDocumentsTables(ctx.db)
    ctx.logger.info('Documents module registered')
  },

  async onStart(ctx: ModuleContext) {
    // 1. Create local primary provider
    const docsDir = join(process.cwd(), 'data', 'documents')
    await mkdir(docsDir, { recursive: true })
    const primary = createLocalProvider(docsDir)

    // 2. Try to create S3 secondary provider
    let secondary = null
    try {
      const accessKey = await ctx.secrets.get('s3-access-key', 'system')
      const secretKey = await ctx.secrets.get('s3-secret-key', 'system')
      const endpoint = await ctx.secrets.get('s3-endpoint', 'system')
      const bucket = await ctx.secrets.get('s3-bucket', 'system')
      const region = await ctx.secrets.get('s3-region', 'system')

      if (accessKey && secretKey && endpoint && bucket && region) {
        const client = await createS3Client({
          accessKeyId: accessKey as string,
          secretAccessKey: secretKey as string,
          endpoint: endpoint as string,
          bucket: bucket as string,
          region: region as string,
        })
        secondary = createS3Provider({ client, bucket, prefix: 'documents/' })
        ctx.logger.info('Documents S3 secondary provider configured')
      } else {
        ctx.logger.warn('Documents S3 credentials incomplete — secondary provider disabled')
      }
    } catch (err) {
      ctx.logger.warn({ err }, 'Documents S3 provider init failed — secondary provider disabled')
    }

    // If no secondary, reset any stale pending/error sync states to prevent log spam
    if (!secondary) {
      ctx.db.run(sql`UPDATE documents SET remote_status = NULL WHERE remote_status IN ('pending', 'error')`)
    }

    // 3. Create document service
    // `secondary` can be null when S3 creds are missing; the service expects
    // undefined to signify "no secondary provider". Normalize here.
    const documentService = createDocumentService(ctx.db, primary, secondary ?? undefined, undefined, {
      media: { maxFileSizeMb: 200 },
    })
    ;(ctx as any).documents = documentService

    // 4. Sync service (only if secondary exists)
    if (secondary) {
      const syncService = createSyncService(ctx.db, primary, secondary, ctx.bus, ctx.logger)

      ctx.bus.on('eyas.documents.uploaded', async (_data) => {
        await syncService.processPending()
      })

      syncInterval = setInterval(() => {
        syncService.retryErrors().catch((err: unknown) => {
          ctx.logger.warn({ err }, 'Documents sync retry failed')
        })
      }, 5 * 60 * 1000)
    }

    // 5. Retention service
    const retentionService = createRetentionService(ctx.db, primary, ctx.bus)

    ctx.bus.on('eyas.conversations.stage_changed', async (data) => {
      const d = data as any
      if (d?.conversationId) {
        retentionService.applyLifecycleRule('conversations', d.conversationId, 30)
      }
    })

    ctx.bus.on('eyas.conversations.closed', async (data) => {
      const d = data as any
      if (d?.conversationId) {
        retentionService.applyLifecycleRule('conversations', d.conversationId, 7)
      }
    })

    retentionInterval = setInterval(() => {
      retentionService.cleanupExpired().catch((err: unknown) => {
        ctx.logger.warn({ err }, 'Documents retention cleanup failed')
      })
    }, 15 * 60 * 1000)

    // 6. Register routes
    createDocumentRoutes(ctx.http, documentService, ctx.bus, ctx.logger)

    ctx.logger.info('Documents module started')
  },

  async onStop(_ctx: ModuleContext) {
    if (syncInterval) {
      clearInterval(syncInterval)
      syncInterval = null
    }
    if (retentionInterval) {
      clearInterval(retentionInterval)
      retentionInterval = null
    }
  },
}
