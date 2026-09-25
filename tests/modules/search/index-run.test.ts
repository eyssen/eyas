import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestDb } from '../../helpers/test-db'
import { createSourceService } from '@modules/search/source-service'
import { createCodeIndexer } from '@modules/search/indexers/code/code-indexer'
import { createOramaProvider } from '@modules/search/providers/orama/orama-provider'
import { createVectorIndex } from '@modules/search/vector-index'
import { runIndexJob } from '@modules/search/index-run'
import type { SearchContext } from '@modules/search/types'

const testDb = createTestDb('search-index-run')
let db: ReturnType<typeof testDb.open>
let testDir: string

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} } as any
}

beforeEach(() => {
  db = testDb.open()
  db.run(sql`CREATE TABLE IF NOT EXISTS search_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, indexer TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'idle', chunk_count INTEGER NOT NULL DEFAULT 0, error_message TEXT, last_indexed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS search_chunks (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, collection TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', content_hash TEXT NOT NULL, embedding BLOB, embedding_model TEXT, created_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS search_file_state (source_id TEXT NOT NULL, file_path TEXT NOT NULL, mtime TEXT NOT NULL, chunk_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (source_id, file_path))`)
  testDir = join(tmpdir(), `eyas-idxrun-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(testDir, { recursive: true })
  writeFileSync(join(testDir, 'a.py'), 'def alpha():\n    return 1\n')
  writeFileSync(join(testDir, 'b.py'), 'def beta():\n    return 2\n')
})

afterEach(() => {
  testDb.cleanup()
  rmSync(testDir, { recursive: true, force: true })
})

async function makeCtx() {
  const sources = createSourceService(db)
  const provider = await createOramaProvider()
  const search: SearchContext = {
    sources,
    registry: { register() {}, get: () => null, list: () => [] },
    engine: null,
    vectorIndex: createVectorIndex(),
    embeddingBridge: null,
  }
  return { sources, provider, search }
}

describe('runIndexJob incremental', () => {
  it('persists chunks per file and marks the source ready', async () => {
    const { sources, provider, search } = await makeCtx()
    const source = sources.create({
      name: 'Tiny',
      type: 'code',
      indexer: 'code',
      config: { paths: [testDir] },
    })
    sources.setStatus(source.id, 'indexing')

    await runIndexJob({
      sourceId: source.id,
      source: sources.get(source.id)!,
      indexer: createCodeIndexer(),
      search,
      provider,
      db,
      logger: silentLogger(),
    })

    const done = sources.get(source.id)!
    expect(done.status).toBe('ready')
    expect(done.chunkCount).toBeGreaterThan(0)
    const rows = db.all(sql`SELECT COUNT(*) AS n FROM search_chunks WHERE source_id = ${source.id}`) as Array<{ n: number }>
    expect(Number(rows[0].n)).toBe(done.chunkCount)
    expect(sources.listFileStates(source.id).length).toBeGreaterThanOrEqual(2)

    const hits = await provider.search({ query: 'alpha', mode: 'fts', limit: 5 })
    expect(hits.some((h) => h.chunk.content.includes('alpha'))).toBe(true)
  })

  it('skips unchanged files on the second run', async () => {
    const { sources, provider, search } = await makeCtx()
    const source = sources.create({
      name: 'Tiny',
      type: 'code',
      indexer: 'code',
      config: { paths: [testDir] },
    })

    await runIndexJob({
      sourceId: source.id,
      source: sources.get(source.id)!,
      indexer: createCodeIndexer(),
      search,
      provider,
      db,
      logger: silentLogger(),
    })
    const first = sources.get(source.id)!.chunkCount
    const firstIds = (db.all(sql`SELECT id FROM search_chunks WHERE source_id = ${source.id}`) as Array<{ id: string }>).map((r) => r.id).sort()

    await runIndexJob({
      sourceId: source.id,
      source: sources.get(source.id)!,
      indexer: createCodeIndexer(),
      search,
      provider,
      db,
      logger: silentLogger(),
    })
    const secondIds = (db.all(sql`SELECT id FROM search_chunks WHERE source_id = ${source.id}`) as Array<{ id: string }>).map((r) => r.id).sort()
    expect(sources.get(source.id)!.chunkCount).toBe(first)
    expect(secondIds).toEqual(firstIds)
  })
})
