// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

// --- Types ---

export type WikilinkNodeType = 'vault' | 'knowledge'

export interface ParsedWikilink {
  targetType: WikilinkNodeType
  targetId: string
  context: string
}

export interface WikilinkRecord {
  id: number
  sourceType: WikilinkNodeType
  sourceId: string
  targetType: WikilinkNodeType
  targetId: string
  context: string | null
  createdAt: string
}

export interface WikilinkNeighbor {
  type: WikilinkNodeType
  id: string
}

// --- Service ---

export function createWikilinkService(db: EyasDb) {
  return {
    init() {
      db.run(sql`CREATE TABLE IF NOT EXISTS wikilinks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        context TEXT,
        created_at TEXT NOT NULL
      )`)
      db.run(sql`CREATE INDEX IF NOT EXISTS idx_wikilinks_source ON wikilinks(source_type, source_id)`)
      db.run(sql`CREATE INDEX IF NOT EXISTS idx_wikilinks_target ON wikilinks(target_type, target_id)`)
    },

    syncLinks(sourceType: WikilinkNodeType, sourceId: string, links: ParsedWikilink[]) {
      const now = new Date().toISOString()
      db.run(sql`DELETE FROM wikilinks WHERE source_type = ${sourceType} AND source_id = ${sourceId}`)
      for (const link of links) {
        db.run(sql`INSERT INTO wikilinks (source_type, source_id, target_type, target_id, context, created_at)
          VALUES (${sourceType}, ${sourceId}, ${link.targetType}, ${link.targetId}, ${link.context}, ${now})`)
      }
    },

    getOutgoing(sourceType: WikilinkNodeType, sourceId: string): WikilinkRecord[] {
      return (db as any).all(
        sql`SELECT id, source_type as sourceType, source_id as sourceId,
            target_type as targetType, target_id as targetId, context, created_at as createdAt
            FROM wikilinks WHERE source_type = ${sourceType} AND source_id = ${sourceId}`
      ) as WikilinkRecord[]
    },

    getBacklinks(targetType: WikilinkNodeType, targetId: string): WikilinkRecord[] {
      return (db as any).all(
        sql`SELECT id, source_type as sourceType, source_id as sourceId,
            target_type as targetType, target_id as targetId, context, created_at as createdAt
            FROM wikilinks WHERE target_type = ${targetType} AND target_id = ${targetId}`
      ) as WikilinkRecord[]
    },

    getNeighbors(nodeType: WikilinkNodeType, nodeId: string): WikilinkNeighbor[] {
      const outgoing = (db as any).all(
        sql`SELECT target_type as type, target_id as id FROM wikilinks
            WHERE source_type = ${nodeType} AND source_id = ${nodeId}`
      ) as WikilinkNeighbor[]

      const incoming = (db as any).all(
        sql`SELECT source_type as type, source_id as id FROM wikilinks
            WHERE target_type = ${nodeType} AND target_id = ${nodeId}`
      ) as WikilinkNeighbor[]

      const seen = new Set<string>()
      const result: WikilinkNeighbor[] = []
      for (const n of [...outgoing, ...incoming]) {
        const key = `${n.type}:${n.id}`
        if (!seen.has(key)) {
          seen.add(key)
          result.push(n)
        }
      }
      return result
    },

    removeSource(sourceType: WikilinkNodeType, sourceId: string) {
      db.run(sql`DELETE FROM wikilinks WHERE source_type = ${sourceType} AND source_id = ${sourceId}`)
    },
  }
}

export type WikilinkService = ReturnType<typeof createWikilinkService>
