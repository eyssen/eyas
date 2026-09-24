// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// One-time-in-effect, idempotent boot migration of the legacy thinking
// columns into the effort ladder (R1B-10). Before the effort ladder, a
// conversation could carry `thinking = 'on'` with a token budget and no
// effort; the gateway now plans thinking per model from the effort alone, so
// such a row would silently lose its reasoning. The budget becomes the level
// it was chosen as (the UI's presets were 5000 / 10000 / 25000 / 100000), and
// the legacy flag is cleared, so the row is converted exactly once.
//
// Deep conversations without an effort are left as they are: Deep already
// defaults their effort to Max, which is what they got before.

import { sql } from 'drizzle-orm'
import type { EffortLevel } from '@modules/model/reasoning/ladder.js'
import { clearOffLadderEffort } from '@modules/model/reasoning/stored-effort.js'

interface MigrationDb {
  all<T = unknown>(query: ReturnType<typeof sql>): T[]
  run(query: ReturnType<typeof sql>): unknown
}

interface MigrationLogger {
  info(obj: object, msg: string): void
  warn(obj: object, msg: string): void
}

/** A legacy thinking budget → the effort level it stood for. No budget → medium (the old 10000 default). */
export function effortFromLegacyBudget(budget: number | null | undefined): EffortLevel {
  if (budget === null || budget === undefined || !Number.isFinite(budget)) return 'medium'
  if (budget <= 5000) return 'low'
  if (budget <= 10000) return 'medium'
  if (budget <= 25000) return 'high'
  return 'max'
}

export interface LegacyEffortMigrationResult {
  /** Rows whose off-ladder effort value was cleared to Auto. */
  cleared: number
  /** Rows whose legacy thinking budget became an effort level. */
  converted: number
}

/**
 * Run the migration. First every stored effort that is not a ladder rung
 * becomes NULL (Auto); then every non-Deep row with no effort and
 * `thinking = 'on'` gets the level of its budget, and its legacy thinking
 * flag and budget are cleared. Running it again changes nothing.
 */
export function migrateLegacyThinkingToEffort(db: MigrationDb, logger?: MigrationLogger): LegacyEffortMigrationResult {
  const cleared = clearOffLadderEffort(db, 'conversations', logger)
  let converted = 0
  try {
    const rows = db.all<{ id: string; thinking_budget: number | null }>(sql`
      SELECT id, thinking_budget FROM conversations
      WHERE effort IS NULL AND thinking = 'on'
        AND (orchestration IS NULL OR orchestration != 'deep')
    `)
    for (const row of rows) {
      const effort = effortFromLegacyBudget(row.thinking_budget)
      db.run(sql`UPDATE conversations SET effort = ${effort}, thinking = 'off', thinking_budget = NULL
        WHERE id = ${row.id} AND effort IS NULL AND thinking = 'on'`)
      converted++
    }
    if (converted > 0) {
      logger?.info({ converted }, 'conversations: legacy thinking budgets converted to effort levels')
    }
  } catch (err) {
    logger?.warn({ err }, 'conversations: converting legacy thinking budgets to effort failed')
  }
  return { cleared, converted }
}
