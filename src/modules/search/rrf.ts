// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Shared Reciprocal Rank Fusion helper (exported for unit tests).
 * Kept thin — production fusion lives inside engine.ts with SearchResult typing.
 */

export function reciprocalRankFusion(
  rankedLists: Array<{ id: string; score?: number }[]>,
  weights: number[],
  k = 60,
): Array<{ id: string; score: number }> {
  const map = new Map<string, number>()
  for (let li = 0; li < rankedLists.length; li++) {
    const list = rankedLists[li]
    const w = weights[li] ?? 1
    for (let i = 0; i < list.length; i++) {
      const id = list[i].id
      map.set(id, (map.get(id) ?? 0) + w / (k + i + 1))
    }
  }
  return Array.from(map.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}
