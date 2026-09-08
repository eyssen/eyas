// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SearchProvider } from './types.js'
import type { SearchResult } from '../types.js'

interface BraveWebResult {
  title?: string
  url?: string
  description?: string
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] }
}

export interface BraveSearchOptions {
  apiKey: string
}

/** Brave Search API adapter */
export function createBraveSearchProvider(options: BraveSearchOptions): SearchProvider {
  const { apiKey } = options

  return {
    id: 'brave-search',

    async search(query: string, opts?: { limit?: number }): Promise<SearchResult[]> {
      const limit = opts?.limit ?? 10
      const url = new URL('https://api.search.brave.com/res/v1/web/search')
      url.searchParams.set('q', query)
      url.searchParams.set('count', String(limit))

      const res = await fetch(url.toString(), {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        throw new Error(`Brave Search API error: ${res.status} ${res.statusText}`)
      }

      const data = (await res.json()) as BraveSearchResponse
      const results = data.web?.results ?? []

      return results.map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.description ?? '',
      }))
    },
  }
}
