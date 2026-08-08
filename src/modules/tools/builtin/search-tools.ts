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
      name: 'list_search_sources',
      description:
        'List indexed search sources (codebases, docs, files) with id, name, indexer, status, chunkCount, and paths. ' +
        'Call this before search_indexed when you need a sourceId filter, or to check whether anything is indexed. ' +
        'Empty or non-ready sources mean you cannot ground answers in indexed content — say so instead of guessing.',
      category: 'search',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          readyOnly: {
            type: 'boolean',
            description: 'If true, only return sources with status "ready" (default: false)',
          },
        },
      },
      execute: async (input) => {
        const service = getService()
        if (!service?.sources) {
          return { error: 'Search module not ready yet — try again shortly' }
        }

        const readyOnly = input.readyOnly === true
        const sources = (service.sources.list() as any[]).filter((s) =>
          readyOnly ? s.status === 'ready' : true,
        )

        return {
          sources: sources.map((s) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            indexer: s.indexer,
            status: s.status,
            chunkCount: s.chunkCount,
            lastIndexedAt: s.lastIndexedAt,
            errorMessage: s.errorMessage ?? null,
            paths: (s.config?.paths as string[] | undefined) ?? [],
            urls: (s.config?.urls as string[] | undefined) ?? [],
          })),
          total: sources.length,
          readyCount: sources.filter((s) => s.status === 'ready').length,
        }
      },
    },
    {
      name: 'search_indexed',
      description:
        'Hybrid search (FTS + vector when embeddings are available) over OWNER-INDEXED code and documentation sources. ' +
        'Does NOT search the wiki (use search_knowledge) or vault memory (use search_memory). ' +
        'WHEN TO USE (mandatory before asserting facts): APIs, function/class/symbol names, file paths, config keys, ' +
        'module behavior, library usage in this codebase, or anything claimed about indexed docs. ' +
        'Do not invent code structure from model knowledge — search first, then answer from hits. ' +
        'If results are empty, say you could not verify in indexed sources (call list_search_sources to see what is indexed). ' +
        'Each hit includes citationId — cite as [source:<citationId>] in answers. Prefer sourceId filter when known.',
      category: 'search',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (supports natural language and keywords)' },
          sourceId: { type: 'string', description: 'Limit search to a specific indexed source (from list_search_sources)' },
          language: { type: 'string', description: 'Filter by programming language (for code sources)' },
          mode: {
            type: 'string',
            description: 'Search mode: hybrid (default), fts, or vector',
            enum: ['hybrid', 'fts', 'vector'],
          },
          limit: { type: 'number', description: 'Maximum number of results (default: 10)' },
        },
        required: ['query'],
      },
      execute: async (input) => {
        const engine = getService()?.engine
        if (!engine) return { error: 'Search engine not initialized yet — try again shortly' }

        const results = await engine.search({
          query: input.query as string,
          mode: (input.mode as 'hybrid' | 'fts' | 'vector' | undefined) ?? 'hybrid',
          filters: {
            sourceId: input.sourceId as string | undefined,
            language: input.language as string | undefined,
          },
          limit: (input.limit as number) ?? 10,
        })

        return {
          results: results.map((r: any) => {
            const citationId = r.chunk.id as string
            const filePath = r.chunk.metadata?.filePath as string | undefined
            const title = r.chunk.metadata?.title as string | undefined
            const snippet = String(r.chunk.content ?? '').slice(0, 400)
            return {
              citationId,
              cite: `[source:${citationId}]`,
              content: r.chunk.content,
              snippet,
              score: r.score,
              matchType: r.matchType,
              sourceId: r.chunk.sourceId,
              collection: r.chunk.collection,
              filePath,
              title,
              metadata: r.chunk.metadata,
            }
          }),
        }
      },
    },
  ]
}
