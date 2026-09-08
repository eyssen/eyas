// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SearchEngine } from '../types.js'

/**
 * A symbol node in the dependency graph — typically a function, class, or module-level
 * declaration extracted from the AST indexer's chunk metadata.
 */
export interface SymbolNode {
  /** Unique identifier for the symbol (usually `${filePath}#${symbolName}` or chunk id). */
  id: string
  /** Human-readable symbol name (e.g. `parseConfig`, `DatabaseConnection`). */
  name: string
  /** Source file containing this symbol. */
  filePath: string
  /** 1-based line where the symbol starts. */
  lineStart: number
  /** 1-based line where the symbol ends. */
  lineEnd: number
  /** Optional language tag (e.g. `typescript`). */
  language?: string
  /** The raw source content of the symbol, used for packing into context. */
  content: string
  /** Optional free-text docstring / comment extracted from the chunk, for matching. */
  docstring?: string
}

/**
 * A directed edge: `from` depends on / references / calls `to`.
 * Weight is in (0, 1] — 1.0 for direct references, 0.5 for weaker transitive hints.
 */
export interface DependencyEdge {
  from: string
  to: string
  weight: number
}

/**
 * A single ranked chunk returned by the selector, ready to be packed into a prompt.
 */
export interface RankedChunk {
  file: string
  startLine: number
  endLine: number
  content: string
  score: number
}

/**
 * Result envelope returned by `selectContext`.
 */
export interface SelectContextResult {
  chunks: RankedChunk[]
  tokensUsed: number
  totalSymbolsRanked: number
}

/**
 * A minimal indexer adapter — the graph-rank layer only needs to pull symbols and
 * their cross-references. Real implementations wrap the SQLite AST index or the
 * in-memory SearchEngine; tests supply a mock.
 */
export interface GraphRankIndexer {
  /** Return every symbol known to the index. */
  getAllSymbols(): Promise<SymbolNode[]>
  /** Return outgoing references for a symbol (calls, imports, type uses). */
  getReferences(symbolId: string): Promise<DependencyEdge[]>
  /**
   * Optional full-text search over symbol names/content. Used as a hint for the
   * personalization vector when present; the selector falls back to in-memory
   * keyword matching otherwise.
   */
  searchSymbols?(query: string, limit: number): Promise<SymbolNode[]>
}

/** Options for the page-rank pass. */
export interface PageRankOptions {
  damping?: number
  maxIterations?: number
  tolerance?: number
}

/** Public API of the graph-rank selector. */
export interface GraphRankSelector {
  selectContext(task: string, tokenBudget: number): Promise<SelectContextResult>
}

/** Dependencies required to build a real selector (kept small for testability). */
export interface GraphRankDeps {
  indexer: GraphRankIndexer
  /** Optional SearchEngine for keyword-based boosting of the personalization vector. */
  searchEngine?: SearchEngine
  /** Optional PageRank knobs. */
  pageRankOptions?: PageRankOptions
  /** Max lines per packed chunk (defaults to 200). */
  maxChunkLines?: number
  /** Approx chars/token ratio for the budget estimator (defaults to 4). */
  charsPerToken?: number
}
