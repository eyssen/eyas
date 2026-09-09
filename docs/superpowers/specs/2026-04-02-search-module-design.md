# Search Module — Design Spec

**Date:** 2026-04-02
**Module:** `search`
**Type:** core, non-required
**Dependencies:** `model` (optional, for embeddings)

## Purpose

Development context indexer that enables efficient retrieval of source code, documentation, and general files. Other modules (memory, self-learning, etc.) can register their own indexers via the IndexerRegistry, making the search engine a shared knowledge infrastructure.

Inspired by Cursor's indexing architecture: AST-aware code chunking, hybrid FTS+vector search, and incremental indexing with embedding cache.

## Architecture

```
src/modules/search/
  index.ts                         — module entry (onRegister: tables, onStart: routes + built-in indexers)
  engine.ts                        — SearchEngine: unified query (FTS + vector + hybrid)
  source-service.ts                — search_sources table CRUD
  registry.ts                      — IndexerRegistry: other modules register their indexers
  embedding-bridge.ts              — model module embedding API wrapper
  providers/
    types.ts                       — SearchProvider interface
    orama/
      orama-provider.ts            — Orama instance management, index/search/remove
      orama-schemas.ts             — collection schemas (code, docs, files, custom)
  indexers/
    types.ts                       — ContentIndexer interface + Chunk type
    code/
      code-indexer.ts              — source code indexer orchestration
      ast-chunker.ts               — TreeSitter WASM AST-aware chunking
      language-map.ts              — file extension → TreeSitter grammar mapping
    docs/
      doc-indexer.ts               — documentation indexer orchestration
      url-fetcher.ts               — fetch + @mozilla/readability → markdown
      file-reader.ts               — local .md/.txt/.rst reading
    files/
      file-indexer.ts              — general file indexer orchestration, extension routing
      parsers/
        markdown-parser.ts         — .md, .txt, .rst → heading chunk
        pdf-parser.ts              — pdf-parse → text → chunk
        docx-parser.ts             — mammoth → markdown → chunk
        xlsx-parser.ts             — SheetJS → sheet rows → chunk
  routes.ts                        — REST API endpoints
```

## Key Interfaces

### ContentIndexer — indexer abstraction

```typescript
interface ContentIndexer {
  name: string
  index(source: SearchSource): Promise<Chunk[]>
  supports(source: SearchSource): boolean
}
```

Any module can implement `ContentIndexer` and register it via `IndexerRegistry`. The search module ships with three built-in indexers: `code`, `docs`, `files`.

### IndexerRegistry — module registration

```typescript
interface IndexerRegistry {
  register(name: string, indexer: ContentIndexer): void
  get(name: string): ContentIndexer | null
  list(): string[]
}
```

Other modules register indexers in their `onStart`:

```typescript
// Example: memory module registering a knowledge indexer
ctx.search.registry.register('knowledge', knowledgeIndexer)
```

### Chunk — the indexing unit

```typescript
interface Chunk {
  id: string
  sourceId: string
  content: string
  metadata: {
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
    [key: string]: unknown        // extensible for custom indexers
  }
}
```

### SearchSource — source configuration

```typescript
interface SearchSource {
  id: string
  name: string                    // "Odoo 18 Source", "Company Docs"
  type: string                    // "code" | "docs" | "files" | any custom
  indexer: string                 // which registered indexer handles this
  config: {
    paths?: string[]              // local directories
    urls?: string[]               // URLs to fetch
    include?: string[]            // glob patterns (e.g. "**/*.pdf")
    exclude?: string[]            // exclusions
    maxDepth?: number             // URL crawl depth
    [key: string]: unknown        // indexer-specific config
  }
  status: 'idle' | 'indexing' | 'ready' | 'error'
  lastIndexedAt: string | null
  chunkCount: number
  errorMessage: string | null
}
```

### SearchQuery and SearchResult

```typescript
interface SearchQuery {
  query: string
  mode: 'fts' | 'vector' | 'hybrid'     // default: hybrid
  collections?: string[]                  // filter by collection (default: all)
  filters?: {
    language?: string
    filePath?: string                     // glob pattern
    sourceId?: string
  }
  limit?: number                          // default: 20
  minScore?: number                       // 0-1, minimum relevance
}

interface SearchResult {
  chunk: Chunk
  score: number                           // 0-1 normalized relevance
  matchType: 'fts' | 'vector' | 'both'
}
```

### SearchProvider — search backend abstraction

```typescript
interface SearchProvider {
  addDocuments(collection: string, chunks: Chunk[]): Promise<void>
  search(query: SearchQuery): Promise<SearchResult[]>
  removeBySource(sourceId: string): Promise<void>
}
```

### ModuleContext extension

```typescript
interface SearchContext {
  engine: SearchEngine
  registry: IndexerRegistry
  sources: SourceService
}
// Exposed as ctx.search
```

## Database Schema

