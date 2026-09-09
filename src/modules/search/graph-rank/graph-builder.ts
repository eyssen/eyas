// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { DependencyEdge, GraphRankIndexer, SymbolNode } from './types.js'

/**
 * Materialized graph: every symbol node plus every outgoing edge discovered
 * via the indexer. Pure data — the page-rank pass consumes it directly.
 */
export interface SymbolGraph {
  nodes: SymbolNode[]
  edges: DependencyEdge[]
  /** Map for O(1) lookup from symbol id to node. */
  byId: Map<string, SymbolNode>
}

/**
 * Build the symbol graph by walking the indexer. References to unknown symbols
 * are dropped silently (PageRank ignores dangling targets anyway).
 *
 * Complexity: O(V + E) — one getAllSymbols call plus one getReferences per symbol.
 */
export async function buildGraph(indexer: GraphRankIndexer): Promise<SymbolGraph> {
  const nodes = await indexer.getAllSymbols()
  const byId = new Map<string, SymbolNode>()
  for (const node of nodes) byId.set(node.id, node)

  const edges: DependencyEdge[] = []
  for (const node of nodes) {
    const refs = await indexer.getReferences(node.id)
    for (const ref of refs) {
      // Drop self-loops and edges pointing at unknown symbols.
      if (ref.from === ref.to) continue
      if (!byId.has(ref.to)) continue
      edges.push(ref)
    }
  }

  return { nodes, edges, byId }
}
