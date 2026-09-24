// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Boot repair for stored effort columns: before write-time validation
// existed, a PATCH could store any string ('extreme', 'auto', ''), and the
// runtime silently ignored it. Every such value becomes NULL (Auto), so what
// the database holds is exactly what the UI can show and the gateway reads.
//
// Backend only (it runs SQL); the web imports the pure reasoning files, not this one.

import { sql } from 'drizzle-orm'
import { EFFORT_LADDER } from './ladder.js'

/** The tables that store a user-chosen effort rung in an `effort` column. */
export type StoredEffortTable = 'conversations' | 'agent_definitions'

interface MigrationDb {
  all<T = unknown>(query: ReturnType<typeof sql>): T[]
  run(query: ReturnType<typeof sql>): unknown
}

interface MigrationLogger {
  warn(obj: object, msg: string): void
}

/** The ladder as an SQL literal list — built from constants only, never from input. */
const LADDER_SQL = EFFORT_LADDER.map((level) => `'${level}'`).join(', ')

/**
 * Set every `effort` value that is not a ladder rung to NULL. Idempotent: a
 * second run finds nothing. Returns how many rows were repaired (0 when the
 * table or column does not exist yet). A repair is logged once with its count.
 */
export function clearOffLadderEffort(db: MigrationDb, table: StoredEffortTable, logger?: MigrationLogger): number {
  // `table` is one of two literals from the type above — safe for sql.raw.
  const where = `effort IS NOT NULL AND effort NOT IN (${LADDER_SQL})`
  try {
    const rows = db.all<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))
    const count = Number(rows[0]?.n ?? 0)
    if (count === 0) return 0
    db.run(sql.raw(`UPDATE ${table} SET effort = NULL WHERE ${where}`))
    logger?.warn({ table, count }, 'effort: cleared stored values that are not an effort level (now Auto)')
    return count
  } catch (err) {
    logger?.warn({ err, table }, 'effort: could not check stored effort values')
    return 0
  }
}
