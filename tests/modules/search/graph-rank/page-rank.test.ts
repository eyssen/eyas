import { describe, it, expect } from 'vitest'
import { pageRank } from '@modules/search/graph-rank/page-rank'
import type { DependencyEdge } from '@modules/search/graph-rank/types'

describe('pageRank', () => {
  it('returns empty map for empty node list', () => {
    const r = pageRank([], [])
    expect(r.size).toBe(0)
  })

  it('produces a uniform distribution on a disconnected graph with no personalization', () => {
    const nodes = ['a', 'b', 'c', 'd']
    const r = pageRank(nodes, [])
    const vals = nodes.map((n) => r.get(n)!)
    // All equal (within tolerance) and sum ~1.
    const sum = vals.reduce((s, v) => s + v, 0)
    expect(sum).toBeCloseTo(1, 5)
    for (const v of vals) expect(v).toBeCloseTo(0.25, 5)
  })

  it('converges on a small toy graph so that hub nodes rank higher than their sources', () => {
    //   a → hub
    //   b → hub
    //   c → hub
    //   hub → leaf → hub  (cycle so leaf is not dangling)
    const nodes = ['a', 'b', 'c', 'hub', 'leaf']
    const edges: DependencyEdge[] = [
      { from: 'a', to: 'hub', weight: 1 },
      { from: 'b', to: 'hub', weight: 1 },
      { from: 'c', to: 'hub', weight: 1 },
      { from: 'hub', to: 'leaf', weight: 1 },
      { from: 'leaf', to: 'hub', weight: 1 },
    ]
    const r = pageRank(nodes, edges)
    const hub = r.get('hub')!
    const a = r.get('a')!
    // hub receives rank from 4 sources (a,b,c,leaf); a only from teleport.
    expect(hub).toBeGreaterThan(a)
    // Sums to ~1.
    const sum = [...r.values()].reduce((s, v) => s + v, 0)
    expect(sum).toBeCloseTo(1, 4)
  })

  it('personalization pushes seeded nodes above disconnected peers', () => {
    const nodes = ['seed', 'other1', 'other2', 'other3']
    // No edges — a pure teleport graph.
    const p = new Map<string, number>([['seed', 1]])
    const r = pageRank(nodes, [], p)
    const seed = r.get('seed')!
    for (const n of ['other1', 'other2', 'other3']) {
      expect(seed).toBeGreaterThan(r.get(n)!)
    }
  })

  it('respects damping — lower damping amplifies personalization on a graph with edges', () => {
    // Edges between non-seed nodes so damping affects propagation away from seed.
    //    a ↔ b ↔ c  (ring), seed is isolated.
    const nodes = ['seed', 'a', 'b', 'c']
    const edges: DependencyEdge[] = [
      { from: 'a', to: 'b', weight: 1 },
      { from: 'b', to: 'c', weight: 1 },
      { from: 'c', to: 'a', weight: 1 },
    ]
    const p = new Map<string, number>([['seed', 1]])
    const low = pageRank(nodes, edges, p, { damping: 0.1 })
    const high = pageRank(nodes, edges, p, { damping: 0.85 })
    // With lower damping, teleport (which follows p) dominates → seed gets more mass.
    expect(low.get('seed')!).toBeGreaterThan(high.get('seed')!)
  })

  it('stops early when convergence tolerance is met', () => {
    const nodes = ['a', 'b']
    const edges: DependencyEdge[] = [
      { from: 'a', to: 'b', weight: 1 },
      { from: 'b', to: 'a', weight: 1 },
    ]
    const r = pageRank(nodes, edges, new Map(), { tolerance: 1e-2, maxIterations: 100 })
    const sum = [...r.values()].reduce((s, v) => s + v, 0)
    expect(sum).toBeCloseTo(1, 3)
  })

  it('ignores edges to/from unknown nodes', () => {
    const nodes = ['a', 'b']
    const edges: DependencyEdge[] = [
      { from: 'a', to: 'ghost', weight: 1 },
      { from: 'ghost', to: 'b', weight: 1 },
    ]
    // Should behave as if there were no edges.
    const r = pageRank(nodes, edges)
    expect(r.get('a')).toBeCloseTo(0.5, 5)
    expect(r.get('b')).toBeCloseTo(0.5, 5)
  })
})
