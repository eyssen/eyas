// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Tag pivot service. Aggregates tags across vault notes with note counts so
 * the UI can render a tag browser without re-parsing every file on each request.
 */

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export interface TagEntry {
  tag: string
  count: number
}

export interface NoteByTag {
  path: string
  title: string
  tier: string
}

export function createTagsService(db: EyasDb) {
  return {
    listTags(): TagEntry[] {
      const rows = (db as any).all(sql`SELECT tags FROM vault_index WHERE tags IS NOT NULL`) as Array<{ tags: string }>
      const counts = new Map<string, number>()
      for (const r of rows) {
        let parsed: unknown
        try { parsed = JSON.parse(r.tags) } catch { continue }
        if (!Array.isArray(parsed)) continue
        for (const raw of parsed) {
          const t = String(raw).trim()
          if (t.length === 0) continue
          counts.set(t, (counts.get(t) ?? 0) + 1)
        }
      }
      return Array.from(counts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    },

    notesByTag(tag: string): NoteByTag[] {
      // Stored tags are JSON arrays; LIKE with the needle surrounded by quotes is
      // a cheap filter that's good enough for the pivot view.
      const needle = `%"${tag.replace(/[%_]/g, m => '\\' + m)}"%`
      const rows = (db as any).all(sql`
        SELECT path, title, tier, tags FROM vault_index
        WHERE tags LIKE ${needle} ESCAPE '\\'
      `) as Array<{ path: string; title: string; tier: string; tags: string }>
      return rows
        .filter(r => {
          try { return (JSON.parse(r.tags) as string[]).includes(tag) } catch { return false }
        })
        .map(r => ({ path: r.path, title: r.title, tier: r.tier }))
    },
  }
}

export type TagsService = ReturnType<typeof createTagsService>
