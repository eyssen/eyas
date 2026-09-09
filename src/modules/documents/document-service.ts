// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import { lookup as mimeLookup } from 'mime-types'
import { generateId } from '@shared/crypto.js'
import type { EyasDb } from '@core/types.js'
import type {
  DocumentLink,
  DocumentRecord,
  DocumentSource,
  FileMeta,
  StorageProvider,
  UploadInput,
  UploadLimits,
} from './types.js'

// ─── Defaults ─────────────────────────────────────────

const DEFAULT_LIMITS: UploadLimits = {
  maxFileSizeMb: 50,
  allowedTypes: ['*/*'],
}

// ─── Helpers ──────────────────────────────────────────

function computeSha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Glob-style MIME matching: `*\/*`, `image/*`, `application/pdf` */
function mimeMatchesPattern(mime: string, pattern: string): boolean {
  if (pattern === '*/*') return true
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, pattern.length - 2)
    return mime.startsWith(prefix + '/')
  }
  return mime === pattern
}

function mimeMatchesAllowedTypes(mime: string, allowedTypes: string[]): boolean {
  return allowedTypes.some((pattern) => mimeMatchesPattern(mime, pattern))
}

function getLinksForDocument(db: EyasDb, documentId: string): DocumentLink[] {
  const rows = db.all(sql`SELECT * FROM document_links WHERE document_id = ${documentId}`) as any[]
  return rows.map((r: any) => ({
    id: r.id,
    documentId: r.document_id,
    ownerModule: r.owner_module,
    ownerId: r.owner_id,
    source: r.source ?? 'user',
    createdAt: r.created_at,
  }))
}

function rowToDocument(db: EyasDb, r: any): DocumentRecord {
  return {
    id: r.id,
    links: getLinksForDocument(db, r.id),
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    checksumSha256: r.checksum_sha256,
    storageKey: r.storage_key,
    localPath: r.local_path ?? null,
    remoteProvider: r.remote_provider ?? null,
    remoteStatus: r.remote_status as DocumentRecord['remoteStatus'],
    thumbnailKey: r.thumbnail_key ?? null,
    retainLocalUntil: r.retain_local_until ?? null,
    metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata ?? {}),
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  }
}

// Use db.all()[0] because db.get() does not support multiple bound params in Drizzle bun-sqlite
function queryOne(db: EyasDb, query: any): any | undefined {
  const rows = (db.all(query) as any[])
  return rows.length > 0 ? rows[0] : undefined
}

// ─── Stats ───────────────────────────────────────────

export interface DocumentStats {
  totalFiles: number
  totalSizeBytes: number
  localFiles: number
  localSizeBytes: number
  syncStatus: {
    synced: number
    pending: number
    error: number
    not_configured: number
  }
  topMimeTypes: Array<{
    mimeType: string
    count: number
    totalSize: number
  }>
}

// ─── Service ──────────────────────────────────────────

export interface ListFilters {
  mimeType?: string
  includeDeleted?: boolean
  limit?: number
  offset?: number
}

export interface DocumentService {
  upload(input: UploadInput): Promise<DocumentRecord>
  getById(id: string): DocumentRecord | null
  listByOwner(ownerModule: string, ownerId: string): DocumentRecord[]
  listAll(filters?: ListFilters): DocumentRecord[]
  softDelete(id: string): Promise<void>
  link(documentId: string, ownerModule: string, ownerId: string, source?: DocumentSource): DocumentLink
  unlink(documentId: string, ownerModule: string, ownerId: string): void
  getLinks(documentId: string): DocumentLink[]
  getStats(): DocumentStats
  download(id: string): Promise<{ data: ReadableStream; meta: FileMeta } | null>
}

