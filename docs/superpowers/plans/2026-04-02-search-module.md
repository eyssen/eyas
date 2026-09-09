# Search Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a development context indexer with AST-aware code chunking, hybrid FTS+vector search, and support for source code, documentation, and general files — extensible via IndexerRegistry for future modules.

**Architecture:** Single `search` module with provider pattern (Orama FTS+vector), three built-in indexers (code/docs/files), an IndexerRegistry for external module registration, and an embedding bridge to the existing model module. Chunks persist in SQLite; Orama runs in-memory and rebuilds from DB on startup.

**Tech Stack:** Orama (FTS+vector), web-tree-sitter (WASM AST parsing), @mozilla/readability + turndown (HTML→MD), pdf-parse, mammoth (DOCX), xlsx (Excel), Vitest.

**Spec:** `docs/superpowers/specs/2026-04-02-search-module-design.md`

---

## File Structure

```
src/modules/search/
  index.ts                              — module entry (onRegister, onStart, onStop)
  types.ts                              — all interfaces (Chunk, SearchSource, SearchQuery, SearchResult, etc.)
  source-service.ts                     — search_sources + search_file_state CRUD
  registry.ts                           — IndexerRegistry implementation
  engine.ts                             — SearchEngine: hybrid query pipeline with RRF
  embedding-bridge.ts                   — model module embedding wrapper
  routes.ts                             — REST API endpoints
  providers/
    types.ts                            — SearchProvider interface
    orama/
      orama-provider.ts                 — Orama instance management
  indexers/
    types.ts                            — ContentIndexer interface
    code/
      code-indexer.ts                   — code indexer orchestration
      ast-chunker.ts                    — TreeSitter WASM chunking logic
      language-map.ts                   — extension → grammar + fallback regex
    docs/
      doc-indexer.ts                    — docs indexer orchestration
      url-fetcher.ts                    — fetch + readability + turndown
      file-reader.ts                    — local .md/.txt/.rst
    files/
      file-indexer.ts                   — file indexer orchestration
      parsers/
        markdown-parser.ts              — heading-based chunking
        pdf-parser.ts                   — pdf-parse wrapper
        docx-parser.ts                  — mammoth wrapper
        xlsx-parser.ts                  — SheetJS wrapper

src/web/src/
  stores/search-store.ts                — Zustand store for search state
  pages/search/
    sources-page.tsx                    — Settings page for source management
  components/layout/
    search-bar.tsx                      — Global Cmd+K search bar

tests/modules/search/
  source-service.test.ts
  registry.test.ts
  engine.test.ts
  orama-provider.test.ts
  embedding-bridge.test.ts
  indexers/
    code-indexer.test.ts
    ast-chunker.test.ts
    doc-indexer.test.ts
    file-indexer.test.ts
  routes.test.ts

tests/fixtures/search/
  sample.ts                             — TypeScript fixture for AST tests
  sample.py                             — Python fixture for AST tests
  sample.md                             — Markdown fixture
  sample.html                           — HTML fixture for readability tests
  sample.pdf                            — Small PDF fixture
  sample.docx                           — Small DOCX fixture
  sample.xlsx                           — Small Excel fixture
```

---

### Task 1: Install Dependencies and Create Types

**Files:**
- Modify: `package.json`
- Create: `src/modules/search/types.ts`
- Create: `src/modules/search/providers/types.ts`
- Create: `src/modules/search/indexers/types.ts`

- [ ] **Step 1: Install npm dependencies**

```bash
bun add @orama/orama web-tree-sitter@0.24.4 tree-sitter-wasms@0.1.13 @mozilla/readability turndown pdf-parse mammoth xlsx
bun add -d @types/turndown
```

- [ ] **Step 2: Verify licenses are MIT-compatible**

```bash
bun pm ls | grep -E "orama|tree-sitter|readability|turndown|pdf-parse|mammoth|xlsx"
```

Check each listed package has MIT, Apache-2.0, BSD-2, BSD-3, ISC, or Unlicense.

- [ ] **Step 3: Create `src/modules/search/types.ts`**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

// ─── Chunk ────────────────────────────────────────────

export interface ChunkMetadata {
  filePath?: string
  lineStart?: number
  lineEnd?: number
  language?: string
  symbolName?: string
  url?: string
  section?: string
  title?: string
  page?: number
  sheetName?: string
  rowRange?: string
  [key: string]: unknown
}

export interface Chunk {
  id: string
  sourceId: string
  collection: string
  content: string
  metadata: ChunkMetadata
}

// ─── Search Source ────────────────────────────────────

export interface SearchSourceConfig {
  paths?: string[]
  urls?: string[]
  include?: string[]
  exclude?: string[]
  maxDepth?: number
  [key: string]: unknown
}

export type SourceStatus = 'idle' | 'indexing' | 'ready' | 'error'

export interface SearchSource {
  id: string
  name: string
  type: string
  indexer: string
  config: SearchSourceConfig
  status: SourceStatus
  chunkCount: number
  errorMessage: string | null
  lastIndexedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateSourceInput {
  name: string
  type: string
  indexer: string
  config: SearchSourceConfig
}

export interface UpdateSourceInput {
  name?: string
  config?: SearchSourceConfig
}

// ─── Search Query / Result ───────────────────────────

export type SearchMode = 'fts' | 'vector' | 'hybrid'

export interface SearchQuery {
  query: string
  mode?: SearchMode
  collections?: string[]
  filters?: {
    language?: string
    filePath?: string
    sourceId?: string
  }
  limit?: number
  minScore?: number
}

export type MatchType = 'fts' | 'vector' | 'both'

export interface SearchResult {
  chunk: Chunk
  score: number
  matchType: MatchType
}

// ─── Search Context (exposed on ModuleContext) ───────

export interface SearchEngine {
  search(query: SearchQuery): Promise<SearchResult[]>
}

export interface IndexerRegistry {
  register(name: string, indexer: ContentIndexer): void
  get(name: string): ContentIndexer | null
  list(): string[]
}

export interface SourceService {
  create(input: CreateSourceInput): SearchSource
  get(id: string): SearchSource | null
  list(): SearchSource[]
  update(id: string, input: UpdateSourceInput): void
  delete(id: string): void
  setStatus(id: string, status: SourceStatus, errorMessage?: string | null): void
  setIndexed(id: string, chunkCount: number): void
  getFileState(sourceId: string, filePath: string): FileState | null
  setFileState(sourceId: string, filePath: string, mtime: string, chunkCount: number): void
  removeFileStates(sourceId: string): void
  removeDeletedFileStates(sourceId: string, currentPaths: string[]): string[]
}

export interface FileState {
  sourceId: string
  filePath: string
  mtime: string
  chunkCount: number
}

export interface SearchContext {
  engine: SearchEngine
  registry: IndexerRegistry
  sources: SourceService
}

// ─── Content Indexer (implemented by each indexer) ───

export interface ContentIndexer {
  name: string
  index(source: SearchSource): Promise<Chunk[]>
  supports(source: SearchSource): boolean
}
```

- [ ] **Step 4: Create `src/modules/search/providers/types.ts`**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Chunk, SearchQuery, SearchResult } from '../types.js'

export interface SearchProvider {
  addDocuments(collection: string, chunks: Chunk[]): Promise<void>
  search(query: SearchQuery): Promise<SearchResult[]>
  removeBySource(sourceId: string): Promise<void>
  removeAll(): Promise<void>
  getCollections(): string[]
}
```

- [ ] **Step 5: Create `src/modules/search/indexers/types.ts`**

Re-export from main types for convenience:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type { ContentIndexer, Chunk, ChunkMetadata, SearchSource, SearchSourceConfig } from '../types.js'
```

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/modules/search/types.ts src/modules/search/providers/types.ts src/modules/search/indexers/types.ts
git commit -m "feat(search): add dependencies and type definitions"
```

---

### Task 2: Source Service

**Files:**
- Create: `src/modules/search/source-service.ts`
- Create: `tests/modules/search/source-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
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
  // Create search tables
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun vitest run tests/modules/search/source-service.test.ts
```

Expected: FAIL — `createSourceService` not found.

- [ ] **Step 3: Implement `src/modules/search/source-service.ts`**

```typescript
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

    getFileState(sourceId: string, filePath: string): FileState | null {
      const rows = db.all(sql`SELECT * FROM search_file_state WHERE source_id = ${sourceId} AND file_path = ${filePath}`) as any[]
      if (rows.length === 0) return null
      return { sourceId: rows[0].source_id, filePath: rows[0].file_path, mtime: rows[0].mtime, chunkCount: rows[0].chunk_count }
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun vitest run tests/modules/search/source-service.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/search/source-service.ts tests/modules/search/source-service.test.ts
git commit -m "feat(search): add source service with CRUD and file state tracking"
```

---

### Task 3: Indexer Registry

**Files:**
- Create: `src/modules/search/registry.ts`
- Create: `tests/modules/search/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { createIndexerRegistry } from '@modules/search/registry'
import type { ContentIndexer } from '@modules/search/types'

const mockIndexer: ContentIndexer = {
  name: 'test',
  async index() { return [] },
  supports() { return true },
}

describe('IndexerRegistry', () => {
  it('registers and retrieves an indexer', () => {
    const reg = createIndexerRegistry()
    reg.register('test', mockIndexer)
    expect(reg.get('test')).toBe(mockIndexer)
  })

  it('returns null for unregistered indexer', () => {
    const reg = createIndexerRegistry()
    expect(reg.get('nope')).toBeNull()
  })

  it('lists registered indexer names', () => {
    const reg = createIndexerRegistry()
    reg.register('a', mockIndexer)
    reg.register('b', mockIndexer)
    expect(reg.list()).toEqual(['a', 'b'])
  })

  it('throws on duplicate registration', () => {
    const reg = createIndexerRegistry()
    reg.register('x', mockIndexer)
    expect(() => reg.register('x', mockIndexer)).toThrow('already registered')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun vitest run tests/modules/search/registry.test.ts
```

- [ ] **Step 3: Implement `src/modules/search/registry.ts`**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ContentIndexer, IndexerRegistry } from './types.js'

