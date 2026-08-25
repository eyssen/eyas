// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { buildGraph } from './graph-builder.js'
import { pageRank } from './page-rank.js'
import type {
  GraphRankDeps,
  GraphRankSelector,
  RankedChunk,
  SelectContextResult,
  SymbolNode,
} from './types.js'

// ─── Keyword extraction ──────────────────────────────────────────────────────

/**
 * Common English stopwords — trimmed list, enough to keep task descriptions
 * focused without pulling in a full NLP dep.
 */
const STOPWORDS = new Set<string>([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'for', 'of',
  'on', 'in', 'to', 'at', 'by', 'with', 'from', 'as', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'this', 'that', 'these', 'those', 'it', 'its', 'i', 'we', 'you', 'they',
  'me', 'my', 'our', 'your', 'their', 'not', 'no', 'so', 'than', 'too',
  'can', 'will', 'would', 'should', 'could', 'may', 'might', 'must',
  'about', 'into', 'onto', 'over', 'under', 'out', 'up', 'down', 'off',
  'there', 'where', 'when', 'while', 'how', 'why', 'what', 'which', 'who',
  'whom', 'whose', 'some', 'any', 'each', 'every', 'all', 'both', 'few',
  'more', 'most', 'other', 'such', 'only', 'own', 'same', 'just', 'very',
])

const MIN_TOKEN_LEN = 2

/**
 * Extract a set of lowercase keyword tokens from a task description.
 * Splits on whitespace and punctuation, then further splits CamelCase and
 * snake_case identifiers so `parseConfig` and `parse_config` both yield
 * `parse` + `config`.
 *
 * Exported for direct testing.
 */
export function extractKeywords(task: string): string[] {
  if (!task) return []
  const seen = new Set<string>()
  const tokens = task.split(/[^A-Za-z0-9_]+/).filter(Boolean)

  const push = (raw: string) => {
    const lower = raw.toLowerCase()
    if (lower.length < MIN_TOKEN_LEN) return
    if (STOPWORDS.has(lower)) return
    if (!/[a-z]/.test(lower)) return
    seen.add(lower)
  }

  for (const tok of tokens) {
    // snake_case → split on underscore.
    const snakeParts = tok.split('_').filter(Boolean)
    for (const part of snakeParts) {
      // CamelCase / PascalCase: insert boundaries before uppercase runs.
      // Handles `HTTPServer` → `HTTP`, `Server`; `parseXMLDoc` → `parse`, `XML`, `Doc`.
      const camelParts = part
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/\s+/)
        .filter(Boolean)
      for (const cp of camelParts) push(cp)
      // Also keep the original joined form so exact-name matches still score high.
      push(part)
    }
  }

  return [...seen]
}

// ─── Personalization vector ──────────────────────────────────────────────────

interface MatchScore {
  symbolId: string
  score: number
}

/**
 * Score a symbol against the task keywords. Higher is better.
 *  - Exact name match (case-insensitive): 10
 *  - Name contains keyword as substring: 3 per keyword
 *  - Docstring contains keyword: 1 per keyword
 * Exported for testing.
 */
export function scoreSymbol(symbol: SymbolNode, keywords: string[]): number {
  if (keywords.length === 0) return 0
  const nameLower = symbol.name.toLowerCase()
  const docLower = symbol.docstring?.toLowerCase() ?? ''
  let score = 0
  for (const kw of keywords) {
    if (nameLower === kw) score += 10
    else if (nameLower.includes(kw)) score += 3
    if (docLower.includes(kw)) score += 1
  }
  return score
}

function buildPersonalization(
  symbols: SymbolNode[],
  keywords: string[],
): Map<string, number> {
  const vec = new Map<string, number>()
  for (const s of symbols) {
    const score = scoreSymbol(s, keywords)
    if (score > 0) vec.set(s.id, score)
  }
  return vec
}

// ─── Chunk packing ───────────────────────────────────────────────────────────

/**
 * Pack ranked symbols into a token budget. Chunks are truncated to
 * `maxChunkLines`, deduplicated per file by overlapping line ranges, and
 * emitted in descending rank order until the budget is exhausted.
 *
 * Exported for testing.
 */
