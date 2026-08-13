import { describe, it, expect } from 'vitest'
import { buildGraph } from '@modules/search/graph-rank/graph-builder'
import type {
  DependencyEdge,
  GraphRankIndexer,
  SymbolNode,
} from '@modules/search/graph-rank/types'

function indexer(nodes: SymbolNode[], refs: Record<string, DependencyEdge[]>): GraphRankIndexer {
  return {
    async getAllSymbols() {
      return nodes
    },
    async getReferences(id) {
      return refs[id] ?? []
    },
  }
}

const n = (id: string): SymbolNode => ({
  id,
  name: id,
  filePath: `/${id}.ts`,
  lineStart: 1,
  lineEnd: 1,
  content: id,
})

describe('buildGraph', () => {
  it('returns an empty graph when the indexer has no symbols', async () => {
    const g = await buildGraph(indexer([], {}))
    expect(g.nodes).toEqual([])
    expect(g.edges).toEqual([])
    expect(g.byId.size).toBe(0)
  })

  it('drops self-loops', async () => {
    const g = await buildGraph(
      indexer(
        [n('a')],
        { a: [{ from: 'a', to: 'a', weight: 1 }] },
      ),
    )
    expect(g.edges).toEqual([])
  })

  it('drops edges pointing at unknown symbols', async () => {
    const g = await buildGraph(
      indexer(
        [n('a'), n('b')],
        { a: [{ from: 'a', to: 'ghost', weight: 1 }, { from: 'a', to: 'b', weight: 1 }] },
      ),
    )
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0]!.to).toBe('b')
  })

  it('exposes byId lookup', async () => {
    const g = await buildGraph(indexer([n('a'), n('b')], {}))
    expect(g.byId.get('a')?.id).toBe('a')
    expect(g.byId.get('b')?.id).toBe('b')
    expect(g.byId.get('missing')).toBeUndefined()
  })
})
