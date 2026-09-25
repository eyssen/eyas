// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SearchResult } from '../types.js'

/** Search provider interface — adapters for web search APIs */
export interface SearchProvider {
  id: string
  search(query: string, options?: { limit?: number }): Promise<SearchResult[]>
}