export function packChunks(
  ranked: MatchScore[],
  symbols: Map<string, SymbolNode>,
  tokenBudget: number,
  maxChunkLines: number,
  charsPerToken: number,
): { chunks: RankedChunk[]; tokensUsed: number } {
  const chunks: RankedChunk[] = []
  let tokensUsed = 0

  // Track line ranges already packed per file to skip overlapping chunks.
  const packedRanges = new Map<string, Array<[number, number]>>()

  const overlaps = (file: string, start: number, end: number): boolean => {
    const ranges = packedRanges.get(file)
    if (!ranges) return false
    for (const [s, e] of ranges) {
      if (!(end < s || start > e)) return true
    }
    return false
  }

  for (const { symbolId, score } of ranked) {
    if (tokensUsed >= tokenBudget) break
    const sym = symbols.get(symbolId)
    if (!sym) continue

    const contentLines = sym.content.split('\n')
    const wasTruncated = contentLines.length > maxChunkLines
    const truncated = wasTruncated
      ? contentLines.slice(0, maxChunkLines).join('\n')
      : sym.content

    const startLine = sym.lineStart
    // Use the symbol's declared end when we didn't truncate so overlap detection
    // reflects the real source range. When we did truncate, cap at maxChunkLines.
    const endLine = wasTruncated
      ? startLine + maxChunkLines - 1
      : sym.lineEnd

    if (overlaps(sym.filePath, startLine, endLine)) continue

    const tokenCost = Math.ceil(truncated.length / charsPerToken)
    if (tokensUsed + tokenCost > tokenBudget) {
      // Skip this chunk — it would push us over. Continue to try smaller ones.
      continue
    }

    chunks.push({
      file: sym.filePath,
      startLine,
      endLine,
      content: truncated,
      score,
    })
    tokensUsed += tokenCost

    const ranges = packedRanges.get(sym.filePath) ?? []
    ranges.push([startLine, endLine])
    packedRanges.set(sym.filePath, ranges)
  }

  return { chunks, tokensUsed }
}

// ─── Public factory ──────────────────────────────────────────────────────────

const DEFAULT_MAX_CHUNK_LINES = 200
const DEFAULT_CHARS_PER_TOKEN = 4

/**
 * Create a graph-rank context selector. On each `selectContext` call:
 *   1. Build the full symbol graph via the indexer
 *   2. Extract keywords from the task and compute a personalization vector
 *   3. Run personalized PageRank
 *   4. Sort symbols by final rank and pack into the token budget
 */
export function createContextSelector(deps: GraphRankDeps): GraphRankSelector {
  const maxChunkLines = deps.maxChunkLines ?? DEFAULT_MAX_CHUNK_LINES
  const charsPerToken = deps.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN

  return {
    async selectContext(task: string, tokenBudget: number): Promise<SelectContextResult> {
      if (tokenBudget <= 0) return { chunks: [], tokensUsed: 0, totalSymbolsRanked: 0 }

      const graph = await buildGraph(deps.indexer)
      if (graph.nodes.length === 0) {
        return { chunks: [], tokensUsed: 0, totalSymbolsRanked: 0 }
      }

      const keywords = extractKeywords(task)
      const personalization = buildPersonalization(graph.nodes, keywords)

      const ranks = pageRank(
        graph.nodes.map((n) => n.id),
        graph.edges,
        personalization,
        deps.pageRankOptions,
      )

      const ranked: MatchScore[] = []
      for (const node of graph.nodes) {
        ranked.push({ symbolId: node.id, score: ranks.get(node.id) ?? 0 })
      }
      ranked.sort((a, b) => b.score - a.score)

      const { chunks, tokensUsed } = packChunks(
        ranked,
        graph.byId,
        tokenBudget,
        maxChunkLines,
        charsPerToken,
      )

      return {
        chunks,
        tokensUsed,
        totalSymbolsRanked: graph.nodes.length,
      }
    },
  }
}
