// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb, EyasBus } from '@core/types'
import type { Logger } from 'pino'
import type { StorageProvider } from './types.js'

// ─── Config ───────────────────────────────────────────

interface SyncConfig {
  retryAttempts: number     // default 3
  retryDelaySeconds: number // default 60
  batchSize: number         // default 10
}

const DEFAULT_CONFIG: SyncConfig = {
  retryAttempts: 3,
  retryDelaySeconds: 60,
  batchSize: 10,
}

// ─── Internal row shape from DB ───────────────────────

interface PendingRow {
  id: string
  storage_key: string
}

// ─── Helpers ──────────────────────────────────────────

async function streamToBuffer(stream: ReadableStream): Promise<Buffer> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  return Buffer.concat(chunks)
}

// ─── Factory ──────────────────────────────────────────

export function createSyncService(
  db: EyasDb,
  primary: StorageProvider,
  secondary: StorageProvider,
  bus: EyasBus,
  logger: Logger,
  config?: Partial<SyncConfig>,
) {
  const cfg: SyncConfig = { ...DEFAULT_CONFIG, ...config }
  let running = false

  // ─── processPending ─────────────────────────────────

  async function processPending(): Promise<number> {
    if (running) {
      logger.debug('sync-service: already running, skipping')
      return 0
    }

    running = true
    let synced = 0

    try {
      const rows = (db as any).all(
        sql`SELECT id, storage_key FROM documents WHERE remote_status = 'pending' AND deleted_at IS NULL LIMIT ${cfg.batchSize}`,
      ) as PendingRow[]

      for (const row of rows) {
        const documentId = row.id
        const storageKey = row.storage_key

        try {
          const result = await primary.get(storageKey)
          if (!result) {
            logger.warn({ documentId, storageKey }, 'sync-service: primary file not found, skipping')
            continue
          }

          const buffer = await streamToBuffer(result.data)

          await secondary.put(storageKey, buffer, result.meta)

          db.run(
            sql`UPDATE documents SET remote_status = 'synced', updated_at = datetime('now') WHERE id = ${documentId}`,
          )

          bus.emit('eyas.documents.synced', { documentId, remoteProvider: secondary.id })
          logger.info({ documentId, storageKey }, 'sync-service: synced to secondary')
          synced++
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          logger.error({ documentId, storageKey, error }, 'sync-service: sync failed')

          try {
            db.run(
              sql`UPDATE documents SET remote_status = 'error', updated_at = datetime('now') WHERE id = ${documentId}`,
            )
          } catch (dbErr) {
            logger.error({ documentId, dbErr }, 'sync-service: failed to set error status')
          }

          bus.emit('eyas.documents.sync.failed', { documentId, error })
        }
      }
    } finally {
      running = false
    }

    return synced
  }

  // ─── retryErrors ────────────────────────────────────

  async function retryErrors(): Promise<number> {
    // Only retry documents that haven't exceeded max retry attempts
    const errorCount = ((db as any).all(
      sql`SELECT COUNT(*) as cnt FROM documents WHERE remote_status = 'error' AND deleted_at IS NULL`,
    ) as any[])?.[0]?.cnt ?? 0

    if (errorCount === 0) return 0

    // Reset error→pending for retry, but cap at batchSize to avoid flooding
    db.run(
      sql`UPDATE documents SET remote_status = 'pending', updated_at = datetime('now')
          WHERE remote_status = 'error' AND deleted_at IS NULL
          LIMIT ${cfg.batchSize}`,
    )
    logger.info({ errorCount: Math.min(errorCount, cfg.batchSize) }, 'sync-service: reset error→pending, retrying')
    return processPending()
  }

  return { processPending, retryErrors }
}

export type SyncService = ReturnType<typeof createSyncService>
