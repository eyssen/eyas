// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ContentIndexer, IndexerRegistry } from './types.js'

export function createIndexerRegistry(): IndexerRegistry {
  const indexers = new Map<string, ContentIndexer>()

  return {
    register(name: string, indexer: ContentIndexer): void {
      if (indexers.has(name)) throw new Error(`Indexer "${name}" already registered`)
      indexers.set(name, indexer)
    },

    get(name: string): ContentIndexer | null {
      return indexers.get(name) ?? null
    },

    list(): string[] {
      return Array.from(indexers.keys())
    },
  }
}