export function createDocumentService(
  db: EyasDb,
  primary: StorageProvider,
  secondary?: StorageProvider,
  limits?: Partial<UploadLimits>,
  _moduleOverrides?: Record<string, Partial<UploadLimits>>,
): DocumentService {
  const effectiveLimits: UploadLimits = {
    maxFileSizeMb: limits?.maxFileSizeMb ?? DEFAULT_LIMITS.maxFileSizeMb,
    allowedTypes: limits?.allowedTypes ?? DEFAULT_LIMITS.allowedTypes,
  }

  return {
    async upload(input: UploadInput): Promise<DocumentRecord> {
      const { file, filename, metadata, createdBy } = input
      const limits =
        input.module && _moduleOverrides?.[input.module]
          ? { ...effectiveLimits, ..._moduleOverrides[input.module] }
          : effectiveLimits

      // 1. Validate file size
      const maxBytes = limits.maxFileSizeMb * 1024 * 1024
      if (file.length > maxBytes) {
        throw new Error(
          `File size ${file.length} bytes exceeds the size limit of ${limits.maxFileSizeMb}MB (${maxBytes} bytes).`,
        )
      }

      // 2. Detect MIME type — magic number first, fallback to extension
      const detected = await fileTypeFromBuffer(file)
      let mimeType = detected?.mime ?? null
      if (!mimeType) {
        const ext = extname(filename).toLowerCase()
        const lookedUp = ext ? mimeLookup(ext) : false
        mimeType = lookedUp || 'application/octet-stream'
      }

      // 3. Validate against allowed types
      if (!mimeMatchesAllowedTypes(mimeType, limits.allowedTypes)) {
        throw new Error(
          `MIME type "${mimeType}" is not allowed. Allowed types: ${limits.allowedTypes.join(', ')}`,
        )
      }

      // 4. Generate ID and storage key
      const id = generateId()
      const ext = detected?.ext ? `.${detected.ext}` : extname(filename)
      const storageKey = `${id}${ext}`

      // 5. Compute SHA-256 checksum
      const checksumSha256 = computeSha256(file)

      // 6. Write to primary provider
      const meta: FileMeta = { filename, mimeType, sizeBytes: file.length }
      await primary.put(storageKey, file, meta)

      // 7. Insert DB record (no owner_module/owner_id — use document_links instead)
      const remoteStatus: DocumentRecord['remoteStatus'] = secondary ? 'pending' : 'not_configured'
      const now = new Date().toISOString()
      const metaJson = JSON.stringify(metadata ?? {})

      db.run(sql`
        INSERT INTO documents (
          id, owner_module, owner_id, filename, mime_type, size_bytes,
          checksum_sha256, storage_key, local_path, remote_provider,
          remote_status, thumbnail_key, retain_local_until, metadata,
          created_by, created_at, updated_at, deleted_at
        ) VALUES (
          ${id}, ${null}, ${null},
          ${filename}, ${mimeType}, ${file.length},
          ${checksumSha256}, ${storageKey}, ${storageKey},
          ${secondary?.id ?? null}, ${remoteStatus},
          ${null}, ${null}, ${metaJson},
          ${createdBy ?? null}, ${now}, ${now}, ${null}
        )
      `)

      // 8. Return the document record
      const row = queryOne(db, sql`SELECT * FROM documents WHERE id = ${id}`)
      return rowToDocument(db, row)
    },

    getById(id: string): DocumentRecord | null {
      const row = queryOne(db, sql`SELECT * FROM documents WHERE id = ${id} AND deleted_at IS NULL`)
      if (!row) return null
      return rowToDocument(db, row)
    },

    listByOwner(ownerModule: string, ownerId: string): DocumentRecord[] {
      const rows = db.all(
        sql`SELECT d.* FROM documents d
            JOIN document_links dl ON d.id = dl.document_id
            WHERE dl.owner_module = ${ownerModule} AND dl.owner_id = ${ownerId}
            AND d.deleted_at IS NULL
            ORDER BY d.created_at DESC`,
      ) as any[]
      return rows.map((r: any) => rowToDocument(db, r))
    },

    listAll(filters?: ListFilters): DocumentRecord[] {
      const conditions: string[] = []
      const params: any[] = []

      if (!filters?.includeDeleted) {
        conditions.push('deleted_at IS NULL')
      }

      if (filters?.mimeType) {
        conditions.push('mime_type = ?')
        params.push(filters.mimeType)
      }

      const limit = filters?.limit ?? 500
      const offset = filters?.offset ?? 0

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      // `prepare()` is the raw sqlite API, not part of the Drizzle wrapper.
      // The documents module historically mixed both; cast to any here until
      // the module is migrated to pure Drizzle (tracked as tech debt).
      const stmt = (db as any).prepare(`SELECT * FROM documents ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      const rows = stmt.all(...params, limit, offset) as any[]
      return rows.map((r: any) => rowToDocument(db, r))
    },

    async softDelete(id: string): Promise<void> {
      const row = queryOne(db, sql`SELECT * FROM documents WHERE id = ${id} AND deleted_at IS NULL`)
      if (!row) return

      const doc = rowToDocument(db, row)
      const now = new Date().toISOString()

      db.run(sql`UPDATE documents SET deleted_at = ${now}, updated_at = ${now} WHERE id = ${id}`)

      // Delete from primary
      await primary.delete(doc.storageKey).catch(() => {})

      // Delete from secondary if synced
      if (secondary && doc.remoteStatus === 'synced') {
        await secondary.delete(doc.storageKey).catch(() => {})
      }
    },

    link(documentId: string, ownerModule: string, ownerId: string, source: DocumentSource = 'user'): DocumentLink {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO document_links (id, document_id, owner_module, owner_id, source, created_at)
                 VALUES (${id}, ${documentId}, ${ownerModule}, ${ownerId}, ${source}, ${now})`)
      return { id, documentId, ownerModule, ownerId, source, createdAt: now }
    },

    unlink(documentId: string, ownerModule: string, ownerId: string): void {
      db.run(sql`DELETE FROM document_links
                 WHERE document_id = ${documentId} AND owner_module = ${ownerModule} AND owner_id = ${ownerId}`)
    },

    getLinks(documentId: string): DocumentLink[] {
      return getLinksForDocument(db, documentId)
    },

    getStats(): DocumentStats {
      const totals = queryOne(db, sql`SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total_size FROM documents WHERE deleted_at IS NULL`)
      const localTotals = queryOne(db, sql`SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total_size FROM documents WHERE deleted_at IS NULL AND local_path IS NOT NULL`)

      const syncRows = db.all(sql`SELECT remote_status, COUNT(*) as count FROM documents WHERE deleted_at IS NULL GROUP BY remote_status`) as any[]
      const syncStatus = { synced: 0, pending: 0, error: 0, not_configured: 0 }
      for (const row of syncRows) {
        const status = row.remote_status as keyof typeof syncStatus
        if (status in syncStatus) {
          syncStatus[status] = row.count
        }
      }

      const mimeRows = db.all(sql`SELECT mime_type, COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total_size FROM documents WHERE deleted_at IS NULL GROUP BY mime_type ORDER BY count DESC LIMIT 10`) as any[]
      const topMimeTypes = mimeRows.map((r: any) => ({
        mimeType: r.mime_type,
        count: r.count,
        totalSize: r.total_size,
      }))

      return {
        totalFiles: totals?.count ?? 0,
        totalSizeBytes: totals?.total_size ?? 0,
        localFiles: localTotals?.count ?? 0,
        localSizeBytes: localTotals?.total_size ?? 0,
        syncStatus,
        topMimeTypes,
      }
    },

    async download(id: string): Promise<{ data: ReadableStream; meta: FileMeta } | null> {
      const row = queryOne(db, sql`SELECT * FROM documents WHERE id = ${id} AND deleted_at IS NULL`)
      if (!row) return null

      const doc = rowToDocument(db, row)

      // Try primary first
      const fromPrimary = await primary.get(doc.storageKey)
      if (fromPrimary) return fromPrimary

      // Fallback to secondary if synced
      if (secondary && doc.remoteStatus === 'synced') {
        const fromSecondary = await secondary.get(doc.storageKey)
        if (fromSecondary) {
          // Cache locally in primary — drain the stream to buffer first
          try {
            const chunks: Uint8Array[] = []
            const reader = fromSecondary.data.getReader()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value) chunks.push(value)
            }
            const buffer = Buffer.concat(chunks)
            await primary.put(doc.storageKey, buffer, fromSecondary.meta)

            // Return a fresh stream from the buffer
            const cachedStream = new ReadableStream({
              start(controller) {
                controller.enqueue(buffer)
                controller.close()
              },
            })
            return { data: cachedStream, meta: fromSecondary.meta }
          } catch {
            return null
          }
        }
      }

      return null
    },
  }
}
