// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { SearchSource, CreateSourceInput, UpdateSourceInput, SourceStatus, FileState, SourceService } from './types.js'

function toSource(raw: any): SearchSource {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    indexer: raw.indexer,
    config: JSON.parse(raw.config || '{}'),
    status: raw.status,
    chunkCount: raw.chunk_count,
    errorMessage: raw.error_message,
    lastIndexedAt: raw.last_indexed_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

export function createSourceService(db: any): SourceService {
  return {
    create(input: CreateSourceInput): SearchSource {
      const id = generateId()
      const now = new Date().toISOString()
      const config = JSON.stringify(input.config)
      db.run(sql`INSERT INTO search_sources (id, name, type, indexer, config, status, chunk_count, created_at, updated_at) VALUES (${id}, ${input.name}, ${input.type}, ${input.indexer}, ${config}, 'idle', 0, ${now}, ${now})`)
      return this.get(id)!
    },

    get(id: string): SearchSource | null {
      const rows = db.all(sql`SELECT * FROM search_sources WHERE id = ${id}`) as any[]
      return rows.length > 0 ? toSource(rows[0]) : null
    },

    list(): SearchSource[] {
      return (db.all(sql`SELECT * FROM search_sources ORDER BY created_at`) as any[]).map(toSource)
    },

    update(id: string, input: UpdateSourceInput): void {
      const now = new Date().toISOString()
      if (input.name !== undefined) db.run(sql`UPDATE search_sources SET name = ${input.name}, updated_at = ${now} WHERE id = ${id}`)
      if (input.config !== undefined) db.run(sql`UPDATE search_sources SET config = ${JSON.stringify(input.config)}, updated_at = ${now} WHERE id = ${id}`)
    },

    delete(id: string): void {
      db.run(sql`DELETE FROM search_file_state WHERE source_id = ${id}`)
      db.run(sql`DELETE FROM search_sources WHERE id = ${id}`)
    },

    setStatus(id: string, status: SourceStatus, errorMessage?: string | null): void {
      const now = new Date().toISOString()
      db.run(sql`UPDATE search_sources SET status = ${status}, error_message = ${errorMessage ?? null}, updated_at = ${now} WHERE id = ${id}`)
    },

    setIndexed(id: string, chunkCount: number): void {
      const now = new Date().toISOString()
      db.run(sql`UPDATE search_sources SET status = 'ready', chunk_count = ${chunkCount}, last_indexed_at = ${now}, error_message = ${null}, updated_at = ${now} WHERE id = ${id}`)
    },

    setProgress(id: string, chunkCount: number): void {
      const now = new Date().toISOString()
      db.run(sql`UPDATE search_sources SET chunk_count = ${chunkCount}, updated_at = ${now} WHERE id = ${id}`)
    },

    getFileState(sourceId: string, filePath: string): FileState | null {
      const rows = db.all(sql`SELECT * FROM search_file_state WHERE source_id = ${sourceId} AND file_path = ${filePath}`) as any[]
      if (rows.length === 0) return null
      return { sourceId: rows[0].source_id, filePath: rows[0].file_path, mtime: rows[0].mtime, chunkCount: rows[0].chunk_count }
    },

    listFileStates(sourceId: string): FileState[] {
      const rows = db.all(sql`SELECT * FROM search_file_state WHERE source_id = ${sourceId}`) as any[]
      return rows.map((r) => ({
        sourceId: r.source_id,
        filePath: r.file_path,
        mtime: r.mtime,
        chunkCount: r.chunk_count,
      }))
    },

    setFileState(sourceId: string, filePath: string, mtime: string, chunkCount: number): void {
      db.run(sql`INSERT OR REPLACE INTO search_file_state (source_id, file_path, mtime, chunk_count) VALUES (${sourceId}, ${filePath}, ${mtime}, ${chunkCount})`)
    },

    removeFileStates(sourceId: string): void {
      db.run(sql`DELETE FROM search_file_state WHERE source_id = ${sourceId}`)
    },

    removeDeletedFileStates(sourceId: string, currentPaths: string[]): string[] {
      const allStates = db.all(sql`SELECT file_path FROM search_file_state WHERE source_id = ${sourceId}`) as any[]
      const currentSet = new Set(currentPaths)
      const removed: string[] = []
      for (const row of allStates) {
        if (!currentSet.has(row.file_path)) {
          removed.push(row.file_path)
          db.run(sql`DELETE FROM search_file_state WHERE source_id = ${sourceId} AND file_path = ${row.file_path}`)
        }
      }
      return removed
    },
  }
}
