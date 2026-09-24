import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createSourceService } from '@modules/search/source-service'
import { createIndexerRegistry } from '@modules/search/registry'
import { createOramaProvider } from '@modules/search/providers/orama/orama-provider'
import { createSearchEngine } from '@modules/search/engine'
import { createCodeIndexer } from '@modules/search/indexers/code/code-indexer'
import { createDocIndexer } from '@modules/search/indexers/docs/doc-indexer'
import { createFileIndexer } from '@modules/search/indexers/files/file-indexer'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDb = createTestDb('search-integration')
let db: ReturnType<typeof testDb.open>
let testDir: string

beforeEach(() => {
  db = testDb.open()
  db.run(sql`CREATE TABLE IF NOT EXISTS search_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, indexer TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'idle', chunk_count INTEGER NOT NULL DEFAULT 0, error_message TEXT, last_indexed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS search_chunks (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, collection TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', content_hash TEXT NOT NULL, embedding BLOB, embedding_model TEXT, created_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS search_file_state (source_id TEXT NOT NULL, file_path TEXT NOT NULL, mtime TEXT NOT NULL, chunk_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (source_id, file_path))`)

  testDir = join(tmpdir(), `eyas-search-integ-${Date.now()}`)
  mkdirSync(join(testDir, 'code'), { recursive: true })
  mkdirSync(join(testDir, 'docs'), { recursive: true })
})

afterEach(() => {
  testDb.cleanup()
  rmSync(testDir, { recursive: true, force: true })
})

describe('Search Integration', () => {
  it('indexes code, then searches and finds relevant results', async () => {
    writeFileSync(join(testDir, 'code', 'auth.ts'), `
export async function authenticateUser(username: string, password: string) {
  const user = await findUser(username)
  if (!user) throw new Error('User not found')
  const valid = await verifyPassword(password, user.passwordHash)
  return valid ? generateToken(user) : null
}
`)
    writeFileSync(join(testDir, 'code', 'db.ts'), `
export class DatabasePool {
  async query(sql: string, params: unknown[]) {
    return this.pool.query(sql, params)
  }
}
`)

    const sources = createSourceService(db)
    const registry = createIndexerRegistry()
    registry.register('code', createCodeIndexer())

    const provider = await createOramaProvider()
    const engine = createSearchEngine(provider)

    const source = sources.create({
      name: 'Test Code',
      type: 'code',
      indexer: 'code',
      config: { paths: [join(testDir, 'code')] },
    })

    const indexer = registry.get('code')!
    const chunks = await indexer.index(source)
    expect(chunks.length).toBeGreaterThan(0)

    await provider.addDocuments('code', chunks)
    sources.setIndexed(source.id, chunks.length)

    const results = await engine.search({ query: 'authenticateUser' })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].chunk.content).toContain('authenticateUser')
  })

  it('indexes docs and code, then searches across both', async () => {
    writeFileSync(join(testDir, 'code', 'api.ts'), 'export function getUsers() { return [] }\n')
    writeFileSync(join(testDir, 'docs', 'api-guide.md'), '# API Guide\n\n## Users\n\nUse getUsers endpoint to list all users.\n')

    const sources = createSourceService(db)
    const registry = createIndexerRegistry()
    registry.register('code', createCodeIndexer())
    registry.register('docs', createDocIndexer())

    const provider = await createOramaProvider()
    const engine = createSearchEngine(provider)

    const codeSrc = sources.create({ name: 'Code', type: 'code', indexer: 'code', config: { paths: [join(testDir, 'code')] } })
    const codeChunks = await registry.get('code')!.index(codeSrc)
    await provider.addDocuments('code', codeChunks)

    const docSrc = sources.create({ name: 'Docs', type: 'docs', indexer: 'docs', config: { paths: [join(testDir, 'docs')] } })
    const docChunks = await registry.get('docs')!.index(docSrc)
    await provider.addDocuments('docs', docChunks)

    const results = await engine.search({ query: 'getUsers' })
    expect(results.length).toBeGreaterThanOrEqual(1)

    const docsOnly = await engine.search({ query: 'getUsers', collections: ['docs'] })
    expect(docsOnly.every(r => r.chunk.collection === 'docs')).toBe(true)
  })
})
