// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { DependencyEdge, PageRankOptions } from './types.js'

/**
 * Personalized PageRank via the iterative power method.
 *
 * Complexity: O((V + E) * iterations) — one sparse mat-vec per iteration plus
 * rank-mass normalization. Converges quickly for damping <= 0.85 on realistic
 * code graphs.
 *
 * @param nodeIds list of node identifiers (defines iteration order)
 * @param edges directed, weighted edges (weights ∈ (0, 1])
 * @param personalization map of nodeId → initial bias mass; missing nodes get 0.
 *        Values are normalized internally so the vector sums to 1; if every
 *        value is 0 (or the map is empty) a uniform distribution is used.
 * @param options damping, maxIterations, tolerance
 * @returns map of nodeId → final PageRank score (sums to ~1)
 */
export function pageRank(
  nodeIds: string[],
  edges: DependencyEdge[],
  personalization: Map<string, number> = new Map(),
  options: PageRankOptions = {},
): Map<string, number> {
  const damping = options.damping ?? 0.85
  const maxIterations = options.maxIterations ?? 30
  const tolerance = options.tolerance ?? 1e-6

  const n = nodeIds.length
  if (n === 0) return new Map()

  // ─── Index nodes ──────────────────────────────────────────────────────────
  const idx = new Map<string, number>()
  for (let i = 0; i < n; i++) idx.set(nodeIds[i]!, i)

  // ─── Build outgoing adjacency (weighted) + out-weight sum per node ───────
  const outEdges: Array<Array<{ to: number; w: number }>> = Array.from({ length: n }, () => [])
  const outSum = new Float64Array(n)
  for (const edge of edges) {
    const from = idx.get(edge.from)
    const to = idx.get(edge.to)
    if (from === undefined || to === undefined) continue
    const w = edge.weight > 0 ? edge.weight : 0
    if (w === 0) continue
    outEdges[from]!.push({ to, w })
    outSum[from] += w
  }

  // ─── Build personalization vector p (normalized) ─────────────────────────
  const p = new Float64Array(n)
  let pSum = 0
  for (const [nodeId, mass] of personalization) {
    const i = idx.get(nodeId)
    if (i === undefined) continue
    const v = mass > 0 ? mass : 0
    p[i] = v
    pSum += v
  }
  if (pSum === 0) {
    // Uniform teleport when no personalization is provided.
    for (let i = 0; i < n; i++) p[i] = 1 / n
  } else {
    for (let i = 0; i < n; i++) p[i] /= pSum
  }

  // ─── Initialize ranks uniformly ──────────────────────────────────────────
  let rank = new Float64Array(n)
  for (let i = 0; i < n; i++) rank[i] = 1 / n
  let next = new Float64Array(n)

  // ─── Power iteration ─────────────────────────────────────────────────────
  for (let iter = 0; iter < maxIterations; iter++) {
    // Handle dangling mass: nodes with no outgoing edges redistribute via p.
    let danglingMass = 0
    for (let i = 0; i < n; i++) {
      if (outSum[i] === 0) danglingMass += rank[i]!
    }

    // Teleport contribution: (1 - damping) * p + damping * danglingMass * p
    const teleport = (1 - damping) + damping * danglingMass
    for (let i = 0; i < n; i++) next[i] = teleport * p[i]!

    // Propagate rank along outgoing edges.
    for (let i = 0; i < n; i++) {
      const outs = outEdges[i]!
      if (outs.length === 0) continue
      const s = outSum[i]!
      const contrib = damping * rank[i]! / s
      for (const e of outs) {
        next[e.to] += contrib * e.w
      }
    }

    // ─── Convergence check (L1 norm) ───────────────────────────────────────
    let delta = 0
    for (let i = 0; i < n; i++) delta += Math.abs(next[i]! - rank[i]!)

    const tmp = rank
    rank = next
    next = tmp

    if (delta < tolerance) break
  }

  const result = new Map<string, number>()
  for (let i = 0; i < n; i++) result.set(nodeIds[i]!, rank[i]!)
  return result
}
