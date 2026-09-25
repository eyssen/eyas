// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export interface RetentionResult {
  compressed: number
  archived: number
  deleted: number
}

/**
 * Manages audit entry lifecycle: hot -> warm -> cold -> delete.
 * Designed to be called daily by the scheduler.
 */
export function runRetention(db: EyasDb): RetentionResult {
  const result: RetentionResult = { compressed: 0, archived: 0, deleted: 0 }

  // Delete: entries older than 365 days (and their snapshots)
  const oldEntries = (db as any).all(
    sql`SELECT id, snapshot_id FROM audit_entries WHERE timestamp < datetime('now', '-365 days')`
  ) as any[]

  for (const entry of oldEntries) {
    if (entry.snapshot_id) {
      db.run(sql`DELETE FROM audit_snapshots WHERE id = ${entry.snapshot_id}`)
    }
    db.run(sql`DELETE FROM audit_entries WHERE id = ${entry.id}`)
    result.deleted++
  }

  // Cold: 90-365 days — mark details as archived (strip to summary)
  const coldEntries = (db as any).all(
    sql`SELECT id, details FROM audit_entries WHERE timestamp < datetime('now', '-90 days') AND timestamp >= datetime('now', '-365 days') AND details IS NOT NULL AND details != '"[archived]"'`
  ) as any[]

  for (const entry of coldEntries) {
    db.run(sql`UPDATE audit_entries SET details = '"[archived]"' WHERE id = ${entry.id}`)
    result.archived++
  }

  // Warm: 30-90 days — compress details (minify JSON, remove verbose fields)
  const warmEntries = (db as any).all(
    sql`SELECT id, details FROM audit_entries WHERE timestamp < datetime('now', '-30 days') AND timestamp >= datetime('now', '-90 days') AND details IS NOT NULL AND details != '"[archived]"' AND length(details) > 200`
  ) as any[]

  for (const entry of warmEntries) {
    try {
      const parsed = JSON.parse(entry.details)
      // Keep only top-level keys, truncate large values
      const compressed: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && value.length > 100) {
          compressed[key] = value.slice(0, 100) + '...'
        } else if (Array.isArray(value)) {
          compressed[key] = `[${value.length} items]`
        } else {
          compressed[key] = value
        }
      }
      const compressedJson = JSON.stringify(compressed)
      db.run(sql`UPDATE audit_entries SET details = ${compressedJson} WHERE id = ${entry.id}`)
      result.compressed++
    } catch {
      // Skip entries with invalid JSON
    }
  }

  return result
}
