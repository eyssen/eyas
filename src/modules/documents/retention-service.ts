// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb, EyasBus } from '@core/types'
import type { StorageProvider } from './types.js'

// ─── Internal row shapes ──────────────────────────────

interface ExpiredRow {
  id: string
  storage_key: string
}

// ─── Factory ──────────────────────────────────────────

export function createRetentionService(db: EyasDb, primary: StorageProvider, bus: EyasBus) {
  /**
   * Sets retain_local_until for all non-deleted documents owned by the given entity.
   * Only documents that have a local file are updated.
   */
  function applyLifecycleRule(ownerModule: string, ownerId: string, localDays: number): void {
    db.run(
      sql`UPDATE documents
          SET retain_local_until = datetime('now', ${`+${localDays} days`}),
              updated_at = datetime('now')
          WHERE id IN (
            SELECT dl.document_id FROM document_links dl
            WHERE dl.owner_module = ${ownerModule} AND dl.owner_id = ${ownerId}
          )
            AND deleted_at IS NULL
            AND local_path IS NOT NULL`,
    )
  }

  /**
   * Removes local files for documents whose retention period has expired
   * and whose remote copy is confirmed synced.
   *
   * SAFETY: only cleans local files when remote_status = 'synced'.
   * Returns the number of documents cleaned.
   */
  async function cleanupExpired(): Promise<number> {
    const rows = (db as any).all(
      sql`SELECT id, storage_key FROM documents
          WHERE retain_local_until < datetime('now')
            AND local_path IS NOT NULL
            AND remote_status = 'synced'
            AND deleted_at IS NULL`,
    ) as ExpiredRow[]

    let cleaned = 0

    for (const row of rows) {
      const documentId = row.id
      const storageKey = row.storage_key

      await primary.delete(storageKey)

      db.run(
        sql`UPDATE documents
            SET local_path = NULL,
                updated_at = datetime('now')
            WHERE id = ${documentId}`,
      )

      bus.emit('eyas.documents.local.cleaned', { documentId })
      cleaned++
    }

    return cleaned
  }

  return { applyLifecycleRule, cleanupExpired }
}

export type RetentionService = ReturnType<typeof createRetentionService>
