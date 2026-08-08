// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { resolve, extname, sep } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import type { Hono } from 'hono'
import type { Logger } from 'pino'
import { sql } from 'drizzle-orm'
import { sha256 } from '@shared/crypto'
import { requirePermission } from '@modules/permissions/middleware'
import type { SearchContext, SearchSource } from './types.js'
import type { SearchProvider } from './providers/types.js'

// Maps file extension to language identifier
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', swift: 'swift',
  kt: 'kotlin', scala: 'scala', sh: 'shell', bash: 'shell',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  md: 'markdown', html: 'html', css: 'css', scss: 'scss',
  sql: 'sql', xml: 'xml', dockerfile: 'dockerfile',
}

function detectLanguage(filePath: string): string {
  const ext = extname(filePath).slice(1).toLowerCase()
  return EXTENSION_TO_LANGUAGE[ext] ?? ext ?? 'plaintext'
}

export function createSearchRoutes(
  app: Hono,
  search: SearchContext,
  provider: SearchProvider,
  db: any,
  logger: Logger,
) {
  // Search
  app.get('/api/v1/search', requirePermission('read', 'SearchSource'), async (c) => {
    const query = c.req.query('query')
    if (!query) return c.json({ error: 'query parameter required' }, 400)

    const mode = (c.req.query('mode') as any) ?? 'hybrid'
    const collections = c.req.query('collections')?.split(',').filter(Boolean)
    const limit = parseInt(c.req.query('limit') ?? '20', 10)
    const language = c.req.query('language')
    const sourceId = c.req.query('sourceId')

    const results = await search.engine.search({
      query, mode, collections, limit,
      filters: { language: language || undefined, sourceId: sourceId || undefined },
    })

    return c.json({ results, total: results.length })
  })

  // Sources CRUD
  app.get('/api/v1/search/sources', requirePermission('read', 'SearchSource'), (c) => {
    return c.json(search.sources.list())
  })

  app.post('/api/v1/search/sources', requirePermission('create', 'SearchSource'), async (c) => {
    const body = await c.req.json()
    if (!body.name || !body.type || !body.indexer) {
      return c.json({ error: 'name, type, and indexer are required' }, 400)
    }
    const source = search.sources.create({
      name: body.name,
      type: body.type,
      indexer: body.indexer,
      config: body.config ?? {},
    })
    return c.json(source, 201)
  })

  app.patch('/api/v1/search/sources/:id', requirePermission('update', 'SearchSource'), async (c) => {
    const id = c.req.param('id')
    const existing = search.sources.get(id)
    if (!existing) return c.json({ error: 'Source not found' }, 404)

    const body = await c.req.json()
    search.sources.update(id, body)
    return c.json(search.sources.get(id))
  })

  app.delete('/api/v1/search/sources/:id', requirePermission('delete', 'SearchSource'), async (c) => {
    const id = c.req.param('id')
    const existing = search.sources.get(id)
    if (!existing) return c.json({ error: 'Source not found' }, 404)

    await provider.removeBySource(id)
    db.run(sql`DELETE FROM search_chunks WHERE source_id = ${id}`)
    search.sources.delete(id)
    return c.body(null, 204)
  })

  // Indexing
  app.post('/api/v1/search/sources/:id/index', requirePermission('update', 'SearchSource'), async (c) => {
    const id = c.req.param('id')
    const source = search.sources.get(id)
    if (!source) return c.json({ error: 'Source not found' }, 404)

    const indexer = search.registry.get(source.indexer)
    if (!indexer) return c.json({ error: `Indexer "${source.indexer}" not registered` }, 400)

    search.sources.setStatus(id, 'indexing')
    // Run in a separate microtask to not block the response
    setTimeout(() => indexAsync(id, source, indexer, search, provider, db, logger), 50)

    return c.json({ status: 'indexing' }, 202)
  })

  app.get('/api/v1/search/sources/:id/status', requirePermission('read', 'SearchSource'), (c) => {
    const id = c.req.param('id')
    const source = search.sources.get(id)
    if (!source) return c.json({ error: 'Source not found' }, 404)

    return c.json({
      status: source.status,
      chunkCount: source.chunkCount,
      errorMessage: source.errorMessage,
      lastIndexedAt: source.lastIndexedAt,
    })
  })

  // File content viewer — security-restricted to indexed source paths
  app.get('/api/v1/search/file-content', requirePermission('read', 'SearchSource'), async (c) => {
    const rawPath = c.req.query('path')
    if (!rawPath) return c.json({ error: 'path parameter required' }, 400)

    // Collect all configured source root paths
    const allSourcePaths = search.sources.list().flatMap((s) => {
      const paths = (s.config.paths ?? []) as string[]
      return paths.map((p) => resolve(p))
    })

    // Resolve path: if absolute use directly, if relative try joining with each source root
    const isAbsolute = rawPath.startsWith('/')
    let absolutePath: string | null = null

    if (isAbsolute) {
      absolutePath = resolve(rawPath)
    } else {
      // Relative path from indexer — find which source root contains it
      for (const sourcePath of allSourcePaths) {
        const candidate = resolve(sourcePath, rawPath)
        try {
          await stat(candidate)
          absolutePath = candidate
          break
        } catch {
          // try next source path
        }
      }
    }

    if (!absolutePath) {
      return c.json({ error: 'File not found' }, 404)
    }

    // Security check: must be within an indexed source path. Compare against a
    // path-separator boundary so a sibling dir sharing a name prefix (e.g.
    // /data/proj-secret vs indexed /data/proj) cannot pass the gate.
    const allowed = allSourcePaths.some(
      (sourcePath) => absolutePath === sourcePath || absolutePath!.startsWith(sourcePath + sep),
    )
    if (!allowed) {
      return c.json({ error: 'Access denied: path is outside indexed sources' }, 403)
    }

    try {
      await stat(absolutePath)
    } catch {
      return c.json({ error: 'File not found' }, 404)
    }

    const content = await readFile(absolutePath, 'utf-8')
    const totalLines = content.split('\n').length
    const language = detectLanguage(absolutePath)

    return c.json({ content, path: absolutePath, language, totalLines })
  })

  // Stats
  app.get('/api/v1/search/stats', requirePermission('read', 'SearchSource'), (c) => {
    const sources = search.sources.list()
    const totalChunks = sources.reduce((sum, s) => sum + s.chunkCount, 0)
    const collections = provider.getCollections()

    return c.json({
      sourceCount: sources.length,
      totalChunks,
      collections,
      indexerCount: search.registry.list().length,
      registeredIndexers: search.registry.list(),
    })
  })
}