```sql
-- Source registration
CREATE TABLE search_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  indexer TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'idle',
  chunk_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  last_indexed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Chunk storage + embedding cache
-- Chunks are persisted here so Orama (in-memory) can be rebuilt on restart
-- without re-reading source files. Embedding is cached by content_hash.
CREATE TABLE search_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL,
  embedding BLOB,
  embedding_model TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_chunks_source ON search_chunks(source_id);
CREATE INDEX idx_chunks_collection ON search_chunks(collection);
CREATE INDEX idx_chunks_hash ON search_chunks(content_hash);

-- File mtime tracking for incremental indexing
CREATE TABLE search_file_state (
  source_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mtime TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, file_path)
);
```

## Orama Collections

Runtime, in-memory, loaded from DB on startup:

| Collection | Content | FTS fields | Vector field |
|------------|---------|------------|--------------|
| `code` | Source code chunks | content, filePath, language, symbolName | embedding (optional) |
| `docs` | Documentation chunks | content, title, section, url | embedding (optional) |
| `files` | File chunks | content, filePath, title, section | embedding (optional) |
| `{custom}` | Registered by other modules | indexer-defined | embedding (optional) |

## Search Engine — Query Pipeline

### Hybrid search

```
Query
  ├─ FTS (Orama BM25) ──────→ top-50 results + scores
  ├─ Vector (Orama cosine) ──→ top-50 results + scores  (skip if no embeddings)
  └─ Merge ──→ RRF (Reciprocal Rank Fusion) ──→ top-K final results
```

### RRF (Reciprocal Rank Fusion)

```
score(doc) = Σ  1 / (k + rank_i(doc))     // k = 60 (standard)
```

Simple, proven technique for merging two rank lists without needing a cross-encoder reranker.

### Embedding bridge

```typescript
// embedding-bridge.ts
async function embed(texts: string[]): Promise<Float32Array[] | null> {
  // 1. Is there a configured embedding provider? (OpenAI, Google, etc.)
  // 2. If yes → batch API call → float32 vectors
  // 3. If no → return null (FTS-only mode)
  // Batch size: 100 chunks per request
}
```

Uses the existing model module's provider infrastructure. No embedding provider configured → graceful degradation to FTS-only.

## Indexers — Chunking Strategies

### Code Indexer (AST-aware)

```
Source directory
  → file scan (include/exclude glob)
  → mtime check (skip if unchanged)
  → TreeSitter WASM parse → AST
  → logical unit chunking:
      - function/method → 1 chunk (any size, no min/max)
      - class <150 lines → 1 chunk
      - class >150 lines → per-method chunks + 1 "class outline" chunk
      - function >300 lines → 1 full chunk + 1 "outline" chunk
      - decorators/annotations → always included with their unit
      - top-level constants/config → collected into 1 chunk
      - imports → 1 chunk per file
  → chunk metadata: filePath, lineStart, lineEnd, language, symbolName
```

**No min/max line limits** — everything gets indexed. Short 3-line compute methods and 500-line Odoo methods are both first-class citizens.

**Outline chunks** for large units — extra search entry point:
```
"class SaleOrder(models.Model):
  _compute_amount(self)  # line 145-450
  _prepare_invoice(self)  # line 452-580
  action_confirm(self)    # line 582-620"
```

**Embedding truncation:** if a chunk exceeds the embedding model's token limit (e.g. 8K), truncate for embedding generation only. Full content remains searchable via FTS.

**Supported languages v1** (TreeSitter WASM grammars, ~5MB total):
TypeScript, JavaScript, Python, Go, Rust, Java

**Fallback** for unsupported languages: regex-based smart chunking (function/class boundaries), then 50-line fixed chunks if regex fails.

### Docs Indexer

**URL source:**
```
fetch(url)
  → @mozilla/readability → clean HTML → main content
  → turndown → markdown conversion
  → heading-based chunking (at ## level)
  → chunk metadata: url, title, section
```

**Local file source:**
```
  → .md/.txt/.rst direct reading
  → heading-based chunking
  → chunk metadata: filePath, title, section
```

**Heading chunk logic:** Split at H2. No H2 → split at H1. No headings → 500-word fixed chunks. No max limit per chunk.

**URL crawling:** optional `maxDepth` config. Default: 0 (single page). Follows same-origin links only.

### Files Indexer

```
Directory scan (include/exclude glob)
  → extension-based parser selection:
      .md/.txt/.rst  → heading chunk (same as docs)
      .pdf           → pdf-parse → text → heading/page chunk
      .docx          → mammoth → markdown → heading chunk
      .xlsx/.csv     → SheetJS → per-sheet row text → fixed chunk
      other          → skip + warning log
```

**PDF specifics:** chunk by headings if present, otherwise by page. Metadata: `filePath`, `page`, `title`.

**Excel specifics:** each sheet separate. Header row → context prefix, then every N rows (default: 50) one chunk. Metadata: `filePath`, `sheetName`, `rowRange`.

