// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation } from '../types.js'

/**
 * `getService` resolves `ctx.search` per call. The search module publishes
 * that object in onRegister with `engine: null` and only builds the engine in
 * onStart, so both the object and its engine must be read at call time.
 */
export function createSearchTools(getService: () => any): ToolImplementation[] {
  return [
    {
      name: 'search_indexed',
      description: 'Full-text search across all indexed sources (code, documents, knowledge). Returns ranked results with snippets.',
      category: 'search',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (supports natural language and keywords)' },
          sourceId: { type: 'string', description: 'Limit search to a specific indexed source' },
          language: { type: 'string', description: 'Filter by programming language (for code sources)' },
          limit: { type: 'number', description: 'Maximum number of results (default: 10)' },
        },
        required: ['query'],
      },
      execute: async (input) => {
        const engine = getService()?.engine
        if (!engine) return { error: 'Search engine not initialized yet — try again shortly' }

        const results = await engine.search({
          query: input.query as string,
          filters: {
            sourceId: input.sourceId as string | undefined,
            language: input.language as string | undefined,
          },
          limit: (input.limit as number) ?? 10,
        })

        return {
          results: results.map((r: any) => ({
            content: r.chunk.content,
            score: r.score,
            sourceId: r.chunk.sourceId,
            collection: r.chunk.collection,
            metadata: r.chunk.metadata,
          })),
        }
      },
    },
  ]
}