async function indexAsync(
  sourceId: string,
  source: SearchSource,
  indexer: any,
  search: SearchContext,
  provider: SearchProvider,
  db: any,
  logger: Logger,
) {
  try {
    const chunks = await indexer.index(source)

    await provider.removeBySource(sourceId)
    search.vectorIndex?.removeBySource(sourceId)
    db.run(sql`DELETE FROM search_chunks WHERE source_id = ${sourceId}`)

    // F3 — embed on index when a bridge is available (best-effort; FTS still works).
    let embeddings: Float32Array[] | null = null
    const bridge = search.embeddingBridge
    if (bridge && chunks.length > 0) {
      try {
        embeddings = await bridge.embed(chunks.map((c: { content: string }) => c.content))
      } catch (err) {
        logger.warn({ err: String(err) }, 'Search: embedding batch failed — storing FTS-only')
        embeddings = null
      }
    }

    const { embeddingToBuffer } = await import('./vector-index.js')
    const now = new Date().toISOString()
    const model = bridge?.model ?? null
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const contentHash = await sha256(chunk.content)
      const emb = embeddings?.[i] ?? null
      if (emb && search.vectorIndex) {
        search.vectorIndex.upsert(chunk, emb)
        const blob = embeddingToBuffer(emb)
        db.run(sql`INSERT INTO search_chunks (id, source_id, collection, content, metadata, content_hash, embedding, embedding_model, created_at) VALUES (${chunk.id}, ${sourceId}, ${chunk.collection}, ${chunk.content}, ${JSON.stringify(chunk.metadata)}, ${contentHash}, ${blob}, ${model}, ${now})`)
      } else {
        db.run(sql`INSERT INTO search_chunks (id, source_id, collection, content, metadata, content_hash, created_at) VALUES (${chunk.id}, ${sourceId}, ${chunk.collection}, ${chunk.content}, ${JSON.stringify(chunk.metadata)}, ${contentHash}, ${now})`)
      }
    }

    if (chunks.length > 0) {
      await provider.addDocuments(source.type, chunks)
    }

    search.sources.setIndexed(sourceId, chunks.length)
    logger.info(
      'Indexed source "%s": %d chunks (%d embedded)',
      source.name,
      chunks.length,
      embeddings?.length ?? 0,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    search.sources.setStatus(sourceId, 'error', msg)
    logger.error('Failed to index source "%s": %s', source.name, msg)
  }
}
