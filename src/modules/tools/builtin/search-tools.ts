// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation, ToolContext } from '../types.js'
import type { SearchContextSpec } from '@modules/search/types.js'
import {
  createSearchContextResolver,
  type ExplicitSearchFilter,
  type SearchContextResolver,
} from '@modules/search/resolve-context.js'

/**
 * `getService` resolves `ctx.search` per call. The search module publishes
 * that object in onRegister with `engine: null` and only builds the engine in
 * onStart, so both the object and its engine must be read at call time.
 */
export function createSearchTools(getService: () => any): ToolImplementation[] {
  function sourceMeta(s: any) {
    const c = s.config ?? {}
    return {
      id: s.id,
      name: s.name,
      type: s.type,
      indexer: s.indexer,
      status: s.status,
      chunkCount: s.chunkCount,
      lastIndexedAt: s.lastIndexedAt,
      errorMessage: s.errorMessage ?? null,
      paths: (c.paths as string[] | undefined) ?? [],
      urls: (c.urls as string[] | undefined) ?? [],
      label: typeof c.label === 'string' ? c.label : undefined,
      version: typeof c.version === 'string' ? c.version : undefined,
      edition: typeof c.edition === 'string' ? c.edition : undefined,
      family: typeof c.family === 'string' ? c.family : undefined,
      tags: Array.isArray(c.tags) ? c.tags : [],
      exclude: Array.isArray(c.exclude) ? c.exclude : [],
      include: Array.isArray(c.include) ? c.include : [],
    }
  }

  function getResolver(): SearchContextResolver | null {
    const service = getService()
    if (service?.resolveContext) return service.resolveContext as SearchContextResolver
    if (!service?.sources) return null
    return createSearchContextResolver({
      listSources: () => service.sources.list(),
    })
  }

  function resolvePin(ctx: ToolContext | undefined, explicit: ExplicitSearchFilter) {
    const resolver = getResolver()
    if (!resolver) {
      return {
        sourceIds: explicit.sourceIds ?? (explicit.sourceId ? [explicit.sourceId] : []),
        sources: [] as any[],
        roots: [] as string[],
        reason: 'no resolver',
        pinned: Boolean(explicit.sourceIds?.length || explicit.sourceId),
        needsPin: false,
        available: [] as any[],
      }
    }
    return resolver.resolve({
      conversationId: ctx?.conversationId,
      explicit,
    })
  }

  return [
    {
      name: 'list_search_sources',
      description:
        'List indexed search sources (codebases, docs, files) with id, name, label, version, edition, family, tags, status, chunkCount, and paths. ' +
        'Call this before search_indexed when you need a sourceId/labels filter, or to check whether anything is indexed. ' +
        'For multi-version Odoo, each checkout should be a separate source with a label (e.g. 18c, 18e). ' +
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
          sources: sources.map(sourceMeta),
          total: sources.length,
          readyCount: sources.filter((s) => s.status === 'ready').length,
        }
      },
    },
    {
      name: 'get_search_context',
      description:
        'Show which indexed sources are active for this conversation (multi-version pin). ' +
        'Returns sourceIds, labels, reason, and whether a pin is required. ' +
        'Use before search_indexed / odoo_search_* when unsure which Odoo version is selected.',
      category: 'search',
      riskTier: 'green',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_input, ctx) => {
        const pin = resolvePin(ctx, {})
        return {
          sourceIds: pin.sourceIds,
          sources: pin.sources.map(sourceMeta),
          roots: pin.roots,
          reason: pin.reason,
          pinned: pin.pinned,
          needsPin: pin.needsPin,
          available: pin.available,
        }
      },
    },
    {
      name: 'set_search_context',
      description:
        'Pin indexed sources for this conversation (multi-version Odoo / multi-checkout). ' +
        'Pass sourceIds and/or labels (and optional version/edition). ' +
        'Pass clear:true to clear the pin (fall back to project defaults). ' +
        'After changing, subsequent search_indexed / odoo_search_* calls use the pin automatically.',
      category: 'search',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          sourceIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Search source IDs from list_search_sources',
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Source labels (e.g. "18c", "eyssen-erp")',
          },
          version: { type: 'string', description: 'Version filter (e.g. "18")' },
          edition: { type: 'string', description: 'Edition filter (e.g. "community")' },
          clear: {
            type: 'boolean',
            description: 'If true, clear conversation pin (null search_context)',
          },
        },
      },
      execute: async (input, ctx) => {
        if (!ctx?.conversationId) {
          return { error: 'No conversationId in tool context — cannot set search context' }
        }
        const updateFn = getService()?.updateConversationSearchContext as
          | ((id: string, spec: SearchContextSpec | null) => void)
          | undefined
        if (!updateFn) {
          return { error: 'Search context update not available (conversations/search not ready)' }
        }

        if (input.clear === true) {
          updateFn(ctx.conversationId, null)
          return { cleared: true, conversationId: ctx.conversationId }
        }

        const spec: SearchContextSpec = {}
        if (Array.isArray(input.sourceIds) && input.sourceIds.length) {
          spec.sourceIds = input.sourceIds as string[]
        }
        if (Array.isArray(input.labels) && input.labels.length) {
          spec.labels = input.labels as string[]
        }
        if (typeof input.version === 'string' && input.version) spec.version = input.version
        if (typeof input.edition === 'string' && input.edition) spec.edition = input.edition

        if (!spec.sourceIds?.length && !spec.labels?.length && !spec.version && !spec.edition) {
          return { error: 'Provide sourceIds, labels, version, and/or edition — or clear:true' }
        }

        updateFn(ctx.conversationId, spec)
        const pin = resolvePin(ctx, spec)
        return {
          saved: true,
          conversationId: ctx.conversationId,
          searchContext: spec,
          resolved: {
            sourceIds: pin.sourceIds,
            reason: pin.reason,
            sources: pin.sources.map(sourceMeta),
            needsPin: pin.needsPin,
          },
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
        'Multi-version: omit filters to use the conversation pin (get_search_context / set_search_context). ' +
        'Or pass sourceIds / labels / version / edition to override for this call. ' +
        'If needsPin and you have not pinned, the tool returns an error listing available labels. ' +
        'Each hit includes citationId — cite as [source:<citationId>] in answers.',
      category: 'search',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (supports natural language and keywords)' },
          sourceId: { type: 'string', description: 'Limit to a single source id (legacy; prefer sourceIds)' },
          sourceIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Limit to these source ids',
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Limit to sources with these labels (e.g. ["18c","eyssen-erp"])',
          },
          version: { type: 'string', description: 'Filter by source config.version' },
          edition: { type: 'string', description: 'Filter by source config.edition' },
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
      execute: async (input, ctx) => {
        const engine = getService()?.engine
        if (!engine) return { error: 'Search engine not initialized yet — try again shortly' }

        const explicit: ExplicitSearchFilter = {
          sourceId: input.sourceId as string | undefined,
          sourceIds: Array.isArray(input.sourceIds) ? (input.sourceIds as string[]) : undefined,
          labels: Array.isArray(input.labels) ? (input.labels as string[]) : undefined,
          version: input.version as string | undefined,
          edition: input.edition as string | undefined,
        }

        const pin = resolvePin(ctx, explicit)

        if (pin.needsPin && pin.sourceIds.length === 0) {
          return {
            error:
              'Multiple Odoo/versioned sources are indexed. Pin sources first with set_search_context ' +
              '(labels or sourceIds), or pass labels/sourceIds on this call.',
            needsPin: true,
            available: pin.available,
            reason: pin.reason,
          }
        }

        if (
          (explicit.sourceIds?.length ||
            explicit.sourceId ||
            explicit.labels?.length ||
            explicit.version ||
            explicit.edition) &&
          pin.sourceIds.length === 0
        ) {
          return {
            error: 'No ready sources matched the given filters.',
            available: pin.available,
            reason: pin.reason,
          }
        }

        const results = await engine.search({
          query: input.query as string,
          mode: (input.mode as 'hybrid' | 'fts' | 'vector' | undefined) ?? 'hybrid',
          filters: {
            sourceIds: pin.sourceIds.length ? pin.sourceIds : undefined,
            language: input.language as string | undefined,
          },
          limit: (input.limit as number) ?? 10,
        })

        return {
          context: {
            sourceIds: pin.sourceIds,
            reason: pin.reason,
            pinned: pin.pinned,
          },
          results: results.map((r: any) => {
            const citationId = r.chunk.id as string
            const filePath = r.chunk.metadata?.filePath as string | undefined
            const title = r.chunk.metadata?.title as string | undefined
            const rootLabel = r.chunk.metadata?.rootLabel as string | undefined
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
              rootLabel,
              title,
              metadata: r.chunk.metadata,
            }
          }),
        }
      },
    },
  ]
}
