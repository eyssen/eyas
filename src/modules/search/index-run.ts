// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import { sql } from 'drizzle-orm'
import { sha256 } from '@shared/crypto'
import type { Chunk, ContentIndexer, FileToIndex, SearchContext, SearchSource } from './types.js'
import type { SearchProvider } from './providers/types.js'
import { embeddingToBuffer, bufferToEmbedding } from './vector-index.js'

const FILE_BATCH = 40
const LEGACY_CHUNK_BATCH = 200

function yieldLoop(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export interface IndexRunDeps {
  sourceId: string
  source: SearchSource
  indexer: ContentIndexer
  search: SearchContext
  provider: SearchProvider
  db: any
  logger: Logger
}

let queue: Promise<void> = Promise.resolve()
const inflight = new Set<string>()

export function isIndexInFlight(sourceId: string): boolean {
  return inflight.has(sourceId)
}

/** Serialize index jobs so two Odoo trees do not contend for RAM/CPU. */
export function enqueueIndexJob(sourceId: string, job: () => Promise<void>): boolean {
  if (inflight.has(sourceId)) return false
  inflight.add(sourceId)
  queue = queue
    .then(() => job())
    .catch(() => { /* job logs its own errors */ })
    .finally(() => { inflight.delete(sourceId) })
  return true
}

async function countChunks(db: any, sourceId: string): Promise<number> {
  const rows = db.all(sql`SELECT COUNT(*) AS n FROM search_chunks WHERE source_id = ${sourceId}`) as Array<{ n: number }>
  return Number(rows[0]?.n ?? 0)
}

async function loadHashesForFiles(
  db: any,
  sourceId: string,
  filePaths: string[],
): Promise<Map<string, { embedding: Buffer; model: string | null }>> {
  const out = new Map<string, { embedding: Buffer; model: string | null }>()
  for (const fp of filePaths) {
    const rows = db.all(
      sql`SELECT content_hash, embedding, embedding_model FROM search_chunks WHERE source_id = ${sourceId} AND json_extract(metadata, '$.filePath') = ${fp}`,
    ) as any[]
    for (const row of rows) {
      if (row.content_hash && row.embedding) {
        out.set(row.content_hash, {
          embedding: Buffer.isBuffer(row.embedding) ? row.embedding : Buffer.from(row.embedding),
          model: row.embedding_model ?? null,
        })
      }
    }
  }
  return out
}

async function deleteChunksForFiles(
  deps: IndexRunDeps,
  filePaths: string[],
): Promise<void> {
  const { db, sourceId, provider, search } = deps
  const ids: string[] = []
  for (const fp of filePaths) {
    const rows = db.all(
      sql`SELECT id FROM search_chunks WHERE source_id = ${sourceId} AND json_extract(metadata, '$.filePath') = ${fp}`,
    ) as Array<{ id: string }>
    for (const row of rows) ids.push(row.id)
    db.run(sql`DELETE FROM search_chunks WHERE source_id = ${sourceId} AND json_extract(metadata, '$.filePath') = ${fp}`)
  }
  if (ids.length === 0) return
  if (provider.removeByIds) await provider.removeByIds(ids)
  search.vectorIndex?.removeByIds(ids)
}

async function persistChunkBatch(
  deps: IndexRunDeps,
  chunks: Chunk[],
  replacePaths?: string[],
): Promise<void> {
  const { db, search, provider, logger, source } = deps
  const bridge = search.embeddingBridge
  const model = bridge?.model ?? null
  const now = new Date().toISOString()

  const filePaths = replacePaths
    ?? [...new Set(chunks.map((c) => String(c.metadata?.filePath ?? '')).filter(Boolean))]
  const hashToEmbedding = filePaths.length > 0
    ? await loadHashesForFiles(db, deps.sourceId, filePaths)
    : new Map<string, { embedding: Buffer; model: string | null }>()
  if (filePaths.length > 0) await deleteChunksForFiles(deps, filePaths)

  if (chunks.length === 0) return

  const needEmbed: { index: number; content: string }[] = []
  const embeddingByIndex = new Map<number, Float32Array>()
  const hashes: string[] = []

  for (let i = 0; i < chunks.length; i++) {
    const contentHash = await sha256(chunks[i].content)
    hashes.push(contentHash)
    const reused = hashToEmbedding.get(contentHash)
    if (reused) {
      try {
        embeddingByIndex.set(i, bufferToEmbedding(reused.embedding))
      } catch {
        needEmbed.push({ index: i, content: chunks[i].content })
      }
    } else if (bridge) {
      needEmbed.push({ index: i, content: chunks[i].content })
    }
  }

  if (bridge && needEmbed.length > 0) {
    try {
      const embeds = await bridge.embed(needEmbed.map((n) => n.content))
      if (embeds) {
        for (let j = 0; j < needEmbed.length; j++) {
          if (embeds[j]) embeddingByIndex.set(needEmbed[j].index, embeds[j])
        }
      }
    } catch (err) {
      logger.warn({ err: String(err) }, 'Search: embedding batch failed — storing FTS-only')
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const contentHash = hashes[i]
    const emb = embeddingByIndex.get(i) ?? null
    if (emb && search.vectorIndex) {
      search.vectorIndex.upsert(chunk, emb)
      const blob = embeddingToBuffer(emb)
      db.run(sql`INSERT INTO search_chunks (id, source_id, collection, content, metadata, content_hash, embedding, embedding_model, created_at) VALUES (${chunk.id}, ${chunk.sourceId}, ${chunk.collection}, ${chunk.content}, ${JSON.stringify(chunk.metadata)}, ${contentHash}, ${blob}, ${model}, ${now})`)
    } else {
      db.run(sql`INSERT INTO search_chunks (id, source_id, collection, content, metadata, content_hash, created_at) VALUES (${chunk.id}, ${chunk.sourceId}, ${chunk.collection}, ${chunk.content}, ${JSON.stringify(chunk.metadata)}, ${contentHash}, ${now})`)
    }
  }

  await provider.addDocuments(source.type, chunks)
}

async function runIncremental(deps: IndexRunDeps): Promise<void> {
  const { source, indexer, search, logger, sourceId } = deps
  const files = await indexer.collectFiles!(source)
  const states = new Map(search.sources.listFileStates(sourceId).map((s) => [s.filePath, s]))

  const toProcess: FileToIndex[] = []
  let skipped = 0
  let keptChunks = 0
  for (const file of files) {
    const prev = states.get(file.relPath)
    if (prev && prev.mtime === file.mtime) {
      skipped++
      keptChunks += prev.chunkCount
      continue
    }
    toProcess.push(file)
  }

  search.sources.setProgress(sourceId, keptChunks)
  logger.info(
    { source: source.name, files: files.length, toProcess: toProcess.length, skipped },
    'Search: incremental index start',
  )

  let processed = 0
  for (let i = 0; i < toProcess.length; i += FILE_BATCH) {
    const batch = toProcess.slice(i, i + FILE_BATCH)
    const chunks: Chunk[] = []
    for (const file of batch) {
      chunks.push(...await indexer.indexFile!(source, file))
      processed++
      if (processed % 5 === 0) await yieldLoop(1)
    }
    await persistChunkBatch(deps, chunks, batch.map((f) => f.relPath))

    const byFile = new Map<string, { mtime: string; n: number }>()
    for (const c of chunks) {
      const fp = String(c.metadata.filePath ?? '')
      if (!fp) continue
      const cur = byFile.get(fp) ?? { mtime: String(c.metadata.mtime ?? ''), n: 0 }
      cur.n += 1
      byFile.set(fp, cur)
    }
    for (const file of batch) {
      const info = byFile.get(file.relPath)
      search.sources.setFileState(sourceId, file.relPath, file.mtime, info?.n ?? 0)
    }

    const total = await countChunks(deps.db, sourceId)
    search.sources.setProgress(sourceId, total)
    if (processed % 200 === 0 || i + FILE_BATCH >= toProcess.length) {
      logger.info(
        { source: source.name, processed, of: toProcess.length, chunks: total, skipped },
        'Search: indexing progress',
      )
    }
    await yieldLoop(2)
  }

  const removed = search.sources.removeDeletedFileStates(
    sourceId,
    files.map((f) => f.relPath),
  )
  if (removed.length > 0) {
    await deleteChunksForFiles(deps, removed)
  }

  const total = await countChunks(deps.db, sourceId)
  search.sources.setIndexed(sourceId, total)
  logger.info(
    'Indexed source "%s": %d chunks (%d files, %d skipped unchanged)',
    source.name,
    total,
    files.length,
    skipped,
  )
}

async function runLegacy(deps: IndexRunDeps): Promise<void> {
  const { source, indexer, search, logger, sourceId, provider, db } = deps
  const chunks = await indexer.index(source) as Chunk[]

  await provider.removeBySource(sourceId)
  search.vectorIndex?.removeBySource(sourceId)
  db.run(sql`DELETE FROM search_chunks WHERE source_id = ${sourceId}`)
  search.sources.removeFileStates(sourceId)

  for (let i = 0; i < chunks.length; i += LEGACY_CHUNK_BATCH) {
    await persistChunkBatch(deps, chunks.slice(i, i + LEGACY_CHUNK_BATCH))
    search.sources.setProgress(sourceId, Math.min(i + LEGACY_CHUNK_BATCH, chunks.length))
    await yieldLoop(2)
  }

  const byFile = new Map<string, { mtime: string; n: number }>()
  for (const c of chunks) {
    const fp = String(c.metadata.filePath ?? '')
    if (!fp) continue
    const cur = byFile.get(fp) ?? { mtime: String(c.metadata.mtime ?? ''), n: 0 }
    cur.n += 1
    byFile.set(fp, cur)
  }
  for (const [fp, info] of byFile) {
    search.sources.setFileState(sourceId, fp, info.mtime, info.n)
  }

  const total = await countChunks(db, sourceId)
  search.sources.setIndexed(sourceId, total)
  logger.info('Indexed source "%s": %d chunks', source.name, total)
}

export async function runIndexJob(deps: IndexRunDeps): Promise<void> {
  const { source, indexer, search, logger, sourceId } = deps
  try {
    if (indexer.collectFiles && indexer.indexFile) {
      await runIncremental(deps)
    } else {
      await runLegacy(deps)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    search.sources.setStatus(sourceId, 'error', msg)
    logger.error('Failed to index source "%s": %s', source.name, msg)
  }
}
