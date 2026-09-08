// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestDb } from '../../helpers/test-db'
import { createToolContractHarness, type ToolContractHarness } from '../../helpers/tool-contract'
import { createSourceService } from '@modules/search/source-service'
import { createIndexerRegistry } from '@modules/search/registry'
import { createOramaProvider } from '@modules/search/providers/orama/orama-provider'
import { createSearchEngine } from '@modules/search/engine'
import { createCodeIndexer } from '@modules/search/indexers/code/code-indexer'
import { createSearchTools } from '@modules/tools/builtin/search-tools'

/**
 * Contract test: `search_indexed` against the REAL Orama-backed search engine.
 * The tool called `service.search(query, opts)` on the context object the
 * search module publishes (`{ sources, registry, engine }`) — the searchable
 * surface is `service.engine.search(SearchQuery)`, and `engine` stays null
 * until search.onStart.
 */

const testDb = createTestDb('search-tools-contract')
let db: ReturnType<typeof testDb.open>
let testDir: string
let searchCtx: { sources: any; registry: any; engine: any }
let harness: ToolContractHarness
let sourceId: string

beforeEach(async () => {
  db = testDb.open()
  db.run(sql`CREATE TABLE IF NOT EXISTS search_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, indexer TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'idle', chunk_count INTEGER NOT NULL DEFAULT 0, error_message TEXT, last_indexed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS search_chunks (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, collection TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', content_hash TEXT NOT NULL, embedding BLOB, embedding_model TEXT, created_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS search_file_state (source_id TEXT NOT NULL, file_path TEXT NOT NULL, mtime TEXT NOT NULL, chunk_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (source_id, file_path))`)

  testDir = join(tmpdir(), `eyas-searchtools-${Date.now()}`)
  mkdirSync(join(testDir, 'code'), { recursive: true })
  writeFileSync(join(testDir, 'code', 'auth.ts'), `
export async function authenticateUser(username: string, password: string) {
  const user = await findUser(username)
  return user ? generateToken(user) : null
}
`)

  const sources = createSourceService(db)
  const registry = createIndexerRegistry()
  registry.register('code', createCodeIndexer())

  const provider = await createOramaProvider()
  const engine = createSearchEngine(provider)

  const source = sources.create({
    name: 'Contract Code',
    type: 'code',
    indexer: 'code',
    config: { paths: [join(testDir, 'code')] },
  })
  sourceId = source.id

  const chunks = await registry.get('code')!.index(source)
  await provider.addDocuments('code', chunks)
  sources.setIndexed(source.id, chunks.length)

  // Exactly the object shape src/modules/search/index.ts publishes on ctx.
  searchCtx = { sources, registry, engine }
  harness = createToolContractHarness(createSearchTools(() => searchCtx))
})

afterEach(() => {
  testDb.cleanup()
  rmSync(testDir, { recursive: true, force: true })
})

describe('search tools ↔ search engine contract', () => {
  it('search_indexed returns flattened chunk hits from the real engine', async () => {
    const r = await harness.run('search_indexed', { query: 'authenticateUser' })

    expect(r.success).toBe(true)
    const output = r.output as any
    expect(output.error).toBeUndefined()
    expect(output.results.length).toBeGreaterThan(0)

    const hit = output.results[0]
    expect(hit.content).toContain('authenticateUser')
    expect(typeof hit.score).toBe('number')
    expect(hit.sourceId).toBe(sourceId)
    expect(hit.collection).toBe('code')
    expect(hit.metadata).toBeDefined()
  })

  it('search_indexed passes the sourceId filter through to the engine', async () => {
    const r = await harness.run('search_indexed', { query: 'authenticateUser', sourceId: 'some-other-source' })

    expect(r.success).toBe(true)
    expect((r.output as any).results).toHaveLength(0)
  })

  it('fails soft (structured error, not throw) before search.onStart builds the engine', async () => {
    // ctx.search exists from search.onRegister but carries engine: null.
    const h = createToolContractHarness(
      createSearchTools(() => ({ sources: searchCtx.sources, registry: searchCtx.registry, engine: null })),
    )

    const r = await h.run('search_indexed', { query: 'x' })

    expect(r.success).toBe(true)
    expect((r.output as any).error).toMatch(/not (ready|initialized)/i)
  })

  it('fails soft when the search module is absent entirely', async () => {
    const h = createToolContractHarness(createSearchTools(() => undefined))

    const r = await h.run('search_indexed', { query: 'x' })

    expect(r.success).toBe(true)
    expect((r.output as any).error).toMatch(/not (ready|initialized)/i)
  })

  it('list_search_sources returns ready sources with paths and chunk counts', async () => {
    const r = await harness.run('list_search_sources', {})

    expect(r.success).toBe(true)
    const output = r.output as any
    expect(output.error).toBeUndefined()
    expect(output.total).toBeGreaterThanOrEqual(1)
    expect(output.readyCount).toBeGreaterThanOrEqual(1)

    const src = output.sources.find((s: any) => s.id === sourceId)
    expect(src).toBeTruthy()
    expect(src.name).toBe('Contract Code')
    expect(src.indexer).toBe('code')
    expect(src.status).toBe('ready')
    expect(src.chunkCount).toBeGreaterThan(0)
    expect(Array.isArray(src.paths)).toBe(true)
    expect(src.paths.length).toBeGreaterThan(0)
  })

  it('list_search_sources readyOnly filters non-ready sources', async () => {
    searchCtx.sources.create({
      name: 'Idle Source',
      type: 'code',
      indexer: 'code',
      config: { paths: ['/tmp/unused'] },
    })

    const all = await harness.run('list_search_sources', {})
    expect((all.output as any).total).toBeGreaterThanOrEqual(2)

    const ready = await harness.run('list_search_sources', { readyOnly: true })
    const readyOut = ready.output as any
    expect(readyOut.sources.every((s: any) => s.status === 'ready')).toBe(true)
    expect(readyOut.readyCount).toBe(readyOut.total)
  })

  it('list_search_sources fails soft when the search module is absent', async () => {
    const h = createToolContractHarness(createSearchTools(() => undefined))
    const r = await h.run('list_search_sources', {})
    expect(r.success).toBe(true)
    expect((r.output as any).error).toMatch(/not ready/i)
  })
})
