// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDb } from '../../helpers/test-db'
import { createToolContractHarness, type ToolContractHarness } from '../../helpers/tool-contract'
import { createDocumentsTables } from '@modules/documents/schema'
import { createDocumentService } from '@modules/documents/document-service'
import { createLocalProvider } from '@modules/documents/providers/local-provider'
import { createDocumentTools } from '@modules/tools/builtin/document-tools'

/**
 * Contract test: the document tools against the REAL document service.
 * The tools called `listByResource` / `getDocument`; the service exposes
 * `listByOwner(ownerModule, ownerId)` / `getById(id)`.
 */

// Small valid PNG (1x1 white pixel)
const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
    '2e00000000c4944415478016360f8cfc00000000200016340010d00000000' +
    '49454e44ae426082',
  'hex',
)

const testDb = createTestDb('document-tools-contract')
let db: ReturnType<typeof testDb.open>
let baseDir: string
let documents: ReturnType<typeof createDocumentService>
let harness: ToolContractHarness

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'eyas-doctools-'))
  db = testDb.open()
  createDocumentsTables(db)
  documents = createDocumentService(db, createLocalProvider(baseDir))
  harness = createToolContractHarness(createDocumentTools(() => documents))
})

afterEach(async () => {
  testDb.cleanup()
  await rm(baseDir, { recursive: true, force: true })
})

describe('document tools ↔ document service contract', () => {
  it('list_documents returns the documents linked to an owner record', async () => {
    const doc = await documents.upload({ file: PNG_1X1, filename: 'diagram.png' })
    documents.link(doc.id, 'conversation', 'conv-1')
    const other = await documents.upload({ file: Buffer.from('unrelated'), filename: 'other.txt' })
    documents.link(other.id, 'conversation', 'conv-2')

    const r = await harness.run('list_documents', { ownerModule: 'conversation', ownerId: 'conv-1' })

    expect(r.success).toBe(true)
    const output = r.output as any
    expect(output.error).toBeUndefined()
    expect(output.documents).toHaveLength(1)
    expect(output.documents[0].id).toBe(doc.id)
    expect(output.documents[0].filename).toBe('diagram.png')
  })

  it('list_documents returns an empty list for an owner with no documents', async () => {
    const r = await harness.run('list_documents', { ownerModule: 'conversation', ownerId: 'nobody' })

    expect(r.success).toBe(true)
    expect((r.output as any).documents).toEqual([])
  })

  it('read_document returns metadata for a real document id', async () => {
    const doc = await documents.upload({ file: Buffer.from('hello document'), filename: 'hello.txt' })

    const r = await harness.run('read_document', { documentId: doc.id })

    expect(r.success).toBe(true)
    const output = r.output as any
    expect(output.document.id).toBe(doc.id)
    expect(output.document.filename).toBe('hello.txt')
    expect(output.document.sizeBytes).toBe(Buffer.from('hello document').length)
  })

  it('read_document returns a not-found error instead of a null document', async () => {
    const r = await harness.run('read_document', { documentId: 'no-such-doc' })

    expect(r.success).toBe(true)
    expect((r.output as any).error).toMatch(/not found/i)
  })

  it('fails soft (structured error, not throw) when the module is not started yet', async () => {
    const h = createToolContractHarness(createDocumentTools(() => undefined))

    const list = await h.run('list_documents', { ownerModule: 'conversation', ownerId: 'c1' })
    expect(list.success).toBe(true)
    expect((list.output as any).error).toMatch(/not ready/i)

    const read = await h.run('read_document', { documentId: 'x' })
    expect(read.success).toBe(true)
    expect((read.output as any).error).toMatch(/not ready/i)
  })
})