## Incremental Indexing

```
Reindex request
  → file scan (code/files) or fetch (docs)
  → per file: mtime comparison with stored value
      → changed → re-parse + chunk + embed
      → unchanged → skip
      → deleted file → remove chunks
  → new/modified chunks: content_hash calculation
      → hash matches stored embedding → reuse embedding
      → hash differs → generate new embedding
  → Orama collection update (remove old + add new)
  → update search_sources.chunk_count and last_indexed_at
```

## REST API

```
GET    /api/v1/search                    — search (query, mode, collections, filters, limit)
GET    /api/v1/search/sources            — list all sources
POST   /api/v1/search/sources            — add new source
PATCH  /api/v1/search/sources/:id        — update source
DELETE /api/v1/search/sources/:id        — delete source + its chunks
POST   /api/v1/search/sources/:id/index  — trigger (re)indexing
GET    /api/v1/search/sources/:id/status — indexing status (chunk count, errors, last indexed)
GET    /api/v1/search/stats              — aggregate stats (sources, chunks, embedding coverage)
```

## Frontend

### Global search bar

- Location: sidebar top or header, `Cmd+K` shortcut
- Instant FTS search while typing (300ms debounce)
- Results grouped by collection (Code, Docs, Files)
- Code results: file path + language icon + highlighted matching lines
- Docs results: title + section + snippet
- Click action: code → code view modal (syntax highlighting), docs → content display

### Settings / Sources page

- Source list (name, type, status, chunk count, last indexed)
- Add source form: name, type selector (code/docs/files), path/URL, include/exclude patterns
- Reindex button per source
- Delete button

## Background Indexing

Indexing does **not** block the server:
- `POST /sources/:id/index` → immediate `202 Accepted` + status = `indexing`
- Async worker runs indexing (simple Promise in Bun, no worker threads)
- Progress trackable via `status` endpoint
- Bus events: `eyas.search.index.started`, `eyas.search.index.completed`, `eyas.search.index.error`

## Startup Behavior

1. `onStart` → create Orama instance
2. Load `search_sources` → load all `ready` source chunks from `search_chunks` (content + embeddings persisted in SQLite)
3. Populate Orama collections (FTS + cached embeddings) — no re-reading of source files needed
4. If source `status = error` → skip, warning log
5. Ready → search API available

## Dependencies

| Package | Version | License | Size | Purpose |
|---------|---------|---------|------|---------|
| `@orama/orama` | ^3.x | Apache-2.0 | ~50KB | FTS + vector search engine |
| `web-tree-sitter` | ^0.24.4 | MIT | ~4.3MB | AST parsing (WASM) |
| `tree-sitter-wasms` | ^0.1.13 | Unlicense | ~5MB | Prebuilt grammar WASM files |
| `@mozilla/readability` | ^0.5.x | Apache-2.0 | ~40KB | HTML → clean content extraction |
| `turndown` | ^7.x | MIT | ~30KB | HTML → Markdown conversion |
| `pdf-parse` | ^1.x | MIT | ~15KB | PDF text extraction |
| `mammoth` | ^1.x | BSD-2 | ~200KB | DOCX → HTML/Markdown |
| `xlsx` | ^0.18.x | Apache-2.0 | ~1MB | Excel/CSV parsing |

All licenses MIT-compatible (MIT, BSD-2, Apache-2.0, Unlicense).

## Testing Strategy

```
tests/modules/search/
  engine.test.ts                  — SearchEngine query pipeline, RRF ranking
  source-service.test.ts          — CRUD, status management
  registry.test.ts                — indexer registration, lookup
  orama-provider.test.ts          — Orama index/search/remove
  embedding-bridge.test.ts        — mock model provider, cache hit/miss
  indexers/
    code-indexer.test.ts          — AST chunking (fixtures: .ts, .py files)
    ast-chunker.test.ts           — TreeSitter parse + chunk boundary detection
    doc-indexer.test.ts           — URL fetch mock + local file indexing
    file-indexer.test.ts          — PDF/DOCX/XLSX parser tests (small fixture files)
  routes.test.ts                  — REST API integration tests
```

**Mock strategy:**
- Embedding API → mock model provider (returns fixed vectors)
- URL fetch → mock HTTP response (fixture HTML)
- TreeSitter → real WASM parse (fast, no mock needed)
- File parsers → small fixture files in `tests/fixtures/search/`

## Future Extensions (not in v1 scope)

- **Knowledge indexer** — auto-built knowledge base from system activities (memory/self-learning module registers its own indexer)
- **Conversation indexer** — search through conversation history
- **Scheduled reindexing** — cron-based refresh (needs scheduler module)
- **File watcher** — fs.watch for real-time incremental updates
- **Additional languages** — more TreeSitter grammars as needed
- **Pre-indexed popular docs** — ship common library docs pre-indexed (Cursor-style)
