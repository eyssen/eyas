// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

/**
 * A row exists ONLY once a user customises their home page. No row means the
 * factory default applies — which is what lets a later release add a tile that
 * reaches every un-customised user automatically (spec D1).
 */
export function createHomeTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS home_layouts (
    user_id      TEXT NOT NULL,
    breakpoint   TEXT NOT NULL DEFAULT 'lg',
    items        TEXT NOT NULL,
    base_version INTEGER NOT NULL DEFAULT 0,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, breakpoint)
  )`)
}
