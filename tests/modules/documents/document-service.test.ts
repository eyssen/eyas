// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDb } from '../../helpers/test-db'
import { createDocumentsTables } from '../../../src/modules/documents/schema'
import { createDocumentService } from '../../../src/modules/documents/document-service'
import { createLocalProvider } from '../../../src/modules/documents/providers/local-provider'

// Small valid PNG (1x1 white pixel)
const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
    '2e00000000c4944415478016360f8cfc00000000200016340010d00000000' +
    '49454e44ae426082',
  'hex',
)

async function readStream(stream: ReadableStream): Promise<Buffer> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  return Buffer.concat(chunks)
}

describe('createDocumentService', () => {
  let db: any
  let cleanup: () => void
  let baseDir: string
  let service: ReturnType<typeof createDocumentService>

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'eyas-docsvc-'))
    const testDb = createTestDb('document-service')
    db = testDb.open()
    cleanup = testDb.cleanup
    createDocumentsTables(db)

    const primary = createLocalProvider(baseDir)
    service = createDocumentService(db, primary)
  })

  afterEach(async () => {
    cleanup()
    await rm(baseDir, { recursive: true, force: true })
  })

  it('uploads a file and returns a document record with all fields', async () => {
    const file = Buffer.from('hello document')
    const doc = await service.upload({ file, filename: 'hello.txt' })

    expect(doc.id).toBeTruthy()
    expect(doc.filename).toBe('hello.txt')
    expect(doc.sizeBytes).toBe(file.length)
    expect(doc.checksumSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(doc.storageKey).toBeTruthy()
    expect(doc.mimeType).toBeTruthy()
    expect(doc.remoteStatus).toBe('not_configured')
    expect(doc.links).toEqual([])
    expect(doc.deletedAt).toBeNull()
    expect(doc.createdAt).toBeTruthy()
    expect(doc.updatedAt).toBeTruthy()
    expect(doc.metadata).toEqual({})
  })

  it('uploads with metadata and createdBy', async () => {
    const file = Buffer.from('owned file content')
    const doc = await service.upload({
      file,
      filename: 'owned.txt',
      createdBy: 'user-456',
      metadata: { tag: 'important' },
    })

    expect(doc.createdBy).toBe('user-456')
    expect(doc.metadata).toEqual({ tag: 'important' })
    expect(doc.links).toEqual([])
  })

  it('gets document by id', async () => {
    const file = Buffer.from('get by id test')
    const uploaded = await service.upload({ file, filename: 'lookup.txt' })

    const found = service.getById(uploaded.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(uploaded.id)
    expect(found!.filename).toBe('lookup.txt')
  })

  it('links a document to an entity and lists by owner', async () => {
    const file = Buffer.from('list by owner')
    const doc1 = await service.upload({ file, filename: 'doc1.txt' })
    const doc2 = await service.upload({ file, filename: 'doc2.txt' })
    const doc3 = await service.upload({ file, filename: 'doc3.txt' })

    service.link(doc1.id, 'notes', 'note-1')
    service.link(doc2.id, 'notes', 'note-1')
    service.link(doc3.id, 'notes', 'note-2') // different owner

    const docs = service.listByOwner('notes', 'note-1')
    expect(docs).toHaveLength(2)
    const filenames = docs.map((d) => d.filename)
    expect(filenames).toContain('doc1.txt')
    expect(filenames).toContain('doc2.txt')
  })

  it('soft deletes a document — getById returns null, deleted_at set in DB', async () => {
    const file = Buffer.from('to be deleted')
    const doc = await service.upload({ file, filename: 'delete-me.txt' })

    await service.softDelete(doc.id)

    // getById should return null (respects deleted_at IS NULL filter)
    expect(service.getById(doc.id)).toBeNull()

    // deleted_at should be set in raw DB
    const { sql } = await import('drizzle-orm')
    const rows = db.all(sql`SELECT deleted_at FROM documents WHERE id = ${doc.id}`)
    expect(rows[0].deleted_at).toBeTruthy()
  })

  it('links a document to an entity', async () => {
    const file = Buffer.from('link test')
    const doc = await service.upload({ file, filename: 'link.txt' })

    expect(doc.links).toEqual([])

    const link = service.link(doc.id, 'tasks', 'task-999')
    expect(link.documentId).toBe(doc.id)
    expect(link.ownerModule).toBe('tasks')
    expect(link.ownerId).toBe('task-999')

    const updated = service.getById(doc.id)
    expect(updated!.links).toHaveLength(1)
    expect(updated!.links[0].ownerModule).toBe('tasks')
    expect(updated!.links[0].ownerId).toBe('task-999')
  })

  it('unlinks a document from an entity', async () => {
    const file = Buffer.from('unlink test')
    const doc = await service.upload({ file, filename: 'unlink.txt' })

    service.link(doc.id, 'tasks', 'task-888')
    expect(service.getById(doc.id)!.links).toHaveLength(1)

    service.unlink(doc.id, 'tasks', 'task-888')
    expect(service.getById(doc.id)!.links).toHaveLength(0)
  })

  it('supports multi-owner: same document linked to multiple entities', async () => {
    const file = Buffer.from('multi-owner test')
    const doc = await service.upload({ file, filename: 'shared.txt' })

    service.link(doc.id, 'conversations', 'conv-1')
    service.link(doc.id, 'knowledge', 'page-42')

    const updated = service.getById(doc.id)
    expect(updated!.links).toHaveLength(2)

    const modules = updated!.links.map((l) => l.ownerModule).sort()
    expect(modules).toEqual(['conversations', 'knowledge'])

    // Both owners can find it
    const convDocs = service.listByOwner('conversations', 'conv-1')
    expect(convDocs).toHaveLength(1)
    expect(convDocs[0].id).toBe(doc.id)

    const knowledgeDocs = service.listByOwner('knowledge', 'page-42')
    expect(knowledgeDocs).toHaveLength(1)
    expect(knowledgeDocs[0].id).toBe(doc.id)
  })

  it('getLinks returns all links for a document', async () => {
    const file = Buffer.from('get links test')
    const doc = await service.upload({ file, filename: 'links.txt' })

    service.link(doc.id, 'board', 'task-1')
    service.link(doc.id, 'chat', 'msg-5')

    const links = service.getLinks(doc.id)
    expect(links).toHaveLength(2)
    expect(links[0].documentId).toBe(doc.id)
    expect(links[1].documentId).toBe(doc.id)
  })

  it('rejects a file that exceeds the size limit', async () => {
    const primary = createLocalProvider(baseDir)
    const restrictedService = createDocumentService(db, primary, undefined, {
      maxFileSizeMb: 0.001, // ~1KB limit
      allowedTypes: ['*/*'],
    })

    const bigFile = Buffer.alloc(2000, 'x') // 2KB — exceeds 1KB limit

    await expect(
      restrictedService.upload({ file: bigFile, filename: 'too-big.bin' }),
    ).rejects.toThrow(/size/i)
  })

  it("module: 'media' allows a file over 50MB when override is 200", async () => {
    const primary = createLocalProvider(baseDir)
    const mediaAware = createDocumentService(db, primary, undefined, undefined, {
      media: { maxFileSizeMb: 200 },
    })

    const overDefault = Buffer.alloc(51 * 1024 * 1024, 1) // 51MB > default 50MB

    await expect(
      mediaAware.upload({ file: overDefault, filename: 'big.bin' }),
    ).rejects.toThrow(/size/i)

    const doc = await mediaAware.upload({
      file: overDefault,
      filename: 'big.bin',
      module: 'media',
    })
    expect(doc.sizeBytes).toBe(overDefault.length)
  })

  it('downloads a file as stream — roundtrip: upload → download → read', async () => {
    const originalContent = Buffer.from('roundtrip download content')
    const doc = await service.upload({ file: originalContent, filename: 'roundtrip.txt' })

    const result = await service.download(doc.id)
    expect(result).not.toBeNull()

    const downloaded = await readStream(result!.data)
    expect(downloaded.equals(originalContent)).toBe(true)
    expect(result!.meta.filename).toBe('roundtrip.txt')
    expect(result!.meta.sizeBytes).toBe(originalContent.length)
  })

  it('getStats returns correct statistics', async () => {
    const file1 = Buffer.from('file one content')
    const file2 = Buffer.alloc(1000, 'x')
    await service.upload({ file: file1, filename: 'stats1.txt' })
    await service.upload({ file: file2, filename: 'stats2.txt' })

    const stats = service.getStats()
    expect(stats.totalFiles).toBe(2)
    expect(stats.totalSizeBytes).toBe(file1.length + file2.length)
    expect(stats.syncStatus.not_configured).toBe(2)
    expect(stats.topMimeTypes.length).toBeGreaterThan(0)
  })
})
