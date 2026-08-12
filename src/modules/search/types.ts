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
  /** Glob or path-segment patterns to include (e.g. "**/models/**", "addons"). */
  include?: string[]
  /** Dir names or globs to exclude (e.g. "i18n", "**/static/**"). */
  exclude?: string[]
  maxDepth?: number
  /** Short operator label for multi-version pin (e.g. "18c", "eyssen-erp"). */
  label?: string
  /** Free-form version string (e.g. "18", "19"). */
  version?: string
  /** Free-form edition (e.g. "community", "enterprise", "custom"). */
  edition?: string
  /**
   * Source family. Use "odoo" for Odoo checkouts so multi-version pin
   * safety applies. Leave unset for general codebases.
   */
  family?: string
  /** Free-form tags for filtering (e.g. ["odoo","18"]). */
  tags?: string[]
  /** Override max files walked during index (default 10_000; odoo family 50_000). */
  maxFiles?: number
  /** Override max file size in bytes for AST chunking (default 256 KiB). */
  maxFileSize?: number
  [key: string]: unknown
}

/** Conversation / tool pin for which indexed sources to use. */
export interface SearchContextSpec {
  sourceIds?: string[]
  labels?: string[]
  version?: string
  edition?: string
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
    /** Single source id (legacy). Prefer sourceIds when multiple. */
    sourceId?: string
    /** Restrict hits to these source ids. */
    sourceIds?: string[]
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
  engine: SearchEngine | null
  registry: IndexerRegistry
  sources: SourceService
  /** Set in onStart when an embedding provider is available. */
  embeddingBridge?: import('./embedding-bridge.js').EmbeddingBridge | null
  /** In-memory cosine index populated alongside FTS documents. */
  vectorIndex?: import('./vector-index.js').VectorIndex | null
}

// ─── Content Indexer (implemented by each indexer) ───

export interface ContentIndexer {
  name: string
  index(source: SearchSource): Promise<Chunk[]>
  supports(source: SearchSource): boolean
}
