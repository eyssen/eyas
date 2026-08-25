// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'
import type { ArchivedMemory } from '../types.js'

export interface ArchiveInput {
  originalId: string
  content: string
  sourceType: string
  tags: string[]
  originalCreatedAt: string
}

function rowToArchive(r: any): ArchivedMemory {
  return {
    id: r.id, originalId: r.original_id, content: r.content,
    sourceType: r.source_type, tags: r.tags ? JSON.parse(r.tags) : [],
    archivedAt: r.archived_at, originalCreatedAt: r.original_created_at,
  }
}

export function createArchiveMemoryService(db: EyasDb) {
  return {
    archive(input: ArchiveInput): ArchivedMemory {
      const id = generateId()
      const now = new Date().toISOString()
      const tags = input.tags.length > 0 ? JSON.stringify(input.tags) : null

      db.run(sql`INSERT INTO archive_memories
        (id, original_id, content, source_type, tags, archived_at, original_created_at)
        VALUES (${id}, ${input.originalId}, ${input.content}, ${input.sourceType},
                ${tags}, ${now}, ${input.originalCreatedAt})`)

      return this.get(id)!
    },

    get(id: string): ArchivedMemory | null {
      const rows = (db as any).all(sql`SELECT * FROM archive_memories WHERE id = ${id}`) as any[]
      return rows.length > 0 ? rowToArchive(rows[0]) : null
    },

    list(limit: number = 50): ArchivedMemory[] {
      return ((db as any).all(
        sql`SELECT * FROM archive_memories ORDER BY archived_at DESC LIMIT ${limit}`
      ) as any[]).map(rowToArchive)
    },

    search(query: string): ArchivedMemory[] {
      const pattern = `%${query}%`
      return ((db as any).all(
        sql`SELECT * FROM archive_memories WHERE content LIKE ${pattern} ORDER BY archived_at DESC LIMIT 20`
      ) as any[]).map(rowToArchive)
    },
  }
}

export type ArchiveMemoryService = ReturnType<typeof createArchiveMemoryService>