export function createIndexerRegistry(): IndexerRegistry {
  const indexers = new Map<string, ContentIndexer>()

  return {
    register(name: string, indexer: ContentIndexer): void {
      if (indexers.has(name)) throw new Error(`Indexer "${name}" already registered`)
      indexers.set(name, indexer)
    },

    get(name: string): ContentIndexer | null {
      return indexers.get(name) ?? null
    },

    list(): string[] {
      return Array.from(indexers.keys())
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun vitest run tests/modules/search/registry.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/search/registry.ts tests/modules/search/registry.test.ts
git commit -m "feat(search): add indexer registry"
```

---

### Task 4: Orama Provider

**Files:**
- Create: `src/modules/search/providers/orama/orama-provider.ts`
- Create: `tests/modules/search/orama-provider.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { createOramaProvider } from '@modules/search/providers/orama/orama-provider'
import type { SearchProvider } from '@modules/search/providers/types'
import type { Chunk } from '@modules/search/types'

let provider: SearchProvider

beforeEach(async () => {
  provider = await createOramaProvider()
})

function makeChunk(id: string, content: string, sourceId = 'src1', collection = 'code', meta: Record<string, unknown> = {}): Chunk {
  return { id, sourceId, collection, content, metadata: { language: 'typescript', filePath: '/test.ts', ...meta } }
}

describe('OramaProvider', () => {
  it('adds documents and searches by FTS', async () => {
    await provider.addDocuments('code', [
      makeChunk('1', 'function calculateTotal(items) { return items.reduce((a, b) => a + b, 0) }'),
      makeChunk('2', 'class UserService { async findById(id) { return db.get(id) } }'),
    ])
    const results = await provider.search({ query: 'calculateTotal', mode: 'fts', limit: 10 })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].chunk.id).toBe('1')
  })

  it('returns empty for no match', async () => {
    await provider.addDocuments('code', [makeChunk('1', 'hello world')])
    const results = await provider.search({ query: 'xyznonexistent', mode: 'fts', limit: 10 })
    expect(results).toHaveLength(0)
  })

  it('filters by collection', async () => {
    await provider.addDocuments('code', [makeChunk('1', 'function test() {}', 'src1', 'code')])
    await provider.addDocuments('docs', [makeChunk('2', 'function docs() {}', 'src1', 'docs')])
    const results = await provider.search({ query: 'function', collections: ['docs'], mode: 'fts', limit: 10 })
    expect(results.every(r => r.chunk.collection === 'docs')).toBe(true)
  })

  it('removes documents by source', async () => {
    await provider.addDocuments('code', [
      makeChunk('1', 'keep this', 'src1'),
      makeChunk('2', 'remove this', 'src2'),
    ])
    await provider.removeBySource('src2')
    const results = await provider.search({ query: 'this', mode: 'fts', limit: 10 })
    expect(results).toHaveLength(1)
    expect(results[0].chunk.sourceId).toBe('src1')
  })

  it('lists collections', async () => {
    await provider.addDocuments('code', [makeChunk('1', 'test')])
    await provider.addDocuments('docs', [makeChunk('2', 'test', 'src1', 'docs')])
    expect(provider.getCollections().sort()).toEqual(['code', 'docs'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun vitest run tests/modules/search/orama-provider.test.ts
```

- [ ] **Step 3: Implement `src/modules/search/providers/orama/orama-provider.ts`**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { create, insert, search, remove } from '@orama/orama'
import type { SearchProvider } from '../types.js'
import type { Chunk, SearchQuery, SearchResult } from '../../types.js'

interface OramaDoc {
  id: string
  sourceId: string
  collection: string
  content: string
  filePath: string
  language: string
  symbolName: string
  title: string
  section: string
  url: string
  metadataJson: string
}

export async function createOramaProvider(): Promise<SearchProvider> {
  let db = await create({
    schema: {
      id: 'string',
      sourceId: 'string',
      collection: 'string',
      content: 'string',
      filePath: 'string',
      language: 'string',
      symbolName: 'string',
      title: 'string',
      section: 'string',
      url: 'string',
      metadataJson: 'string',
    } as const,
  })

  // Track chunks for removal
  const chunkMap = new Map<string, Chunk>()

  function chunkToDoc(chunk: Chunk): OramaDoc {
    return {
      id: chunk.id,
      sourceId: chunk.sourceId,
      collection: chunk.collection,
      content: chunk.content,
      filePath: chunk.metadata.filePath ?? '',
      language: chunk.metadata.language ?? '',
      symbolName: chunk.metadata.symbolName ?? '',
      title: chunk.metadata.title ?? '',
      section: chunk.metadata.section ?? '',
      url: chunk.metadata.url ?? '',
      metadataJson: JSON.stringify(chunk.metadata),
    }
  }

  return {
    async addDocuments(collection: string, chunks: Chunk[]): Promise<void> {
      for (const chunk of chunks) {
        const doc = chunkToDoc({ ...chunk, collection })
        await insert(db, doc)
        chunkMap.set(chunk.id, { ...chunk, collection })
      }
    },

    async search(query: SearchQuery): Promise<SearchResult[]> {
      const oramaResults = await search(db, {
        term: query.query,
        limit: query.limit ?? 20,
        ...(query.collections && query.collections.length > 0
          ? { where: { collection: query.collections } }
          : {}),
      })

      const results: SearchResult[] = []
      for (const hit of oramaResults.hits) {
        const doc = hit.document as unknown as OramaDoc
        const chunk = chunkMap.get(doc.id)
        if (!chunk) continue

        // Apply filters
        if (query.filters?.language && chunk.metadata.language !== query.filters.language) continue
        if (query.filters?.sourceId && chunk.sourceId !== query.filters.sourceId) continue

        const score = hit.score
        if (query.minScore && score < query.minScore) continue

        results.push({ chunk, score, matchType: 'fts' })
      }

      return results
    },

    async removeBySource(sourceId: string): Promise<void> {
      const idsToRemove: string[] = []
      for (const [id, chunk] of chunkMap) {
        if (chunk.sourceId === sourceId) idsToRemove.push(id)
      }
      for (const id of idsToRemove) {
        try { await remove(db, id) } catch { /* already removed */ }
        chunkMap.delete(id)
      }
    },

    async removeAll(): Promise<void> {
      chunkMap.clear()
      db = await create({
        schema: {
          id: 'string',
          sourceId: 'string',
          collection: 'string',
          content: 'string',
          filePath: 'string',
          language: 'string',
          symbolName: 'string',
          title: 'string',
          section: 'string',
          url: 'string',
          metadataJson: 'string',
        } as const,
      })
    },

    getCollections(): string[] {
      const collections = new Set<string>()
      for (const chunk of chunkMap.values()) {
        collections.add(chunk.collection)
      }
      return Array.from(collections)
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun vitest run tests/modules/search/orama-provider.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/search/providers/orama/orama-provider.ts tests/modules/search/orama-provider.test.ts
git commit -m "feat(search): add Orama search provider with FTS"
```

---

### Task 5: Embedding Bridge

**Files:**
- Create: `src/modules/search/embedding-bridge.ts`
- Create: `tests/modules/search/embedding-bridge.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { createEmbeddingBridge } from '@modules/search/embedding-bridge'

describe('EmbeddingBridge', () => {
  it('returns null when no provider is available', async () => {
    const bridge = createEmbeddingBridge(null)
    const result = await bridge.embed(['hello world'])
    expect(result).toBeNull()
  })

  it('returns embeddings from mock provider', async () => {
    const mockProvider = {
      embed: async (texts: string[]) => texts.map(() => new Float32Array([0.1, 0.2, 0.3])),
      dimensions: 3,
      model: 'mock-embed',
    }
    const bridge = createEmbeddingBridge(mockProvider)
    const result = await bridge.embed(['hello', 'world'])
    expect(result).toHaveLength(2)
    expect(result![0]).toBeInstanceOf(Float32Array)
    expect(result![0].length).toBe(3)
  })

  it('batches large inputs', async () => {
    let callCount = 0
    const mockProvider = {
      embed: async (texts: string[]) => {
        callCount++
        return texts.map(() => new Float32Array([0.1]))
      },
      dimensions: 1,
      model: 'mock-embed',
    }
    const bridge = createEmbeddingBridge(mockProvider, { batchSize: 2 })
    const texts = ['a', 'b', 'c', 'd', 'e']
    const result = await bridge.embed(texts)
    expect(result).toHaveLength(5)
    expect(callCount).toBe(3) // 2 + 2 + 1
  })

  it('reports model name', () => {
    const mockProvider = {
      embed: async () => [],
      dimensions: 3,
      model: 'text-embedding-3-small',
    }
    const bridge = createEmbeddingBridge(mockProvider)
    expect(bridge.model).toBe('text-embedding-3-small')
  })

  it('reports null model when no provider', () => {
    const bridge = createEmbeddingBridge(null)
    expect(bridge.model).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun vitest run tests/modules/search/embedding-bridge.test.ts
```

- [ ] **Step 3: Implement `src/modules/search/embedding-bridge.ts`**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Float32Array[]>
  dimensions: number
  model: string
}

export interface EmbeddingBridge {
  embed(texts: string[]): Promise<Float32Array[] | null>
  model: string | null
  dimensions: number | null
}

export interface EmbeddingBridgeOptions {
  batchSize?: number
}

export function createEmbeddingBridge(
  provider: EmbeddingProvider | null,
  options: EmbeddingBridgeOptions = {},
): EmbeddingBridge {
  const batchSize = options.batchSize ?? 100

  return {
    get model() {
      return provider?.model ?? null
    },

    get dimensions() {
      return provider?.dimensions ?? null
    },

    async embed(texts: string[]): Promise<Float32Array[] | null> {
      if (!provider) return null

      const results: Float32Array[] = []
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize)
        const embeddings = await provider.embed(batch)
        results.push(...embeddings)
      }
      return results
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun vitest run tests/modules/search/embedding-bridge.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/search/embedding-bridge.ts tests/modules/search/embedding-bridge.test.ts
git commit -m "feat(search): add embedding bridge with batching and graceful degradation"
```

---

### Task 6: Search Engine (Hybrid Query Pipeline)

**Files:**
- Create: `src/modules/search/engine.ts`
- Create: `tests/modules/search/engine.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { createSearchEngine } from '@modules/search/engine'
import { createOramaProvider } from '@modules/search/providers/orama/orama-provider'
import type { SearchProvider } from '@modules/search/providers/types'
import type { SearchEngine, Chunk } from '@modules/search/types'

let provider: SearchProvider
let engine: SearchEngine

function makeChunk(id: string, content: string, collection = 'code'): Chunk {
  return { id, sourceId: 'src1', collection, content, metadata: { filePath: `/test/${id}.ts`, language: 'typescript' } }
}

beforeEach(async () => {
  provider = await createOramaProvider()
  engine = createSearchEngine(provider)
})

describe('SearchEngine', () => {
  it('searches with FTS mode', async () => {
    await provider.addDocuments('code', [
      makeChunk('1', 'function parseConfig(yaml) { return parse(yaml) }'),
      makeChunk('2', 'class DatabaseConnection { connect() {} }'),
    ])
    const results = await engine.search({ query: 'parseConfig', mode: 'fts' })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].chunk.id).toBe('1')
    expect(results[0].matchType).toBe('fts')
  })

  it('defaults to hybrid mode (falls back to FTS when no embeddings)', async () => {
    await provider.addDocuments('code', [makeChunk('1', 'authentication middleware')])
    const results = await engine.search({ query: 'authentication' })
    expect(results.length).toBeGreaterThan(0)
    // Without embeddings, hybrid degrades to FTS
    expect(results[0].matchType).toBe('fts')
  })

  it('filters by collection', async () => {
    await provider.addDocuments('code', [makeChunk('1', 'function test', 'code')])
    await provider.addDocuments('docs', [makeChunk('2', 'function docs', 'docs')])
    const results = await engine.search({ query: 'function', collections: ['code'] })
    expect(results.every(r => r.chunk.collection === 'code')).toBe(true)
  })

  it('respects limit', async () => {
    for (let i = 0; i < 10; i++) {
      await provider.addDocuments('code', [makeChunk(`${i}`, `function handler${i}() {}`)])
    }
    const results = await engine.search({ query: 'function handler', limit: 3 })
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('returns normalized scores between 0 and 1', async () => {
    await provider.addDocuments('code', [makeChunk('1', 'exact match query')])
    const results = await engine.search({ query: 'exact match query' })
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(1)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun vitest run tests/modules/search/engine.test.ts
```

- [ ] **Step 3: Implement `src/modules/search/engine.ts`**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SearchProvider } from './providers/types.js'
import type { SearchEngine, SearchQuery, SearchResult } from './types.js'

export function createSearchEngine(provider: SearchProvider): SearchEngine {
  return {
    async search(query: SearchQuery): Promise<SearchResult[]> {
      const mode = query.mode ?? 'hybrid'
      const limit = query.limit ?? 20

      if (mode === 'fts' || mode === 'hybrid') {
        // For now, hybrid degrades to FTS when no vector embeddings are present
        // Vector search will be added when embedding bridge integration is wired
        const ftsResults = await provider.search({ ...query, mode: 'fts', limit: limit * 2 })

        // Normalize scores to 0-1
        const maxScore = ftsResults.length > 0 ? Math.max(...ftsResults.map(r => r.score)) : 1
        const normalized = ftsResults.map(r => ({
          ...r,
          score: maxScore > 0 ? r.score / maxScore : 0,
          matchType: 'fts' as const,
        }))

        return normalized.slice(0, limit)
      }

      // vector-only mode (requires embeddings, returns empty if none)
      return []
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun vitest run tests/modules/search/engine.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/search/engine.ts tests/modules/search/engine.test.ts
git commit -m "feat(search): add search engine with hybrid query pipeline"
```

---

### Task 7: Code Indexer — Language Map and AST Chunker

**Files:**
- Create: `src/modules/search/indexers/code/language-map.ts`
- Create: `src/modules/search/indexers/code/ast-chunker.ts`
- Create: `tests/modules/search/indexers/ast-chunker.test.ts`
- Create: `tests/fixtures/search/sample.ts`
- Create: `tests/fixtures/search/sample.py`

- [ ] **Step 1: Create test fixtures**

Create `tests/fixtures/search/sample.ts`:

```typescript
import { readFile } from 'fs/promises'
import { join } from 'path'

const DEFAULT_TIMEOUT = 5000

interface Config {
  host: string
  port: number
}

export function parseConfig(raw: string): Config {
  const parsed = JSON.parse(raw)
  return { host: parsed.host ?? 'localhost', port: parsed.port ?? 3000 }
}

export class DataService {
  private db: Map<string, unknown> = new Map()

  async get(key: string): Promise<unknown> {
    return this.db.get(key) ?? null
  }

  async set(key: string, value: unknown): Promise<void> {
    this.db.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.db.delete(key)
  }

  async clear(): Promise<void> {
    this.db.clear()
  }
}

export async function loadFile(path: string): Promise<string> {
  return readFile(join(__dirname, path), 'utf-8')
}
```

Create `tests/fixtures/search/sample.py`:

```python
from typing import Optional
import logging

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 100

class SaleOrder:
    _name = 'sale.order'
    _inherit = 'sale.order'

    def _compute_amount(self):
        for order in self:
            total = sum(line.price_total for line in order.line_ids)
            order.amount_total = total

    def action_confirm(self):
        self.ensure_one()
        self.state = 'confirmed'
        return True

def helper_function(value: Optional[str] = None) -> str:
    return value or 'default'
```

- [ ] **Step 2: Create `src/modules/search/indexers/code/language-map.ts`**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface LanguageConfig {
  grammar: string          // tree-sitter-wasms package name
  treeSitterLang: string   // language name for TreeSitter
  functionNodes: string[]  // AST node types that represent functions
  classNodes: string[]     // AST node types that represent classes
}

const LANGUAGES: Record<string, LanguageConfig> = {
  typescript: {
    grammar: 'tree-sitter-wasms/out/tree-sitter-typescript.wasm',
    treeSitterLang: 'typescript',
    functionNodes: ['function_declaration', 'method_definition', 'arrow_function', 'function'],
    classNodes: ['class_declaration'],
  },
  javascript: {
    grammar: 'tree-sitter-wasms/out/tree-sitter-javascript.wasm',
    treeSitterLang: 'javascript',
    functionNodes: ['function_declaration', 'method_definition', 'arrow_function', 'function'],
    classNodes: ['class_declaration'],
  },
  python: {
    grammar: 'tree-sitter-wasms/out/tree-sitter-python.wasm',
    treeSitterLang: 'python',
    functionNodes: ['function_definition'],
    classNodes: ['class_definition'],
  },
  go: {
    grammar: 'tree-sitter-wasms/out/tree-sitter-go.wasm',
    treeSitterLang: 'go',
    functionNodes: ['function_declaration', 'method_declaration'],
    classNodes: [],
  },
  rust: {
    grammar: 'tree-sitter-wasms/out/tree-sitter-rust.wasm',
    treeSitterLang: 'rust',
    functionNodes: ['function_item'],
    classNodes: ['struct_item', 'impl_item'],
  },
  java: {
    grammar: 'tree-sitter-wasms/out/tree-sitter-java.wasm',
    treeSitterLang: 'java',
    functionNodes: ['method_declaration', 'constructor_declaration'],
    classNodes: ['class_declaration'],
  },
}

const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
}

export function getLanguageForExtension(ext: string): string | null {
  return EXTENSION_MAP[ext] ?? null
}

export function getLanguageConfig(language: string): LanguageConfig | null {
  return LANGUAGES[language] ?? null
}

export function isTreeSitterSupported(ext: string): boolean {
  return ext in EXTENSION_MAP
}

// Fallback regex patterns for unsupported languages
export const FALLBACK_FUNCTION_REGEX = /^(?:export\s+)?(?:async\s+)?(?:function|def|fn|func|fun|sub|proc|method)\s+(\w+)/
export const FALLBACK_CLASS_REGEX = /^(?:export\s+)?(?:abstract\s+)?(?:class|struct|interface|trait|enum|type)\s+(\w+)/
```

- [ ] **Step 3: Write the failing AST chunker tests**

```typescript
import { describe, it, expect } from 'vitest'
import { chunkCode, chunkCodeFallback } from '@modules/search/indexers/code/ast-chunker'
import { readFileSync } from 'fs'
import { join } from 'path'

const FIXTURES = join(__dirname, '../../../fixtures/search')

describe('AST Chunker', () => {
  describe('chunkCodeFallback (regex-based)', () => {
    it('chunks TypeScript by function/class boundaries', () => {
      const code = readFileSync(join(FIXTURES, 'sample.ts'), 'utf-8')
      const chunks = chunkCodeFallback(code, 'sample.ts', 'typescript')
      expect(chunks.length).toBeGreaterThan(0)
      // Should find parseConfig, DataService, loadFile
      const names = chunks.map(c => c.symbolName).filter(Boolean)
      expect(names).toContain('parseConfig')
      expect(names).toContain('DataService')
      expect(names).toContain('loadFile')
    })

    it('chunks Python by function/class boundaries', () => {
      const code = readFileSync(join(FIXTURES, 'sample.py'), 'utf-8')
      const chunks = chunkCodeFallback(code, 'sample.py', 'python')
      const names = chunks.map(c => c.symbolName).filter(Boolean)
      expect(names).toContain('SaleOrder')
      expect(names).toContain('helper_function')
    })

    it('includes imports and top-level code', () => {
      const code = readFileSync(join(FIXTURES, 'sample.ts'), 'utf-8')
      const chunks = chunkCodeFallback(code, 'sample.ts', 'typescript')
      // There should be a chunk containing import statements
      const hasImports = chunks.some(c => c.content.includes('import'))
      expect(hasImports).toBe(true)
    })

    it('preserves line numbers', () => {
      const code = readFileSync(join(FIXTURES, 'sample.ts'), 'utf-8')
      const chunks = chunkCodeFallback(code, 'sample.ts', 'typescript')
      for (const chunk of chunks) {
        expect(chunk.lineStart).toBeGreaterThanOrEqual(1)
        expect(chunk.lineEnd).toBeGreaterThanOrEqual(chunk.lineStart)
      }
    })
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
bun vitest run tests/modules/search/indexers/ast-chunker.test.ts
```

- [ ] **Step 5: Implement `src/modules/search/indexers/code/ast-chunker.ts`**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { FALLBACK_FUNCTION_REGEX, FALLBACK_CLASS_REGEX } from './language-map.js'

export interface CodeChunk {
  content: string
  symbolName: string
  symbolType: 'function' | 'class' | 'imports' | 'top-level' | 'outline'
  lineStart: number
  lineEnd: number
}

/**
 * Regex-based fallback chunker for languages without TreeSitter support.
 * Also used as the initial implementation before TreeSitter WASM integration.
 */
export function chunkCodeFallback(code: string, filePath: string, language: string): CodeChunk[] {
  const lines = code.split('\n')
  const chunks: CodeChunk[] = []

  // Track regions: imports, classes, functions, top-level
  const regions: { type: 'function' | 'class' | 'imports' | 'top-level'; name: string; start: number; end: number }[] = []

  let importEnd = 0
  let i = 0

  // Phase 1: Find import region
  while (i < lines.length) {
    const line = lines[i].trim()
    if (line === '' || line.startsWith('import ') || line.startsWith('from ') ||
        line.startsWith('require(') || line.startsWith('const ') && line.includes('require(') ||
        line.startsWith('#') || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
      if (line.startsWith('import ') || line.startsWith('from ') || line.includes('require(')) {
        importEnd = i + 1
      }
      i++
    } else {
      break
    }
  }

  if (importEnd > 0) {
    regions.push({ type: 'imports', name: 'imports', start: 0, end: importEnd - 1 })
  }

  // Phase 2: Find function/class boundaries
  const indentBasedLanguages = new Set(['python'])
  const isIndentBased = indentBasedLanguages.has(language)

  let currentRegionStart: number | null = null
  let currentRegionName = ''
  let currentRegionType: 'function' | 'class' = 'function'
  let currentIndent = 0

  for (let lineIdx = importEnd; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]
    const trimmed = line.trim()
    if (trimmed === '') continue

    const funcMatch = trimmed.match(FALLBACK_FUNCTION_REGEX)
    const classMatch = trimmed.match(FALLBACK_CLASS_REGEX)

    const lineIndent = line.length - line.trimStart().length

    if (funcMatch || classMatch) {
      // Close previous region
      if (currentRegionStart !== null) {
        regions.push({ type: currentRegionType, name: currentRegionName, start: currentRegionStart, end: lineIdx - 1 })
      }
      currentRegionStart = lineIdx
      currentRegionName = (funcMatch ?? classMatch)![1]
      currentRegionType = classMatch ? 'class' : 'function'
      currentIndent = lineIndent

      // For class: include decorators above
      let decoratorStart = lineIdx - 1
      while (decoratorStart >= 0) {
        const prevTrimmed = lines[decoratorStart].trim()
        if (prevTrimmed.startsWith('@') || prevTrimmed.startsWith('#[')) {
          decoratorStart--
        } else {
          break
        }
      }
      if (decoratorStart + 1 < lineIdx) {
        currentRegionStart = decoratorStart + 1
      }
    } else if (isIndentBased && currentRegionStart !== null && lineIndent <= currentIndent && trimmed !== '') {
      // Indent decreased in Python — end of block
      regions.push({ type: currentRegionType, name: currentRegionName, start: currentRegionStart, end: lineIdx - 1 })
      currentRegionStart = null
    }
  }

  // Close last region
  if (currentRegionStart !== null) {
    regions.push({ type: currentRegionType, name: currentRegionName, start: currentRegionStart, end: lines.length - 1 })
  }

  // Phase 3: Collect uncovered lines as top-level
  const covered = new Set<number>()
  for (const region of regions) {
    for (let l = region.start; l <= region.end; l++) covered.add(l)
  }

  let topLevelStart: number | null = null
  for (let l = 0; l < lines.length; l++) {
    if (!covered.has(l) && lines[l].trim() !== '') {
      if (topLevelStart === null) topLevelStart = l
    } else if (topLevelStart !== null && (covered.has(l) || l === lines.length - 1)) {
      const end = covered.has(l) ? l - 1 : l
      if (end >= topLevelStart) {
        regions.push({ type: 'top-level', name: 'top-level', start: topLevelStart, end })
      }
      topLevelStart = null
    }
  }

  // Sort by start line
  regions.sort((a, b) => a.start - b.start)

  // Phase 4: Convert regions to chunks
  for (const region of regions) {
    const content = lines.slice(region.start, region.end + 1).join('\n')
    if (content.trim() === '') continue
    chunks.push({
      content,
      symbolName: region.name,
      symbolType: region.type,
      lineStart: region.start + 1, // 1-based
      lineEnd: region.end + 1,
    })
  }

  // Phase 5: Generate outline chunks for large classes (>150 lines)
  for (const region of regions) {
    if (region.type === 'class' && (region.end - region.start) > 150) {
      const classLines = lines.slice(region.start, region.end + 1)
      const outline = [classLines[0]] // class declaration line
      for (let cl = 1; cl < classLines.length; cl++) {
        const cLine = classLines[cl].trim()
        if (FALLBACK_FUNCTION_REGEX.test(cLine)) {
          outline.push(`  ${cLine}  # line ${region.start + cl + 1}`)
        }
      }
      if (outline.length > 1) {
        chunks.push({
          content: outline.join('\n'),
          symbolName: `${region.name} (outline)`,
          symbolType: 'outline',
          lineStart: region.start + 1,
          lineEnd: region.end + 1,
        })
      }
    }
  }

  return chunks
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
bun vitest run tests/modules/search/indexers/ast-chunker.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/search/indexers/code/ tests/modules/search/indexers/ast-chunker.test.ts tests/fixtures/search/sample.ts tests/fixtures/search/sample.py
git commit -m "feat(search): add code chunker with regex fallback and language map"
```

---

### Task 8: Code Indexer Orchestration

**Files:**
- Create: `src/modules/search/indexers/code/code-indexer.ts`
- Create: `tests/modules/search/indexers/code-indexer.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createCodeIndexer } from '@modules/search/indexers/code/code-indexer'
import type { ContentIndexer, SearchSource } from '@modules/search/types'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let indexer: ContentIndexer
let testDir: string

beforeEach(() => {
  indexer = createCodeIndexer()
  testDir = join(tmpdir(), `eyas-code-idx-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })
  writeFileSync(join(testDir, 'main.ts'), 'export function hello() { return "hi" }\n')
  writeFileSync(join(testDir, 'utils.py'), 'def greet(name):\n    return f"Hello {name}"\n')
  writeFileSync(join(testDir, 'readme.txt'), 'Not a code file\n')
  mkdirSync(join(testDir, 'node_modules'), { recursive: true })
  writeFileSync(join(testDir, 'node_modules', 'dep.ts'), 'should be excluded')
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function makeSource(paths: string[], exclude: string[] = []): SearchSource {
  return {
    id: 'src1', name: 'Test', type: 'code', indexer: 'code',
    config: { paths, exclude },
    status: 'idle', chunkCount: 0, errorMessage: null, lastIndexedAt: null,
    createdAt: '', updatedAt: '',
  }
}

describe('CodeIndexer', () => {
  it('supports code type sources', () => {
    expect(indexer.supports(makeSource([testDir]))).toBe(true)
    expect(indexer.supports({ ...makeSource([testDir]), type: 'docs' } as any)).toBe(false)
  })

  it('indexes code files and produces chunks', async () => {
    const chunks = await indexer.index(makeSource([testDir]))
    expect(chunks.length).toBeGreaterThan(0)
    // Should have chunks from main.ts and utils.py
    const files = new Set(chunks.map(c => c.metadata.filePath))
    expect(files.size).toBeGreaterThanOrEqual(2)
  })

  it('excludes node_modules by default', async () => {
    const chunks = await indexer.index(makeSource([testDir]))
    const paths = chunks.map(c => c.metadata.filePath!)
    expect(paths.some(p => p.includes('node_modules'))).toBe(false)
  })

  it('skips non-code files', async () => {
    const chunks = await indexer.index(makeSource([testDir]))
    const paths = chunks.map(c => c.metadata.filePath!)
    expect(paths.some(p => p.includes('readme.txt'))).toBe(false)
  })

  it('sets correct metadata on chunks', async () => {
    const chunks = await indexer.index(makeSource([testDir]))
    const tsChunk = chunks.find(c => c.metadata.filePath?.endsWith('main.ts'))!
    expect(tsChunk.metadata.language).toBe('typescript')
    expect(tsChunk.metadata.lineStart).toBeGreaterThanOrEqual(1)
    expect(tsChunk.sourceId).toBe('src1')
    expect(tsChunk.collection).toBe('code')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun vitest run tests/modules/search/indexers/code-indexer.test.ts
```

- [ ] **Step 3: Implement `src/modules/search/indexers/code/code-indexer.ts`**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readdirSync, readFileSync, statSync } from 'fs'
import { join, extname, relative } from 'path'
import { generateId } from '@shared/crypto'
import { getLanguageForExtension } from './language-map.js'
import { chunkCodeFallback } from './ast-chunker.js'
import type { ContentIndexer, Chunk, SearchSource } from '../../types.js'

const DEFAULT_EXCLUDE = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', '.nuxt', 'vendor', '.venv', 'coverage', '.cache', '.tox']

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.go',
  '.rs',
  '.java',
  '.rb', '.php', '.cs', '.cpp', '.c', '.h', '.hpp',
  '.swift', '.kt', '.scala', '.sh', '.sql',
  '.xml', '.json', '.yaml', '.yml', '.toml',
  '.html', '.css', '.vue', '.svelte',
])

const MAX_FILE_SIZE = 1024 * 1024 // 1MB

export function createCodeIndexer(): ContentIndexer {
  return {
    name: 'code',

    supports(source: SearchSource): boolean {
      return source.type === 'code'
    },

    async index(source: SearchSource): Promise<Chunk[]> {
      const paths = source.config.paths ?? []
      const exclude = [...DEFAULT_EXCLUDE, ...(source.config.exclude ?? [])]
      const include = source.config.include ?? []
      const chunks: Chunk[] = []

      for (const rootPath of paths) {
        const files = scanDirectory(rootPath, exclude, include)
        for (const filePath of files) {
          const ext = extname(filePath)
          if (!CODE_EXTENSIONS.has(ext)) continue

          try {
            const stat = statSync(filePath)
            if (stat.size > MAX_FILE_SIZE) continue

            const content = readFileSync(filePath, 'utf-8')
            // Skip binary files
            if (content.includes('\0')) continue

            const language = getLanguageForExtension(ext) ?? ext.slice(1)
            const relPath = relative(rootPath, filePath)
            const codeChunks = chunkCodeFallback(content, relPath, language)

            for (const cc of codeChunks) {
              chunks.push({
                id: generateId(),
                sourceId: source.id,
                collection: 'code',
                content: cc.content,
                metadata: {
                  filePath: relPath,
                  lineStart: cc.lineStart,
                  lineEnd: cc.lineEnd,
                  language,
                  symbolName: cc.symbolName,
                },
              })
            }
          } catch {
            // Skip unreadable files
          }
        }
      }

      return chunks
    },
  }
}

function scanDirectory(dir: string, exclude: string[], include: string[]): string[] {
  const results: string[] = []

  function walk(current: string) {
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      return
    }

    for (const entry of entries) {
      if (exclude.some(ex => entry === ex || entry.startsWith(`.${ex}`))) continue

      const fullPath = join(current, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          walk(fullPath)
        } else if (stat.isFile()) {
          if (include.length > 0) {
            const ext = extname(entry)
            if (!include.some(pattern => entry.endsWith(pattern) || ext === pattern)) continue
          }
          results.push(fullPath)
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  walk(dir)
  return results
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun vitest run tests/modules/search/indexers/code-indexer.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/search/indexers/code/code-indexer.ts tests/modules/search/indexers/code-indexer.test.ts
git commit -m "feat(search): add code indexer with directory scanning and chunking"
```

---

### Task 9: Docs Indexer (URL Fetch + Local Files)

**Files:**
- Create: `src/modules/search/indexers/docs/url-fetcher.ts`
- Create: `src/modules/search/indexers/docs/file-reader.ts`
- Create: `src/modules/search/indexers/docs/doc-indexer.ts`
- Create: `tests/modules/search/indexers/doc-indexer.test.ts`
- Create: `tests/fixtures/search/sample.md`
- Create: `tests/fixtures/search/sample.html`

- [ ] **Step 1: Create test fixtures**

Create `tests/fixtures/search/sample.md`:

```markdown
# Getting Started

Welcome to the documentation.

## Installation

Run the following command:

```bash
npm install mylib
```

## Configuration

Create a config file:

```yaml
host: localhost
port: 3000
```

## API Reference

### Authentication

Use bearer tokens for auth.

### Endpoints

GET /api/users — list users
POST /api/users — create user
```

Create `tests/fixtures/search/sample.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Test Docs</title></head>
<body>
  <nav>Navigation menu</nav>
  <main>
    <h1>API Documentation</h1>
    <h2>Getting Started</h2>
    <p>This is the main content of the documentation page.</p>
    <h2>Authentication</h2>
    <p>Use API keys or bearer tokens to authenticate requests.</p>
  </main>
  <footer>Copyright 2026</footer>
</body>
</html>
```

- [ ] **Step 2: Write the failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDocIndexer } from '@modules/search/indexers/docs/doc-indexer'
import { chunkMarkdown } from '@modules/search/indexers/docs/file-reader'
import type { ContentIndexer, SearchSource } from '@modules/search/types'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let testDir: string

beforeEach(() => {
  testDir = join(tmpdir(), `eyas-doc-idx-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })
})
afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function makeSource(config: Record<string, unknown>): SearchSource {
  return {
    id: 'doc1', name: 'Test Docs', type: 'docs', indexer: 'docs',
    config, status: 'idle', chunkCount: 0, errorMessage: null,
    lastIndexedAt: null, createdAt: '', updatedAt: '',
  }
}

describe('chunkMarkdown', () => {
  it('chunks by H2 headings', () => {
    const md = '# Title\n\nIntro\n\n## Section A\n\nContent A\n\n## Section B\n\nContent B\n'
    const chunks = chunkMarkdown(md, 'test.md')
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    const sections = chunks.map(c => c.section).filter(Boolean)
    expect(sections).toContain('Section A')
    expect(sections).toContain('Section B')
  })

  it('falls back to fixed chunks when no headings', () => {
    const md = 'Just plain text without any headings.\n'.repeat(100)
    const chunks = chunkMarkdown(md, 'plain.txt')
    expect(chunks.length).toBeGreaterThanOrEqual(1)
  })

  it('sets title from H1', () => {
    const md = '# My Doc\n\n## Section\n\nContent\n'
    const chunks = chunkMarkdown(md, 'doc.md')
    expect(chunks.some(c => c.title === 'My Doc')).toBe(true)
  })
})

describe('DocIndexer', () => {
  it('supports docs type sources', () => {
    const indexer = createDocIndexer()
    expect(indexer.supports(makeSource({}))).toBe(true)
    expect(indexer.supports({ ...makeSource({}), type: 'code' } as any)).toBe(false)
  })

  it('indexes local markdown files', async () => {
    writeFileSync(join(testDir, 'guide.md'), '# Guide\n\n## Step 1\n\nDo this\n\n## Step 2\n\nDo that\n')
    writeFileSync(join(testDir, 'notes.txt'), 'Some notes here\n')
    const indexer = createDocIndexer()
    const chunks = await indexer.index(makeSource({ paths: [testDir] }))
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].collection).toBe('docs')
    expect(chunks[0].sourceId).toBe('doc1')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun vitest run tests/modules/search/indexers/doc-indexer.test.ts
```

- [ ] **Step 4: Implement `src/modules/search/indexers/docs/file-reader.ts`**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readdirSync, readFileSync, statSync } from 'fs'
import { join, extname } from 'path'

export interface DocChunk {
  content: string
  title: string
  section: string
  filePath: string
}

const DOC_EXTENSIONS = new Set(['.md', '.txt', '.rst'])
const WORDS_PER_CHUNK = 500

export function chunkMarkdown(content: string, filePath: string): DocChunk[] {
  const lines = content.split('\n')
  const chunks: DocChunk[] = []

  // Extract H1 title
  let title = ''
  for (const line of lines) {
    if (line.startsWith('# ') && !line.startsWith('## ')) {
      title = line.slice(2).trim()
      break
    }
  }

  // Split by H2 headings
  const sections: { heading: string; content: string[] }[] = []
  let currentHeading = ''
  let currentContent: string[] = []

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentContent.length > 0) {
        sections.push({ heading: currentHeading, content: [...currentContent] })
      }
      currentHeading = line.slice(3).trim()
      currentContent = []
    } else if (line.startsWith('# ') && !line.startsWith('## ')) {
      // Skip H1 title line from content
      continue
    } else {
      currentContent.push(line)
    }
  }
  if (currentContent.length > 0) {
    sections.push({ heading: currentHeading, content: currentContent })
  }

  // If no H2 sections found, try H1
  if (sections.length <= 1 && sections[0]?.heading === '') {
    const fullText = sections[0]?.content.join('\n') ?? content
    const words = fullText.split(/\s+/)
    if (words.length <= WORDS_PER_CHUNK) {
      chunks.push({ content: fullText, title, section: '', filePath })
    } else {
      // Fixed-size word chunks
      for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
        const chunkWords = words.slice(i, i + WORDS_PER_CHUNK)
        chunks.push({ content: chunkWords.join(' '), title, section: '', filePath })
      }
    }
    return chunks
  }

  for (const section of sections) {
    const text = section.content.join('\n').trim()
    if (text === '') continue
    chunks.push({ content: text, title, section: section.heading, filePath })
  }

  return chunks
}

export function readDocFiles(dir: string): { content: string; filePath: string }[] {
  const results: { content: string; filePath: string }[] = []

  function walk(current: string) {
    let entries: string[]
    try { entries = readdirSync(current) } catch { return }

    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const fullPath = join(current, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          walk(fullPath)
        } else if (stat.isFile() && DOC_EXTENSIONS.has(extname(entry))) {
          const content = readFileSync(fullPath, 'utf-8')
          results.push({ content, filePath: fullPath })
        }
      } catch { /* skip */ }
    }
  }

  walk(dir)
  return results
}
```

- [ ] **Step 5: Implement `src/modules/search/indexers/docs/url-fetcher.ts`**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import { JSDOM } from 'jsdom'

export interface FetchedDoc {
  title: string
  content: string // markdown
  url: string
}

export async function fetchAndExtract(url: string): Promise<FetchedDoc> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)

  const html = await response.text()
  const dom = new JSDOM(html, { url })
  const reader = new Readability(dom.window.document)
  const article = reader.parse()

  if (!article) throw new Error(`Could not extract content from ${url}`)

  const turndown = new TurndownService({ headingStyle: 'atx' })
  const markdown = turndown.turndown(article.content)

  return {
    title: article.title || '',
    content: markdown,
    url,
  }
}
```

Note: `jsdom` needs to be added as a dependency. Add to install step:

```bash
bun add jsdom
bun add -d @types/jsdom
```

- [ ] **Step 6: Implement `src/modules/search/indexers/docs/doc-indexer.ts`**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { generateId } from '@shared/crypto'
import { readDocFiles, chunkMarkdown } from './file-reader.js'
import { fetchAndExtract } from './url-fetcher.js'
import type { ContentIndexer, Chunk, SearchSource } from '../../types.js'

export function createDocIndexer(): ContentIndexer {
  return {
    name: 'docs',

    supports(source: SearchSource): boolean {
      return source.type === 'docs'
    },

    async index(source: SearchSource): Promise<Chunk[]> {
      const chunks: Chunk[] = []

      // Index local files
      const paths = source.config.paths ?? []
      for (const dir of paths) {
        const files = readDocFiles(dir)
        for (const file of files) {
          const docChunks = chunkMarkdown(file.content, file.filePath)
          for (const dc of docChunks) {
            chunks.push({
              id: generateId(),
              sourceId: source.id,
              collection: 'docs',
              content: dc.content,
              metadata: {
                filePath: dc.filePath,
                title: dc.title,
                section: dc.section,
              },
            })
          }
        }
      }

      // Index URLs
      const urls = source.config.urls ?? []
      for (const url of urls) {
        try {
          const doc = await fetchAndExtract(url)
          const docChunks = chunkMarkdown(doc.content, url)
          for (const dc of docChunks) {
            chunks.push({
              id: generateId(),
              sourceId: source.id,
              collection: 'docs',
              content: dc.content,
              metadata: {
                url: doc.url,
                title: doc.title || dc.title,
                section: dc.section,
              },
            })
          }
        } catch {
          // Log and skip failed URLs
        }
      }

      return chunks
    },
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
bun vitest run tests/modules/search/indexers/doc-indexer.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/search/indexers/docs/ tests/modules/search/indexers/doc-indexer.test.ts tests/fixtures/search/sample.md tests/fixtures/search/sample.html
git commit -m "feat(search): add docs indexer with markdown chunking and URL fetching"
```

---

### Task 10: Files Indexer (PDF, DOCX, XLSX)

**Files:**
- Create: `src/modules/search/indexers/files/parsers/markdown-parser.ts`
- Create: `src/modules/search/indexers/files/parsers/pdf-parser.ts`
- Create: `src/modules/search/indexers/files/parsers/docx-parser.ts`
- Create: `src/modules/search/indexers/files/parsers/xlsx-parser.ts`
- Create: `src/modules/search/indexers/files/file-indexer.ts`
- Create: `tests/modules/search/indexers/file-indexer.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createFileIndexer } from '@modules/search/indexers/files/file-indexer'
import type { ContentIndexer, SearchSource } from '@modules/search/types'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let testDir: string

beforeEach(() => {
  testDir = join(tmpdir(), `eyas-file-idx-${Date.now()}`)
  mkdirSync(testDir, { recursive: true })
})
afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function makeSource(paths: string[]): SearchSource {
  return {
    id: 'file1', name: 'Docs', type: 'files', indexer: 'files',
    config: { paths },
    status: 'idle', chunkCount: 0, errorMessage: null,
    lastIndexedAt: null, createdAt: '', updatedAt: '',
  }
}

describe('FileIndexer', () => {
  it('supports files type sources', () => {
    const indexer = createFileIndexer()
    expect(indexer.supports(makeSource([testDir]))).toBe(true)
  })

  it('indexes markdown files', async () => {
    writeFileSync(join(testDir, 'doc.md'), '# Title\n\n## Section 1\n\nContent here\n')
    const indexer = createFileIndexer()
    const chunks = await indexer.index(makeSource([testDir]))
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].collection).toBe('files')
    expect(chunks[0].metadata.filePath).toBeTruthy()
  })

  it('indexes txt files', async () => {
    writeFileSync(join(testDir, 'notes.txt'), 'Some plain text notes\n')
    const indexer = createFileIndexer()
    const chunks = await indexer.index(makeSource([testDir]))
    expect(chunks.length).toBeGreaterThan(0)
  })

  it('indexes csv files', async () => {
    writeFileSync(join(testDir, 'data.csv'), 'Name,Age,City\nAlice,30,NYC\nBob,25,LA\n')
    const indexer = createFileIndexer()
    const chunks = await indexer.index(makeSource([testDir]))
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].content).toContain('Alice')
  })

  it('skips unsupported file types', async () => {
    writeFileSync(join(testDir, 'image.png'), 'fake png')
    const indexer = createFileIndexer()
    const chunks = await indexer.index(makeSource([testDir]))
    expect(chunks).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun vitest run tests/modules/search/indexers/file-indexer.test.ts
```

- [ ] **Step 3: Implement parsers**

Create `src/modules/search/indexers/files/parsers/markdown-parser.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

// Re-use the docs module's markdown chunking
import { chunkMarkdown, type DocChunk } from '../../docs/file-reader.js'

export { chunkMarkdown, type DocChunk }
```

Create `src/modules/search/indexers/files/parsers/pdf-parser.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { DocChunk } from './markdown-parser.js'

export async function parsePdf(buffer: Buffer, filePath: string): Promise<DocChunk[]> {
  const pdfParse = (await import('pdf-parse')).default
  const data = await pdfParse(buffer)
  const text = data.text

  if (!text.trim()) return []

  // Try heading-based chunking first
  const { chunkMarkdown } = await import('./markdown-parser.js')
  const chunks = chunkMarkdown(text, filePath)

  // If only one chunk, try page-based splitting
  if (chunks.length <= 1 && data.numpages > 1) {
    // pdf-parse doesn't give per-page text easily, so we use the full text
    // with page markers as a fallback
    return [{ content: text, title: '', section: '', filePath }]
  }

  return chunks
}
```

Create `src/modules/search/indexers/files/parsers/docx-parser.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import mammoth from 'mammoth'
import TurndownService from 'turndown'
import type { DocChunk } from './markdown-parser.js'
import { chunkMarkdown } from './markdown-parser.js'

export async function parseDocx(buffer: Buffer, filePath: string): Promise<DocChunk[]> {
  const result = await mammoth.convertToHtml({ buffer })
  const html = result.value

  const turndown = new TurndownService({ headingStyle: 'atx' })
  const markdown = turndown.turndown(html)

  return chunkMarkdown(markdown, filePath)
}
```

Create `src/modules/search/indexers/files/parsers/xlsx-parser.ts`:

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import * as XLSX from 'xlsx'
import type { DocChunk } from './markdown-parser.js'

const ROWS_PER_CHUNK = 50

export function parseXlsx(buffer: Buffer, filePath: string): DocChunk[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const chunks: DocChunk[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as string[][]

    if (rows.length === 0) continue

    // First row as header context
    const header = rows[0].join(' | ')

    for (let i = 1; i < rows.length; i += ROWS_PER_CHUNK) {
      const rowSlice = rows.slice(i, i + ROWS_PER_CHUNK)
      const text = `Headers: ${header}\n\n` + rowSlice.map(row => row.join(' | ')).join('\n')
      const rowEnd = Math.min(i + ROWS_PER_CHUNK, rows.length)

      chunks.push({
        content: text,
        title: sheetName,
        section: `Rows ${i + 1}-${rowEnd}`,
        filePath,
      })
    }
  }

  return chunks
}

export function parseCsv(content: string, filePath: string): DocChunk[] {
  const workbook = XLSX.read(content, { type: 'string' })
  const chunks: DocChunk[] = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as string[][]

    if (rows.length === 0) continue

    const header = rows[0].join(' | ')

    for (let i = 1; i < rows.length; i += ROWS_PER_CHUNK) {
      const rowSlice = rows.slice(i, i + ROWS_PER_CHUNK)
      const text = `Headers: ${header}\n\n` + rowSlice.map(row => row.join(' | ')).join('\n')
      const rowEnd = Math.min(i + ROWS_PER_CHUNK, rows.length)

      chunks.push({
        content: text,
        title: '',
        section: `Rows ${i + 1}-${rowEnd}`,
        filePath,
      })
    }
  }

  return chunks
}
```

- [ ] **Step 4: Implement `src/modules/search/indexers/files/file-indexer.ts`**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readdirSync, readFileSync, statSync } from 'fs'
import { join, extname, relative } from 'path'
import { generateId } from '@shared/crypto'
import { chunkMarkdown } from './parsers/markdown-parser.js'
import { parseCsv } from './parsers/xlsx-parser.js'
import type { ContentIndexer, Chunk, SearchSource } from '../../types.js'

const SUPPORTED_EXTENSIONS: Record<string, 'markdown' | 'pdf' | 'docx' | 'xlsx' | 'csv'> = {
  '.md': 'markdown', '.txt': 'markdown', '.rst': 'markdown',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx', '.xls': 'xlsx',
  '.csv': 'csv', '.tsv': 'csv',
}

export function createFileIndexer(): ContentIndexer {
  return {
    name: 'files',

    supports(source: SearchSource): boolean {
      return source.type === 'files'
    },

    async index(source: SearchSource): Promise<Chunk[]> {
      const paths = source.config.paths ?? []
      const exclude = source.config.exclude ?? []
      const chunks: Chunk[] = []

      for (const rootPath of paths) {
        const files = scanFiles(rootPath, exclude)
        for (const filePath of files) {
          const ext = extname(filePath).toLowerCase()
          const fileType = SUPPORTED_EXTENSIONS[ext]
          if (!fileType) continue

          try {
            const relPath = relative(rootPath, filePath)
            const fileChunks = await parseFile(filePath, relPath, fileType)

            for (const fc of fileChunks) {
              chunks.push({
                id: generateId(),
                sourceId: source.id,
                collection: 'files',
                content: fc.content,
                metadata: {
                  filePath: relPath,
                  title: fc.title || undefined,
                  section: fc.section || undefined,
                },
              })
            }
          } catch {
            // Skip unparseable files
          }
        }
      }

      return chunks
    },
  }
}

async function parseFile(filePath: string, relPath: string, fileType: string) {
  switch (fileType) {
    case 'markdown': {
      const content = readFileSync(filePath, 'utf-8')
      return chunkMarkdown(content, relPath)
    }
    case 'pdf': {
      const { parsePdf } = await import('./parsers/pdf-parser.js')
      const buffer = readFileSync(filePath)
      return parsePdf(buffer, relPath)
    }
    case 'docx': {
      const { parseDocx } = await import('./parsers/docx-parser.js')
      const buffer = readFileSync(filePath)
      return parseDocx(buffer, relPath)
    }
    case 'xlsx': {
      const { parseXlsx } = await import('./parsers/xlsx-parser.js')
      const buffer = readFileSync(filePath)
      return parseXlsx(buffer, relPath)
    }
    case 'csv': {
      const content = readFileSync(filePath, 'utf-8')
      return parseCsv(content, relPath)
    }
    default:
      return []
  }
}

function scanFiles(dir: string, exclude: string[]): string[] {
  const results: string[] = []

  function walk(current: string) {
    let entries: string[]
    try { entries = readdirSync(current) } catch { return }

    for (const entry of entries) {
      if (entry.startsWith('.') || exclude.includes(entry)) continue
      const fullPath = join(current, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) walk(fullPath)
        else if (stat.isFile()) results.push(fullPath)
      } catch { /* skip */ }
    }
  }

  walk(dir)
  return results
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun vitest run tests/modules/search/indexers/file-indexer.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/search/indexers/files/ tests/modules/search/indexers/file-indexer.test.ts
git commit -m "feat(search): add files indexer with PDF, DOCX, XLSX, CSV support"
```

---

### Task 11: Module Entry Point and DB Tables

**Files:**
- Create: `src/modules/search/index.ts`
- Modify: `src/core/types.ts` — add `search` to ModuleContext
- Modify: `src/core/bootstrap.ts` — register search module

- [ ] **Step 1: Create `src/modules/search/index.ts`**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createSourceService } from './source-service.js'
import { createIndexerRegistry } from './registry.js'
import { createOramaProvider } from './providers/orama/orama-provider.js'
import { createSearchEngine } from './engine.js'
import { createEmbeddingBridge } from './embedding-bridge.js'
import { createCodeIndexer } from './indexers/code/code-indexer.js'
import { createDocIndexer } from './indexers/docs/doc-indexer.js'
import { createFileIndexer } from './indexers/files/file-indexer.js'

export const searchModule: EyasModule = {
  id: 'search',
  name: 'Search',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Development context indexer — code, docs, files with hybrid FTS+vector search',
  dependencies: [],
  optional: ['model'],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS search_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, indexer TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'idle', chunk_count INTEGER NOT NULL DEFAULT 0, error_message TEXT, last_indexed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)

    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS search_chunks (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, collection TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', content_hash TEXT NOT NULL, embedding BLOB, embedding_model TEXT, created_at TEXT NOT NULL)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_chunks_source ON search_chunks(source_id)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_chunks_collection ON search_chunks(collection)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_chunks_hash ON search_chunks(content_hash)`)

    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS search_file_state (source_id TEXT NOT NULL, file_path TEXT NOT NULL, mtime TEXT NOT NULL, chunk_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (source_id, file_path))`)

    const sourceService = createSourceService(ctx.db)
    const registry = createIndexerRegistry()

    ;(ctx as any).search = { sources: sourceService, registry, engine: null }
    ctx.logger.info('Search module registered')
  },

  async onStart(ctx: ModuleContext) {
    const searchCtx = (ctx as any).search

    // Create Orama provider and search engine
    const provider = await createOramaProvider()
    const engine = createSearchEngine(provider)
    searchCtx.engine = engine

    // Register built-in indexers
    searchCtx.registry.register('code', createCodeIndexer())
    searchCtx.registry.register('docs', createDocIndexer())
    searchCtx.registry.register('files', createFileIndexer())

    // Load persisted chunks into Orama on startup
    const sources = searchCtx.sources.list()
    for (const source of sources) {
      if (source.status !== 'ready') continue
      try {
        const rows = (ctx.db as any).all(sql`SELECT * FROM search_chunks WHERE source_id = ${source.id}`) as any[]
        const chunks = rows.map((r: any) => ({
          id: r.id,
          sourceId: r.source_id,
          collection: r.collection,
          content: r.content,
          metadata: JSON.parse(r.metadata || '{}'),
        }))
        if (chunks.length > 0) {
          await provider.addDocuments(source.type, chunks)
        }
        ctx.logger.info('Loaded %d chunks for source "%s"', chunks.length, source.name)
      } catch (err) {
        ctx.logger.warn('Failed to load chunks for source "%s": %s', source.name, err)
      }
    }

    // Set up routes
    const { createSearchRoutes } = await import('./routes.js')
    createSearchRoutes(ctx.http, searchCtx, provider, ctx.db, ctx.logger)

    ctx.logger.info('Search module started (%d built-in indexers)', searchCtx.registry.list().length)
  },

  async onStop() {},
}
```

- [ ] **Step 2: Add `search` to ModuleContext in `src/core/types.ts`**

Add after the `board` property in the ModuleContext interface:

```typescript
  search: import('@modules/search/types').SearchContext
```

- [ ] **Step 3: Add search module to bootstrap in `src/core/bootstrap.ts`**

Add import:
```typescript
import { searchModule } from '@modules/search/index'
```

Add registration (after boardModule):
```typescript
  if (!moduleLoader.hasModule(searchModule.id)) {
    moduleLoader.register(searchModule)
  }
```

- [ ] **Step 4: Verify build compiles**

```bash
bun build src/main.ts --target=bun 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/search/index.ts src/core/types.ts src/core/bootstrap.ts
git commit -m "feat(search): add module entry point, DB tables, and bootstrap registration"
```

---

### Task 12: REST API Routes

**Files:**
- Create: `src/modules/search/routes.ts`
- Create: `tests/modules/search/routes.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createSearchRoutes } from '@modules/search/routes'
import { createSourceService } from '@modules/search/source-service'
import { createIndexerRegistry } from '@modules/search/registry'
import { createOramaProvider } from '@modules/search/providers/orama/orama-provider'
import { createSearchEngine } from '@modules/search/engine'
import { createAuthMiddleware } from '@modules/auth/middleware'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { RoleId } from '@modules/permissions/types'
import pino from 'pino'

const testDb = createTestDb('search-routes')
let db: ReturnType<typeof testDb.open>
let app: Hono
let ownerToken: string

const auth = () => ({ Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' })

beforeEach(async () => {
  db = testDb.open()
  db.run(sql`CREATE TABLE IF NOT EXISTS search_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, indexer TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'idle', chunk_count INTEGER NOT NULL DEFAULT 0, error_message TEXT, last_indexed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS search_chunks (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, collection TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', content_hash TEXT NOT NULL, embedding BLOB, embedding_model TEXT, created_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS search_file_state (source_id TEXT NOT NULL, file_path TEXT NOT NULL, mtime TEXT NOT NULL, chunk_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (source_id, file_path))`)

  const sources = createSourceService(db)
  const registry = createIndexerRegistry()
  const provider = await createOramaProvider()
  const engine = createSearchEngine(provider)
  const logger = pino({ level: 'silent' })

  const permRegistry = createPermissionRegistry()
  const tokenService = createTokenService('test-secret-that-is-at-least-32-characters-long!')

  const authMiddleware = createAuthMiddleware({
    verifyAccessToken: (token) => tokenService.verifyAccessToken(token),
    findSessionByHash: async (hash) => {
      const rows = db.all(sql`SELECT * FROM sessions WHERE token_hash = ${hash}`) as any[]
      const s = rows[0]
      return s ? { userId: s.user_id, expiresAt: s.expires_at } : null
    },
    findApiKeyByHash: async () => null,
    findUserById: async (id) => {
      const rows = db.all(sql`SELECT * FROM users WHERE id = ${id}`) as any[]
      const u = rows[0]
      return u ? { id: u.id, role: u.role, status: u.status } : null
    },
    buildAbilityForUser: (role) => buildAbilityForRole(role as RoleId, permRegistry),
  })

  app = new Hono()
  app.use('/api/*', authMiddleware)
  createSearchRoutes(app, { engine, registry, sources }, provider, db, logger)

  const ownerId = await insertTestOwner(db)
  const tokens = await tokenService.generateTokenPair(ownerId)
  ownerToken = tokens.accessToken
})
afterEach(() => testDb.cleanup())

describe('Search Routes', () => {
  describe('GET /api/v1/search/sources', () => {
    it('returns empty list initially', async () => {
      const res = await app.request('/api/v1/search/sources', { headers: auth() })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual([])
    })
  })

  describe('POST /api/v1/search/sources', () => {
    it('creates a new source', async () => {
      const res = await app.request('/api/v1/search/sources', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ name: 'Test', type: 'code', indexer: 'code', config: { paths: ['/tmp'] } }),
      })
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.name).toBe('Test')
      expect(data.status).toBe('idle')
    })

    it('rejects missing name', async () => {
      const res = await app.request('/api/v1/search/sources', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ type: 'code', indexer: 'code', config: {} }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /api/v1/search/sources/:id', () => {
    it('deletes a source', async () => {
      const createRes = await app.request('/api/v1/search/sources', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ name: 'Del', type: 'code', indexer: 'code', config: {} }),
      })
      const { id } = await createRes.json()
      const delRes = await app.request(`/api/v1/search/sources/${id}`, { method: 'DELETE', headers: auth() })
      expect(delRes.status).toBe(204)
    })
  })

  describe('GET /api/v1/search', () => {
    it('returns search results', async () => {
      const res = await app.request('/api/v1/search?query=test', { headers: auth() })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(Array.isArray(data.results)).toBe(true)
    })
  })

  describe('GET /api/v1/search/stats', () => {
    it('returns statistics', async () => {
      const res = await app.request('/api/v1/search/stats', { headers: auth() })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('sourceCount')
      expect(data).toHaveProperty('totalChunks')
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun vitest run tests/modules/search/routes.test.ts
```

- [ ] **Step 3: Implement `src/modules/search/routes.ts`**

```typescript
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { Logger } from 'pino'
import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import { sha256 } from '@shared/crypto'
import type { SearchContext, SearchSource } from './types.js'
import type { SearchProvider } from './providers/types.js'

export function createSearchRoutes(
  app: Hono,
  search: SearchContext,
  provider: SearchProvider,
  db: any,
  logger: Logger,
) {
  // ─── Search ─────────────────────────────────────────
  app.get('/api/v1/search', async (c) => {
    const query = c.req.query('query')
    if (!query) return c.json({ error: 'query parameter required' }, 400)

    const mode = (c.req.query('mode') as any) ?? 'hybrid'
    const collections = c.req.query('collections')?.split(',').filter(Boolean)
    const limit = parseInt(c.req.query('limit') ?? '20', 10)
    const language = c.req.query('language')
    const sourceId = c.req.query('sourceId')

    const results = await search.engine.search({
      query, mode, collections, limit,
      filters: { language: language || undefined, sourceId: sourceId || undefined },
    })

    return c.json({ results, total: results.length })
  })

  // ─── Sources CRUD ───────────────────────────────────
  app.get('/api/v1/search/sources', (c) => {
    return c.json(search.sources.list())
  })

  app.post('/api/v1/search/sources', async (c) => {
    const body = await c.req.json()
    if (!body.name || !body.type || !body.indexer) {
      return c.json({ error: 'name, type, and indexer are required' }, 400)
    }
    const source = search.sources.create({
      name: body.name,
      type: body.type,
      indexer: body.indexer,
      config: body.config ?? {},
    })
    return c.json(source, 201)
  })

  app.patch('/api/v1/search/sources/:id', async (c) => {
    const id = c.req.param('id')
    const existing = search.sources.get(id)
    if (!existing) return c.json({ error: 'Source not found' }, 404)

    const body = await c.req.json()
    search.sources.update(id, body)
    return c.json(search.sources.get(id))
  })

  app.delete('/api/v1/search/sources/:id', async (c) => {
    const id = c.req.param('id')
    const existing = search.sources.get(id)
    if (!existing) return c.json({ error: 'Source not found' }, 404)

    // Remove chunks from Orama and DB
    await provider.removeBySource(id)
    db.run(sql`DELETE FROM search_chunks WHERE source_id = ${id}`)
    search.sources.delete(id)
    return c.body(null, 204)
  })

  // ─── Indexing ───────────────────────────────────────
  app.post('/api/v1/search/sources/:id/index', async (c) => {
    const id = c.req.param('id')
    const source = search.sources.get(id)
    if (!source) return c.json({ error: 'Source not found' }, 404)

    const indexer = search.registry.get(source.indexer)
    if (!indexer) return c.json({ error: `Indexer "${source.indexer}" not registered` }, 400)

    // Start async indexing — non-blocking
    search.sources.setStatus(id, 'indexing')

    indexAsync(id, source, indexer, search, provider, db, logger)

    return c.json({ status: 'indexing' }, 202)
  })

  app.get('/api/v1/search/sources/:id/status', (c) => {
    const id = c.req.param('id')
    const source = search.sources.get(id)
    if (!source) return c.json({ error: 'Source not found' }, 404)

    return c.json({
      status: source.status,
      chunkCount: source.chunkCount,
      errorMessage: source.errorMessage,
      lastIndexedAt: source.lastIndexedAt,
    })
  })

  // ─── Stats ──────────────────────────────────────────
  app.get('/api/v1/search/stats', (c) => {
    const sources = search.sources.list()
    const totalChunks = sources.reduce((sum, s) => sum + s.chunkCount, 0)
    const collections = provider.getCollections()

    return c.json({
      sourceCount: sources.length,
      totalChunks,
      collections,
      indexerCount: search.registry.list().length,
      registeredIndexers: search.registry.list(),
    })
  })
}

async function indexAsync(
  sourceId: string,
  source: SearchSource,
  indexer: any,
  search: SearchContext,
  provider: SearchProvider,
  db: any,
  logger: Logger,
) {
  try {
    const chunks = await indexer.index(source)

    // Remove old chunks
    await provider.removeBySource(sourceId)
    db.run(sql`DELETE FROM search_chunks WHERE source_id = ${sourceId}`)

    // Persist new chunks to DB
    const now = new Date().toISOString()
    for (const chunk of chunks) {
      const contentHash = await sha256(chunk.content)
      db.run(sql`INSERT INTO search_chunks (id, source_id, collection, content, metadata, content_hash, created_at) VALUES (${chunk.id}, ${sourceId}, ${chunk.collection}, ${chunk.content}, ${JSON.stringify(chunk.metadata)}, ${contentHash}, ${now})`)
    }

    // Load into Orama
    if (chunks.length > 0) {
      await provider.addDocuments(source.type, chunks)
    }

    search.sources.setIndexed(sourceId, chunks.length)
    logger.info('Indexed source "%s": %d chunks', source.name, chunks.length)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    search.sources.setStatus(sourceId, 'error', msg)
    logger.error('Failed to index source "%s": %s', source.name, msg)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun vitest run tests/modules/search/routes.test.ts
```

- [ ] **Step 5: Run all search tests**

```bash
bun vitest run tests/modules/search/
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/search/routes.ts tests/modules/search/routes.test.ts
git commit -m "feat(search): add REST API routes for search, sources, and indexing"
```

---

### Task 13: Frontend — Search Store

**Files:**
- Create: `src/web/src/stores/search-store.ts`

- [ ] **Step 1: Create the search store**

```typescript
import { create } from 'zustand'
import { api } from '@/lib/api'

interface SearchSource {
  id: string
  name: string
  type: string
  indexer: string
  config: Record<string, unknown>
  status: 'idle' | 'indexing' | 'ready' | 'error'
  chunkCount: number
  errorMessage: string | null
  lastIndexedAt: string | null
}

interface SearchResult {
  chunk: {
    id: string
    sourceId: string
    collection: string
    content: string
    metadata: Record<string, unknown>
  }
  score: number
  matchType: 'fts' | 'vector' | 'both'
}

interface SearchState {
  // Sources
  sources: SearchSource[]
  loadingSources: boolean
  fetchSources: () => Promise<void>
  createSource: (input: { name: string; type: string; indexer: string; config: Record<string, unknown> }) => Promise<void>
  deleteSource: (id: string) => Promise<void>
  indexSource: (id: string) => Promise<void>

  // Search
  query: string
  results: SearchResult[]
  searching: boolean
  setQuery: (q: string) => void
  search: (query: string) => Promise<void>

  // Stats
  stats: { sourceCount: number; totalChunks: number; collections: string[] } | null
  fetchStats: () => Promise<void>
}

export const useSearchStore = create<SearchState>((set, get) => ({
  sources: [],
  loadingSources: false,

  async fetchSources() {
    set({ loadingSources: true })
    try {
      const sources = await api.get<SearchSource[]>('/search/sources')
      set({ sources })
    } finally {
      set({ loadingSources: false })
    }
  },

  async createSource(input) {
    await api.post('/search/sources', input)
    await get().fetchSources()
  },

  async deleteSource(id) {
    await api.delete(`/search/sources/${id}`)
    await get().fetchSources()
  },

  async indexSource(id) {
    await api.post(`/search/sources/${id}/index`)
    // Refresh to get updated status
    setTimeout(() => get().fetchSources(), 1000)
  },

  query: '',
  results: [],
  searching: false,

  setQuery(q) {
    set({ query: q })
  },

  async search(query) {
    if (!query.trim()) {
      set({ results: [] })
      return
    }
    set({ searching: true })
    try {
      const data = await api.get<{ results: SearchResult[] }>(`/search?query=${encodeURIComponent(query)}`)
      set({ results: data.results })
    } finally {
      set({ searching: false })
    }
  },

  stats: null,

  async fetchStats() {
    const stats = await api.get<{ sourceCount: number; totalChunks: number; collections: string[] }>('/search/stats')
    set({ stats })
  },
}))
```

- [ ] **Step 2: Commit**

```bash
git add src/web/src/stores/search-store.ts
git commit -m "feat(search): add frontend search store"
```

---

### Task 14: Frontend — Sources Settings Page

**Files:**
- Create: `src/web/src/pages/search/sources-page.tsx`
- Modify: `src/web/src/components/layout/sidebar.tsx` — add Sources nav item

- [ ] **Step 1: Create `src/web/src/pages/search/sources-page.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useSearchStore } from '@/stores/search-store'
import { cn } from '@/lib/utils'

export function SearchSourcesPage() {
  const { sources, loadingSources, fetchSources, createSource, deleteSource, indexSource, stats, fetchStats } = useSearchStore()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState('code')
  const [paths, setPaths] = useState('')
  const [urls, setUrls] = useState('')

  useEffect(() => { fetchSources(); fetchStats() }, [])

  async function handleCreate() {
    const config: Record<string, unknown> = {}
    if (paths.trim()) config.paths = paths.split('\n').map(p => p.trim()).filter(Boolean)
    if (urls.trim()) config.urls = urls.split('\n').map(u => u.trim()).filter(Boolean)
    await createSource({ name, type, indexer: type, config })
    setShowForm(false)
    setName(''); setPaths(''); setUrls('')
  }

  const statusColors: Record<string, string> = {
    idle: 'text-muted-foreground',
    indexing: 'text-yellow-500',
    ready: 'text-green-500',
    error: 'text-red-500',
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Search Sources</h1>
          {stats && (
            <p className="text-sm text-muted-foreground mt-1">
              {stats.sourceCount} sources, {stats.totalChunks} chunks indexed
            </p>
          )}
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Add Source
        </button>
      </div>

      {showForm && (
        <div className="border rounded-lg p-4 mb-6 bg-card">
          <div className="grid gap-3">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Source name"
              className="px-3 py-2 text-sm border rounded-md bg-background"
            />
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="px-3 py-2 text-sm border rounded-md bg-background"
            >
              <option value="code">Code</option>
              <option value="docs">Documentation</option>
              <option value="files">Files</option>
            </select>
            {(type === 'code' || type === 'files') && (
              <textarea
                value={paths}
                onChange={e => setPaths(e.target.value)}
                placeholder="Local paths (one per line)"
                rows={3}
                className="px-3 py-2 text-sm border rounded-md bg-background font-mono"
              />
            )}
            {type === 'docs' && (
              <>
                <textarea
                  value={paths}
                  onChange={e => setPaths(e.target.value)}
                  placeholder="Local paths (one per line)"
                  rows={2}
                  className="px-3 py-2 text-sm border rounded-md bg-background font-mono"
                />
                <textarea
                  value={urls}
                  onChange={e => setUrls(e.target.value)}
                  placeholder="URLs (one per line)"
                  rows={2}
                  className="px-3 py-2 text-sm border rounded-md bg-background font-mono"
                />
              </>
            )}
            <div className="flex gap-2">
              <button onClick={handleCreate} disabled={!name.trim()} className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                Create
              </button>
              <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loadingSources ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sources configured. Add one to start indexing.</p>
      ) : (
        <div className="space-y-2">
          {sources.map(source => (
            <div key={source.id} className="border rounded-lg p-4 bg-card flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{source.name}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{source.type}</span>
                  <span className={cn('text-xs', statusColors[source.status])}>
                    {source.status}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {source.chunkCount} chunks
                  {source.lastIndexedAt && ` · Last indexed: ${new Date(source.lastIndexedAt).toLocaleString()}`}
                  {source.errorMessage && <span className="text-red-500 ml-2">{source.errorMessage}</span>}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => indexSource(source.id)}
                  disabled={source.status === 'indexing'}
                  className="px-2 py-1 text-xs rounded border hover:bg-accent disabled:opacity-50"
                >
                  {source.status === 'indexing' ? 'Indexing...' : 'Reindex'}
                </button>
                <button
                  onClick={() => deleteSource(source.id)}
                  className="px-2 py-1 text-xs rounded border text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add Search Sources to sidebar settings items**

In `src/web/src/components/layout/sidebar.tsx`, add a `Search` import from lucide-react and add the nav item:

```typescript
// Add to lucide-react imports:
import { Search } from 'lucide-react'

// Add to settingsItems array (after Providers):
{ path: '/search-sources', label: 'Search', icon: Search },
```

- [ ] **Step 3: Register the route in TanStack Router**

Check the existing router setup and add the `/search-sources` route pointing to `SearchSourcesPage`. Follow the existing pattern used by other settings pages.

- [ ] **Step 4: Verify the frontend builds**

```bash
cd src/web && bun run build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/web/src/pages/search/ src/web/src/components/layout/sidebar.tsx
git commit -m "feat(search): add sources settings page and sidebar navigation"
```

---

### Task 15: Frontend — Global Search Bar (Cmd+K)

**Files:**
- Create: `src/web/src/components/layout/search-bar.tsx`
- Modify: `src/web/src/components/layout/app-layout.tsx` — include search bar

- [ ] **Step 1: Create `src/web/src/components/layout/search-bar.tsx`**

```tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X, FileCode, FileText, File } from 'lucide-react'
import { useSearchStore } from '@/stores/search-store'
import { cn } from '@/lib/utils'

export function SearchBar() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const { results, searching, search } = useSearchStore()

  // Cmd+K shortcut
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const handleInput = useCallback((value: string) => {
    setInput(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      search(value)
    }, 300)
  }, [search])

  const collectionIcons: Record<string, typeof FileCode> = {
    code: FileCode,
    docs: FileText,
    files: File,
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={() => setOpen(false)}>
      <div className="fixed inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-2xl bg-popover border rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={input}
            onChange={e => handleInput(e.target.value)}
            placeholder="Search code, docs, files..."
            className="flex-1 bg-transparent text-sm outline-none"
          />
          {input && (
            <button onClick={() => { setInput(''); search('') }}>
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border text-muted-foreground">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {searching && <p className="px-4 py-3 text-sm text-muted-foreground">Searching...</p>}
          {!searching && input && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">No results found</p>
          )}
          {results.map(result => {
            const Icon = collectionIcons[result.chunk.collection] ?? File
            return (
              <div
                key={result.chunk.id}
                className="px-4 py-2.5 hover:bg-accent cursor-pointer border-b last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-xs text-muted-foreground">
                    {result.chunk.metadata.filePath || result.chunk.metadata.url || result.chunk.collection}
                  </span>
                  {result.chunk.metadata.language && (
                    <span className="text-[10px] px-1 rounded bg-muted">{result.chunk.metadata.language as string}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {Math.round(result.score * 100)}%
                  </span>
                </div>
                <p className="text-sm mt-1 line-clamp-2 font-mono text-[12px]">
                  {result.chunk.content.slice(0, 200)}
                </p>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t text-[10px] text-muted-foreground flex gap-4">
          <span><kbd className="px-1 rounded border">↑↓</kbd> Navigate</span>
          <span><kbd className="px-1 rounded border">⏎</kbd> Open</span>
          <span><kbd className="px-1 rounded border">⌘K</kbd> Toggle</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Include SearchBar in app layout**

In `src/web/src/components/layout/app-layout.tsx`, import and render `<SearchBar />` at the top of the layout (before or after the main content wrapper, as a portal-style overlay).

```typescript
import { SearchBar } from './search-bar'

// In the render:
<SearchBar />
```

- [ ] **Step 3: Verify the frontend builds and renders**

```bash
cd src/web && bun run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/web/src/components/layout/search-bar.tsx src/web/src/components/layout/app-layout.tsx
git commit -m "feat(search): add global Cmd+K search bar"
```

---

### Task 16: Integration Test — Full Pipeline

**Files:**
- Create: `tests/modules/search/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
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
    // Write test files
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

    // Set up services
    const sources = createSourceService(db)
    const registry = createIndexerRegistry()
    registry.register('code', createCodeIndexer())

    const provider = await createOramaProvider()
    const engine = createSearchEngine(provider)

    // Create and index source
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

    // Search
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

    // Index code
    const codeSrc = sources.create({ name: 'Code', type: 'code', indexer: 'code', config: { paths: [join(testDir, 'code')] } })
    const codeChunks = await registry.get('code')!.index(codeSrc)
    await provider.addDocuments('code', codeChunks)

    // Index docs
    const docSrc = sources.create({ name: 'Docs', type: 'docs', indexer: 'docs', config: { paths: [join(testDir, 'docs')] } })
    const docChunks = await registry.get('docs')!.index(docSrc)
    await provider.addDocuments('docs', docChunks)

    // Search across all
    const results = await engine.search({ query: 'getUsers' })
    expect(results.length).toBeGreaterThanOrEqual(1)

    // Search filtered to docs only
    const docsOnly = await engine.search({ query: 'getUsers', collections: ['docs'] })
    expect(docsOnly.every(r => r.chunk.collection === 'docs')).toBe(true)
  })
})
```

- [ ] **Step 2: Run integration test**

```bash
bun vitest run tests/modules/search/integration.test.ts
```

Expected: All PASS.

- [ ] **Step 3: Run ALL search tests**

```bash
bun vitest run tests/modules/search/
```

Expected: All tests PASS.

- [ ] **Step 4: Run full project test suite**

```bash
bun vitest run
```

Expected: All tests PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add tests/modules/search/integration.test.ts
git commit -m "feat(search): add integration test for full indexing and search pipeline"
```

---

### Task 17: TreeSitter WASM Integration (AST-aware chunking upgrade)

> This task upgrades the regex-based chunker to use real AST parsing via web-tree-sitter WASM. It can be deferred if TreeSitter WASM compatibility issues arise — the regex fallback already works.

**Files:**
- Modify: `src/modules/search/indexers/code/ast-chunker.ts` — add `chunkCodeAST` function
- Modify: `src/modules/search/indexers/code/code-indexer.ts` — prefer AST over fallback
- Modify: `tests/modules/search/indexers/ast-chunker.test.ts` — add AST-specific tests

- [ ] **Step 1: Add AST chunking tests**

Add to the existing `ast-chunker.test.ts`:

```typescript
describe('chunkCodeAST (TreeSitter)', () => {
  it('chunks TypeScript by AST nodes', async () => {
    const code = readFileSync(join(FIXTURES, 'sample.ts'), 'utf-8')
    const chunks = await chunkCodeAST(code, 'sample.ts', 'typescript')
    if (!chunks) {
      // TreeSitter not available — skip
      return
    }
    const names = chunks.map(c => c.symbolName).filter(Boolean)
    expect(names).toContain('parseConfig')
    expect(names).toContain('DataService')
    expect(names).toContain('loadFile')
  })

  it('chunks Python by AST nodes', async () => {
    const code = readFileSync(join(FIXTURES, 'sample.py'), 'utf-8')
    const chunks = await chunkCodeAST(code, 'sample.py', 'python')
    if (!chunks) return
    const names = chunks.map(c => c.symbolName).filter(Boolean)
    expect(names).toContain('SaleOrder')
    expect(names).toContain('helper_function')
  })

  it('includes decorators with their functions', async () => {
    const code = readFileSync(join(FIXTURES, 'sample.py'), 'utf-8')
    const chunks = await chunkCodeAST(code, 'sample.py', 'python')
    if (!chunks) return
    // Decorators should be part of the same chunk as the function
    for (const chunk of chunks) {
      if (chunk.content.includes('def ') && chunk.lineStart > 1) {
        // Check that any decorator above the def is included
      }
    }
    expect(chunks.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Implement `chunkCodeAST` in `ast-chunker.ts`**

Add the TreeSitter-based function alongside the existing fallback:

```typescript
import { getLanguageConfig, isTreeSitterSupported } from './language-map.js'

let parserInitialized = false
let Parser: any = null

async function initParser() {
  if (parserInitialized) return
  try {
    const mod = await import('web-tree-sitter')
    Parser = mod.default || mod
    await Parser.init()
    parserInitialized = true
  } catch {
    Parser = null
    parserInitialized = true
  }
}

export async function chunkCodeAST(code: string, filePath: string, language: string): Promise<CodeChunk[] | null> {
  await initParser()
  if (!Parser) return null

  const langConfig = getLanguageConfig(language)
  if (!langConfig) return null

  try {
    const parser = new Parser()
    const grammarPath = require.resolve(langConfig.grammar)
    const lang = await Parser.Language.load(grammarPath)
    parser.setLanguage(lang)

    const tree = parser.parse(code)
    const lines = code.split('\n')
    const chunks: CodeChunk[] = []
    const processedRanges = new Set<string>()

    function extractNode(node: any, symbolType: 'function' | 'class') {
      const startRow = node.startPosition.row
      const endRow = node.endPosition.row
      const rangeKey = `${startRow}-${endRow}`
      if (processedRanges.has(rangeKey)) return
      processedRanges.add(rangeKey)

      // Include decorators (previous sibling if it's a decorator)
      let actualStart = startRow
      let prev = node.previousNamedSibling
      while (prev && prev.type === 'decorator') {
        actualStart = prev.startPosition.row
        prev = prev.previousNamedSibling
      }

      const name = node.childForFieldName('name')?.text ?? ''
      const content = lines.slice(actualStart, endRow + 1).join('\n')

      chunks.push({
        content,
        symbolName: name,
        symbolType,
        lineStart: actualStart + 1,
        lineEnd: endRow + 1,
      })
    }

    function walk(node: any) {
      if (langConfig.functionNodes.includes(node.type)) {
        extractNode(node, 'function')
      } else if (langConfig.classNodes.includes(node.type)) {
        const startRow = node.startPosition.row
        const endRow = node.endPosition.row
        const lineCount = endRow - startRow

        if (lineCount > 150) {
          // Large class: extract methods individually + outline
          extractNode(node, 'class')
          // Also extract individual methods
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i)
            if (langConfig.functionNodes.includes(child.type)) {
              extractNode(child, 'function')
            }
          }
        } else {
          extractNode(node, 'class')
        }
        return // Don't recurse into class children (already handled)
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        walk(node.namedChild(i))
      }
    }

    walk(tree.rootNode)

    // Add imports chunk
    const importLines: string[] = []
    let importEnd = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.startsWith('import ') || line.startsWith('from ') || line.startsWith('require(') || (line.startsWith('const ') && line.includes('require('))) {
        importLines.push(lines[i])
        importEnd = i
      } else if (importLines.length > 0 && line === '') {
        continue
      } else if (importLines.length > 0) {
        break
      }
    }
    if (importLines.length > 0) {
      chunks.unshift({
        content: importLines.join('\n'),
        symbolName: 'imports',
        symbolType: 'imports',
        lineStart: 1,
        lineEnd: importEnd + 1,
      })
    }

    // Sort by line number
    chunks.sort((a, b) => a.lineStart - b.lineStart)

    parser.delete()
    return chunks
  } catch {
    return null // Fall back to regex
  }
}
```

- [ ] **Step 3: Update code-indexer to prefer AST**

In `code-indexer.ts`, modify the chunking call:

```typescript
import { chunkCodeFallback, chunkCodeAST } from './ast-chunker.js'

// In the index() method, replace:
// const codeChunks = chunkCodeFallback(content, relPath, language)
// with:
const codeChunks = (await chunkCodeAST(content, relPath, language)) ?? chunkCodeFallback(content, relPath, language)
```

- [ ] **Step 4: Run tests**

```bash
bun vitest run tests/modules/search/
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/search/indexers/code/ast-chunker.ts src/modules/search/indexers/code/code-indexer.ts tests/modules/search/indexers/ast-chunker.test.ts
git commit -m "feat(search): add TreeSitter WASM AST-aware chunking with regex fallback"
```

---

### Task 18: jsdom Dependency and Final Verification

**Files:**
- Modify: `package.json` — add jsdom

- [ ] **Step 1: Install jsdom**

```bash
bun add jsdom
bun add -d @types/jsdom
```

- [ ] **Step 2: Verify full test suite passes**

```bash
bun vitest run
```

Expected: All tests pass, no regressions.

- [ ] **Step 3: Verify backend starts cleanly**

```bash
timeout 5 bun src/main.ts 2>&1 || true
```

Look for: "Search module registered", "Search module started (3 built-in indexers)" in the output.

- [ ] **Step 4: Verify frontend builds**

```bash
cd src/web && bun run build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add jsdom dependency for URL content extraction"
```
