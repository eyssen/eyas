// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export interface LayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
  config?: Record<string, unknown>
}

export interface StoredLayout {
  items: LayoutItem[]
  baseVersion: number
}

export function createLayoutService(db: EyasDb) {
  return {
    get(userId: string, breakpoint: string): StoredLayout | null {
      const row = db
        .all(sql`SELECT items, base_version FROM home_layouts
                 WHERE user_id = ${userId} AND breakpoint = ${breakpoint}`)[0] as
        { items: string; base_version: number } | undefined
      if (!row) return null
      try {
        return { items: JSON.parse(row.items) as LayoutItem[], baseVersion: row.base_version }
      } catch {
        // Corrupt/unparseable items row — treat as "no usable layout" rather
        // than 500ing the home page. The caller falls back to the factory
        // default, same as a user who has never customised their layout.
        return null
      }
    },

    save(userId: string, breakpoint: string, items: LayoutItem[], baseVersion = 0): void {
      db.run(sql`INSERT INTO home_layouts (user_id, breakpoint, items, base_version, updated_at)
                 VALUES (${userId}, ${breakpoint}, ${JSON.stringify(items)}, ${baseVersion}, datetime('now'))
                 ON CONFLICT(user_id, breakpoint) DO UPDATE SET
                   items = excluded.items,
                   base_version = excluded.base_version,
                   updated_at = datetime('now')`)
    },

    reset(userId: string, breakpoint: string): void {
      db.run(sql`DELETE FROM home_layouts WHERE user_id = ${userId} AND breakpoint = ${breakpoint}`)
    },
  }
}
