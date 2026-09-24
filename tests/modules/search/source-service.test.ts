import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createSourceService } from '@modules/search/source-service'
import type { SourceService } from '@modules/search/types'

const testDb = createTestDb('search-sources')
let db: ReturnType<typeof testDb.open>
let svc: SourceService

beforeEach(() => {
  db = testDb.open()
  db.run(sql`CREATE TABLE IF NOT EXISTS search_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, indexer TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'idle', chunk_count INTEGER NOT NULL DEFAULT 0, error_message TEXT, last_indexed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS search_file_state (source_id TEXT NOT NULL, file_path TEXT NOT NULL, mtime TEXT NOT NULL, chunk_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (source_id, file_path))`)
  svc = createSourceService(db)
})
afterEach(() => testDb.cleanup())

describe('SourceService', () => {
  describe('create', () => {
    it('creates a source with defaults', () => {
      const source = svc.create({ name: 'Test', type: 'code', indexer: 'code', config: { paths: ['/tmp'] } })
      expect(source.id).toBeTruthy()
      expect(source.name).toBe('Test')
      expect(source.type).toBe('code')
      expect(source.indexer).toBe('code')
      expect(source.status).toBe('idle')
      expect(source.chunkCount).toBe(0)
      expect(source.config.paths).toEqual(['/tmp'])
    })
  })

  describe('list', () => {
    it('returns all sources', () => {
      svc.create({ name: 'A', type: 'code', indexer: 'code', config: {} })
      svc.create({ name: 'B', type: 'docs', indexer: 'docs', config: {} })
      expect(svc.list()).toHaveLength(2)
    })
  })

  describe('update', () => {
    it('updates name and config', () => {
      const s = svc.create({ name: 'Old', type: 'code', indexer: 'code', config: {} })
      svc.update(s.id, { name: 'New', config: { paths: ['/new'] } })
      const updated = svc.get(s.id)!
      expect(updated.name).toBe('New')
      expect(updated.config.paths).toEqual(['/new'])
    })
  })

  describe('delete', () => {
    it('deletes a source and its file states', () => {
      const s = svc.create({ name: 'Del', type: 'code', indexer: 'code', config: {} })
      svc.setFileState(s.id, '/tmp/a.ts', '2026-01-01', 5)
      svc.delete(s.id)
      expect(svc.get(s.id)).toBeNull()
      expect(svc.getFileState(s.id, '/tmp/a.ts')).toBeNull()
    })
  })

  describe('setStatus', () => {
    it('updates status and error message', () => {
      const s = svc.create({ name: 'S', type: 'code', indexer: 'code', config: {} })
      svc.setStatus(s.id, 'error', 'Something failed')
      const updated = svc.get(s.id)!
      expect(updated.status).toBe('error')
      expect(updated.errorMessage).toBe('Something failed')
    })
  })

  describe('setIndexed', () => {
    it('updates chunk count and last indexed timestamp', () => {
      const s = svc.create({ name: 'S', type: 'code', indexer: 'code', config: {} })
      svc.setIndexed(s.id, 42)
      const updated = svc.get(s.id)!
      expect(updated.chunkCount).toBe(42)
      expect(updated.status).toBe('ready')
      expect(updated.lastIndexedAt).toBeTruthy()
    })
  })

  describe('setProgress', () => {
    it('updates chunk count without flipping status to ready', () => {
      const s = svc.create({ name: 'S', type: 'code', indexer: 'code', config: {} })
      svc.setStatus(s.id, 'indexing')
      svc.setProgress(s.id, 120)
      const updated = svc.get(s.id)!
      expect(updated.chunkCount).toBe(120)
      expect(updated.status).toBe('indexing')
      expect(updated.lastIndexedAt).toBeNull()
    })
  })

  describe('listFileStates', () => {
    it('returns every file state for a source', () => {
      const s = svc.create({ name: 'S', type: 'code', indexer: 'code', config: {} })
      svc.setFileState(s.id, '/a.ts', '2026-01-01', 2)
      svc.setFileState(s.id, '/b.ts', '2026-01-02', 3)
      const list = svc.listFileStates(s.id)
      expect(list).toHaveLength(2)
      expect(list.map((f) => f.filePath).sort()).toEqual(['/a.ts', '/b.ts'])
    })
  })

  describe('file state', () => {
    it('tracks file mtime', () => {
      const s = svc.create({ name: 'S', type: 'code', indexer: 'code', config: {} })
      svc.setFileState(s.id, '/a.ts', '2026-01-01T00:00:00Z', 3)
      const state = svc.getFileState(s.id, '/a.ts')
      expect(state!.mtime).toBe('2026-01-01T00:00:00Z')
      expect(state!.chunkCount).toBe(3)
    })

    it('removes deleted file states and returns removed paths', () => {
      const s = svc.create({ name: 'S', type: 'code', indexer: 'code', config: {} })
      svc.setFileState(s.id, '/a.ts', '2026-01-01', 1)
      svc.setFileState(s.id, '/b.ts', '2026-01-01', 1)
      svc.setFileState(s.id, '/c.ts', '2026-01-01', 1)
      const removed = svc.removeDeletedFileStates(s.id, ['/a.ts', '/c.ts'])
      expect(removed).toEqual(['/b.ts'])
      expect(svc.getFileState(s.id, '/b.ts')).toBeNull()
    })
  })
})
