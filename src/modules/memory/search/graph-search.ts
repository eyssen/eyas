// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { WikilinkService, WikilinkNodeType } from '@shared/wikilinks'

export interface SeedNode {
  type: WikilinkNodeType
  id: string
}

export function createGraphSearch(wikilinks: WikilinkService) {
  return {
    computeBoosts(seeds: SeedNode[], boostScore: number = 0.01): Map<string, number> {
      const boosts = new Map<string, number>()
      const seedSet = new Set(seeds.map(s => `${s.type}:${s.id}`))

      for (const seed of seeds) {
        const neighbors = wikilinks.getNeighbors(seed.type, seed.id)
        for (const n of neighbors) {
          const key = `${n.type}:${n.id}`
          if (seedSet.has(key)) continue
          boosts.set(key, (boosts.get(key) ?? 0) + boostScore)
        }
      }

      return boosts
    },
  }
}

export type GraphSearch = ReturnType<typeof createGraphSearch>
