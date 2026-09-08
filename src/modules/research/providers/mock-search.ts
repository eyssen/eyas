// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SearchProvider } from './types.js'
import type { SearchResult } from '../types.js'

/** Fixture results for testing */
const FIXTURES: Record<string, SearchResult[]> = {
  default: [
    {
      title: 'Introduction to TypeScript',
      url: 'https://example.com/typescript-intro',
      snippet: 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.',
    },
    {
      title: 'Advanced TypeScript Patterns',
      url: 'https://example.com/typescript-patterns',
      snippet: 'Learn about generics, conditional types, and mapped types in TypeScript.',
    },
    {
      title: 'TypeScript vs JavaScript',
      url: 'https://example.com/ts-vs-js',
      snippet: 'Comparing TypeScript and JavaScript: type safety, tooling, and ecosystem.',
    },
    {
      title: 'Building APIs with TypeScript',
      url: 'https://example.com/ts-apis',
      snippet: 'How to build production-ready REST APIs using TypeScript and Express.',
    },
    {
      title: 'TypeScript Best Practices 2026',
      url: 'https://example.com/ts-best-practices',
      snippet: 'Modern TypeScript best practices for large-scale applications.',
    },
  ],
}

/** Mock search provider that returns fixture data for tests */
export function createMockSearchProvider(customFixtures?: Record<string, SearchResult[]>): SearchProvider {
  const fixtures = { ...FIXTURES, ...customFixtures }

  return {
    id: 'mock-search',

    async search(query: string, opts?: { limit?: number }): Promise<SearchResult[]> {
      const limit = opts?.limit ?? 10
      const results = fixtures[query] ?? fixtures.default ?? []
      return results.slice(0, limit)
    },
  }
}
