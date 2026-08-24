// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createSourceService } from './source-service.js'
import { createIndexerRegistry } from './registry.js'
import { createOramaProvider } from './providers/orama/orama-provider.js'
import { createSearchEngine } from './engine.js'
import { createCodeIndexer } from './indexers/code/code-indexer.js'
import { createDocIndexer } from './indexers/docs/doc-indexer.js'
import { createFileIndexer } from './indexers/files/file-indexer.js'
import { createEmbeddingBridge } from './embedding-bridge.js'
import { createVectorIndex, bufferToEmbedding } from './vector-index.js'
import { indexConversations } from './indexers/conversations/conversation-indexer.js'

export const searchModule: EyasModule = {
  id: 'search',
  name: 'Search',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Development context indexer — code, docs, files with hybrid FTS+vector search',
  dependencies: [],
  optional: ['model'],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS search_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, indexer TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'idle', chunk_count INTEGER NOT NULL DEFAULT 0, error_message TEXT, last_indexed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)

    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS search_chunks (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, collection TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', content_hash TEXT NOT NULL, embedding BLOB, embedding_model TEXT, created_at TEXT NOT NULL)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_chunks_source ON search_chunks(source_id)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_chunks_collection ON search_chunks(collection)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_chunks_hash ON search_chunks(content_hash)`)

    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS search_file_state (source_id TEXT NOT NULL, file_path TEXT NOT NULL, mtime TEXT NOT NULL, chunk_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (source_id, file_path))`)

    const sourceService = createSourceService(ctx.db)
    const registry = createIndexerRegistry()

    ;(ctx as any).search = { sources: sourceService, registry, engine: null }
    ctx.logger.info('Search module registered')
  },

  async onStart(ctx: ModuleContext) {
    const searchCtx = (ctx as any).search

    // Reset sources stuck in 'indexing' from a previous crash/restart
    const stuckSources = searchCtx.sources.list().filter((s: any) => s.status === 'indexing')
    for (const source of stuckSources) {
      const status = source.chunkCount > 0 ? 'ready' : 'idle'
      searchCtx.sources.setStatus(source.id, status)
      ctx.logger.warn('Reset stuck source "%s" from indexing → %s', source.name, status)
    }

    const provider = await createOramaProvider()
    const vectorIndex = createVectorIndex()
    searchCtx.vectorIndex = vectorIndex

    // Initialize embedding provider first so the engine can use hybrid mode.
    let embeddingProvider = null
    try {
      const ollamaRes = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) })
      if (ollamaRes.ok) {
        const { createOllamaEmbeddingProvider } = await import('./providers/ollama-embedding.js')
        embeddingProvider = createOllamaEmbeddingProvider()
        ctx.logger.info('Ollama embedding provider initialized (%s)', embeddingProvider.model)
      }
    } catch { /* Ollama not available */ }

    if (!embeddingProvider) {
      const apiKey = await (ctx as any).secrets?.get?.('openai-api-key').catch(() => null) ?? null
      if (apiKey) {
        const { createOpenAIEmbeddingProvider } = await import('./providers/openai-embedding.js')
        embeddingProvider = createOpenAIEmbeddingProvider({ apiKey })
        ctx.logger.info('OpenAI embedding provider initialized')
      }
    }

    if (embeddingProvider) {
      searchCtx.embeddingBridge = createEmbeddingBridge(embeddingProvider)
    } else {
      searchCtx.embeddingBridge = null
      ctx.logger.info('No embedding provider available — vector search disabled (FTS-only hybrid)')
    }

    const engine = createSearchEngine(provider, {
      embeddingBridge: searchCtx.embeddingBridge,
      vectorIndex,
    })
    searchCtx.engine = engine

    // Multi-version pin resolver (conversation / project → source ids)
    const { createSearchContextResolver } = await import('./resolve-context.js')
    searchCtx.resolveContext = createSearchContextResolver({
      listSources: () => searchCtx.sources.list(),
      getConversation: (id) => {
        const conv = (ctx as any).conversations?.get?.(id)
        if (!conv) return null
        return {
          searchContext: conv.searchContext ?? null,
          projectId: conv.projectId ?? null,
        }
      },
      getProject: (id) => {
        const p = (ctx as any).board?.projects?.get?.(id)
        if (!p) return null
        return {
          indexedSources: p.indexedSources ?? null,
          typeId: p.typeId ?? null,
        }
      },
      getProjectType: (id) => {
        const pt = (ctx as any).board?.projectTypes?.get?.(id)
        if (!pt) return null
        return { indexedSources: pt.indexedSources ?? null }
      },
    })
    searchCtx.updateConversationSearchContext = (
      conversationId: string,
      spec: import('./types.js').SearchContextSpec | null,
    ) => {
      const conversations = (ctx as any).conversations
      if (!conversations?.update) {
        throw new Error('Conversations service not available')
      }
      conversations.update(conversationId, { searchContext: spec })
    }

    // Register built-in indexers
    searchCtx.registry.register('code', createCodeIndexer())
    searchCtx.registry.register('docs', createDocIndexer())
    searchCtx.registry.register('files', createFileIndexer())

    // Bootstrap named Odoo sources from EYAS_ODOO_SOURCES_JSON (idle; operator reindexes)
    try {
      await ensureOdooSourcesFromEnv(searchCtx.sources, ctx.logger)
    } catch (err) {
      ctx.logger.warn('Odoo source bootstrap skipped: %s', err)
    }

    // Load persisted chunks into Orama + vector index on startup
    const sources = searchCtx.sources.list()
    for (const source of sources) {
      if (source.status !== 'ready') continue
      try {
        const rows = (ctx.db as any).all(sql`SELECT * FROM search_chunks WHERE source_id = ${source.id}`) as any[]
        const chunks = rows.map((r: any) => ({
          id: r.id,
          sourceId: r.source_id,
          collection: r.collection,
          content: r.content,
          metadata: JSON.parse(r.metadata || '{}'),
        }))
        if (chunks.length > 0) {
          await provider.addDocuments(source.type, chunks)
          let loadedVec = 0
          for (const r of rows) {
            if (!r.embedding) continue
            try {
              const emb = bufferToEmbedding(
                Buffer.isBuffer(r.embedding) ? r.embedding : Buffer.from(r.embedding),
              )
              const chunk = chunks.find((c: any) => c.id === r.id)
              if (chunk) {
                vectorIndex.upsert(chunk, emb)
                loadedVec++
              }
            } catch { /* corrupt blob — skip */ }
          }
          ctx.logger.info(
            'Loaded %d chunks (%d with embeddings) for source "%s"',
            chunks.length,
            loadedVec,
            source.name,
          )
        }
      } catch (err) {
        ctx.logger.warn('Failed to load chunks for source "%s": %s', source.name, err)
      }
    }

    // Set up routes
    const { createSearchRoutes } = await import('./routes.js')
    createSearchRoutes(ctx.http, searchCtx, provider, ctx.db, ctx.logger)

    // Index conversations for ⌘K search
    try {
      const convChunks = indexConversations(ctx.db)
      if (convChunks.length > 0) {
        await provider.addDocuments('conversations', convChunks)
        ctx.logger.info('Indexed %d conversations for search', convChunks.length)
      }
    } catch (err) {
      ctx.logger.warn('Failed to index conversations: %s', err)
    }

    // Re-index conversations on updates
    ctx.bus.on('record:updated', async (event: any) => {
      if (event.resModel !== 'conversation') return
      try {
        const convChunks = indexConversations(ctx.db)
        await provider.removeBySource('__conversations__')
        if (convChunks.length > 0) {
          await provider.addDocuments('conversations', convChunks)
        }
      } catch { /* best-effort */ }
    })

    ctx.logger.info('Search module started (%d built-in indexers)', searchCtx.registry.list().length)
  },

  async onStop() {},
}

/**
 * Upsert idle search sources from EYAS_ODOO_SOURCES_JSON without reindexing.
 * Shape: [{ path, label?, version?, edition?, family?, name? }, ...]
 * Flat EYAS_ODOO_SOURCE_PATHS also creates unlabeled sources if none exist yet.
 */
async function ensureOdooSourcesFromEnv(
  sources: import('./types.js').SourceService,
  logger: { info: (...a: any[]) => void; warn: (...a: any[]) => void },
): Promise<void> {
  const existing = sources.list()
  const pathSet = new Set(
    existing.flatMap((s) => (Array.isArray(s.config.paths) ? (s.config.paths as string[]) : [])),
  )

  type Entry = {
    path: string
    label?: string
    version?: string
    edition?: string
    family?: string
    name?: string
    tags?: string[]
  }
  const entries: Entry[] = []

  const json = process.env.EYAS_ODOO_SOURCES_JSON
  if (json) {
    try {
      const parsed = JSON.parse(json) as Entry[]
      if (Array.isArray(parsed)) {
        for (const e of parsed) {
          if (e?.path) entries.push(e)
        }
      }
    } catch {
      logger.warn('EYAS_ODOO_SOURCES_JSON is not valid JSON — skipped')
    }
  }

  // Only use flat paths when JSON empty AND no odoo-family sources yet
  if (entries.length === 0) {
    const hasOdoo = existing.some(
      (s) => s.config.family === 'odoo' || s.config.label || s.config.version,
    )
    const flat = process.env.EYAS_ODOO_SOURCE_PATHS
    if (!hasOdoo && flat) {
      for (const p of flat.split(/[:;]/).map((s) => s.trim()).filter(Boolean)) {
        entries.push({ path: p, family: 'odoo' })
      }
    }
  }

  let created = 0
  for (const e of entries) {
    if (pathSet.has(e.path)) continue
    const basename = e.path.replace(/\/+$/, '').split('/').pop() ?? e.path
    const name = e.name ?? e.label ?? basename
    sources.create({
      name,
      type: 'code',
      indexer: 'code',
      config: {
        paths: [e.path],
        label: e.label,
        version: e.version,
        edition: e.edition,
        family: e.family ?? 'odoo',
        tags: e.tags ?? ['odoo'],
        exclude: ['i18n', 'static', '__pycache__', 'node_modules', '.git'],
      },
    })
    pathSet.add(e.path)
    created++
  }
  if (created > 0) {
    logger.info(
      'Bootstrapped %d Odoo search source(s) from env (status=idle — reindex in Search Sources UI)',
      created,
    )
  }
}
