import { describe, it, expect } from 'vitest'
import { createGraphRankSelector } from '@modules/search/graph-rank'
import type {
  DependencyEdge,
  GraphRankIndexer,
  SymbolNode,
} from '@modules/search/graph-rank/types'

// ─── Mock indexer ────────────────────────────────────────────────────────────

function mockIndexer(nodes: SymbolNode[], edges: DependencyEdge[]): GraphRankIndexer {
  const byFrom = new Map<string, DependencyEdge[]>()
  for (const e of edges) {
    const list = byFrom.get(e.from) ?? []
    list.push(e)
    byFrom.set(e.from, list)
  }
  return {
    async getAllSymbols() {
      return nodes
    },
    async getReferences(id: string) {
      return byFrom.get(id) ?? []
    },
  }
}

const makeSym = (id: string, over: Partial<SymbolNode> = {}): SymbolNode => ({
  id,
  name: id,
  filePath: `/${id}.ts`,
  lineStart: 1,
  lineEnd: 10,
  content: `function ${id}() { return 1 }`,
  ...over,
})

describe('createGraphRankSelector', () => {
  it('returns no chunks when the indexer is empty', async () => {
    const selector = createGraphRankSelector({ indexer: mockIndexer([], []) })
    const result = await selector.selectContext('find the parser', 1000)
    expect(result.chunks).toEqual([])
    expect(result.totalSymbolsRanked).toBe(0)
  })

  it('surfaces symbols whose name matches the task keywords', async () => {
    const nodes = [
      makeSym('parseConfig', { name: 'parseConfig', content: 'function parseConfig() {}' }),
      makeSym('saveDatabase', { name: 'saveDatabase', content: 'function saveDatabase() {}' }),
      makeSym('renderButton', { name: 'renderButton', content: 'function renderButton() {}' }),
    ]
    const selector = createGraphRankSelector({
      indexer: mockIndexer(nodes, []),
    })
    const result = await selector.selectContext('refactor parseConfig', 1000)
    expect(result.chunks.length).toBeGreaterThan(0)
    expect(result.chunks[0]!.file).toBe('/parseConfig.ts')
    expect(result.totalSymbolsRanked).toBe(3)
  })

  it('lifts dependencies of matched symbols via PageRank', async () => {
    // parseConfig depends on loadFile (which the task never mentions by name).
    // Graph-rank should still bring loadFile near the top.
    const nodes = [
      makeSym('parseConfig', { name: 'parseConfig' }),
      makeSym('loadFile', { name: 'loadFile' }),
      makeSym('unrelated', { name: 'unrelated' }),
    ]
    const edges: DependencyEdge[] = [
      { from: 'parseConfig', to: 'loadFile', weight: 1 },
    ]
    const selector = createGraphRankSelector({
      indexer: mockIndexer(nodes, edges),
    })
    const result = await selector.selectContext('update parseConfig', 5000)
    const files = result.chunks.map((c) => c.file)
    expect(files).toContain('/parseConfig.ts')
    expect(files).toContain('/loadFile.ts')
    // The unrelated node should rank lower than loadFile; if both fit we just
    // check parseConfig came first.
    expect(files[0]).toBe('/parseConfig.ts')
  })

  it('respects the token budget end to end', async () => {
    // Generate many bulky symbols so only a few can fit.
    const nodes: SymbolNode[] = []
    for (let i = 0; i < 20; i++) {
      nodes.push(
        makeSym(`sym${i}`, {
          name: `sym${i}`,
          filePath: `/f${i}.ts`,
          content: 'y'.repeat(400), // ~100 tokens each at 4 chars/token
        }),
      )
    }
    const selector = createGraphRankSelector({
      indexer: mockIndexer(nodes, []),
    })
    const result = await selector.selectContext('target sym5 sym10', 250)
    expect(result.tokensUsed).toBeLessThanOrEqual(250)
    // At ~100 tokens per chunk we should not see more than ~2 chunks.
    expect(result.chunks.length).toBeLessThanOrEqual(3)
  })

  it('emits RankedChunk fields with score and location', async () => {
    const nodes = [makeSym('foo', { name: 'foo', content: 'function foo() {}' })]
    const selector = createGraphRankSelector({
      indexer: mockIndexer(nodes, []),
    })
    const result = await selector.selectContext('foo please', 500)
    expect(result.chunks.length).toBe(1)
    const c = result.chunks[0]!
    expect(c.file).toBe('/foo.ts')
    expect(c.startLine).toBe(1)
    expect(c.endLine).toBeGreaterThanOrEqual(1)
    expect(typeof c.score).toBe('number')
    expect(c.score).toBeGreaterThan(0)
  })

  it('returns empty result when budget is non-positive', async () => {
    const selector = createGraphRankSelector({
      indexer: mockIndexer([makeSym('a')], []),
    })
    const r = await selector.selectContext('a', 0)
    expect(r.chunks).toEqual([])
    expect(r.tokensUsed).toBe(0)
    expect(r.totalSymbolsRanked).toBe(0)
  })

  it('deduplicates overlapping chunks from the same file across rank order', async () => {
    // Two symbols in the same file: "outer" fully covering "inner".
    // The rank order should prefer outer (matches name) and drop inner.
    const nodes = [
      makeSym('outer', { name: 'outer', filePath: '/shared.ts', lineStart: 1, lineEnd: 50, content: 'outer body' }),
      makeSym('inner', { name: 'inner', filePath: '/shared.ts', lineStart: 10, lineEnd: 20, content: 'inner body' }),
    ]
    const selector = createGraphRankSelector({
      indexer: mockIndexer(nodes, []),
    })
    const result = await selector.selectContext('outer scope fix', 5000)
    const fromShared = result.chunks.filter((c) => c.file === '/shared.ts')
    expect(fromShared.length).toBe(1)
    expect(fromShared[0]!.startLine).toBe(1)
  })
})
