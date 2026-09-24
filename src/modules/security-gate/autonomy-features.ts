// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'

/**
 * Loop enable/disable flags for the Phase-3 self-improvement loops.
 *
 * This is a SEPARATE, minimal on/off store — NOT the autonomy_categories
 * trust-ladder (autonomy-policy.ts). The ladder measures action-RISK
 * autonomy (L1 = strictest floor, notice-only; it never goes "off"), so
 * mapping a loop's enabled/disabled state onto it would be a category error.
 * Each Phase-3 loop (heartbeat composer, reflection enrichment, forge/
 * self-learning/skill authoring) is OFF by default and toggled here; the
 * loops' APPLY actions still go through the ladder's approval gate
 * (autonomyPolicy.createApproval) unchanged — this store only gates whether
 * a loop fires at all.
 */

export interface FeatureFlag {
  key: string
  enabled: boolean
}

/** The 5 Phase-3 loop keys, seeded OFF. */
const FEATURE_SEED: readonly string[] = [
  'proactive.heartbeat',
  'memory.reflection',
  'forge.apply',
  'selfLearning.apply',
  'skill.adopt',
]

interface FeatureRow {
  key: string
  enabled: number
  updated_at: string
  updated_by: string | null
}

/**
 * Create (if needed) the autonomy_features table, seed the 5 loop keys
 * OFF (append-only — re-running never resets an operator-set flag), and
 * return the read/write API. `isEnabled`/`list` read the DB fresh on every
 * call — later tasks rely on toggling a loop at runtime with no restart.
 */
export function createAutonomyFeatures(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS autonomy_features (
    key TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  )`)

  const now = new Date().toISOString()
  for (const key of FEATURE_SEED) {
    db.run(sql`INSERT OR IGNORE INTO autonomy_features (key, enabled, updated_at, updated_by)
      VALUES (${key}, 0, ${now}, NULL)`)
  }

  return {
    /** Read fresh — callers gate at fire time, never cache this. Unknown key fails safe to off. */
    isEnabled(key: string): boolean {
      const rows = db.all(sql`SELECT enabled FROM autonomy_features WHERE key = ${key}`) as Array<{ enabled: number }>
      return !!rows[0]?.enabled
    },

    setEnabled(key: string, on: boolean, actor: string): void {
      const updatedAt = new Date().toISOString()
      db.run(sql`UPDATE autonomy_features SET enabled = ${on ? 1 : 0}, updated_at = ${updatedAt}, updated_by = ${actor} WHERE key = ${key}`)
    },

    list(): FeatureFlag[] {
      const rows = db.all(sql`SELECT * FROM autonomy_features ORDER BY key`) as FeatureRow[]
      return rows.map((r) => ({ key: r.key, enabled: !!r.enabled }))
    },
  }
}

export type AutonomyFeatures = ReturnType<typeof createAutonomyFeatures>
