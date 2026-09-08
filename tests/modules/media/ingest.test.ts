// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDb } from '../../helpers/test-db'
import { createDocumentsTables } from '../../../src/modules/documents/schema'
import { createDocumentService } from '../../../src/modules/documents/document-service'
import { createLocalProvider } from '../../../src/modules/documents/providers/local-provider'
import { createIngest } from '@modules/media/ingest'
import type { MediaJob } from '@modules/media/types'

// Small valid PNG (1x1 white pixel) — same as document-service.test.ts
const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
    '2e00000000c4944415478016360f8cfc00000000200016340010d00000000' +
    '49454e44ae426082',
  'hex',
)

function jobStub(over: Partial<MediaJob> = {}): MediaJob {
  const ts = new Date().toISOString()
  return {
    id: 'job-1',
    providerId: 'fake',
    providerJobId: 'vendor-1',
    kind: 'image',
    status: 'completed',
    prompt: 'a lamp',
    model: null,
    error: null,
    resultUrls: [],
    documentIds: [],
    credits: null,
    conversationId: null,
    batchId: null,
    agentId: null,
    userId: 'user-1',
    createdAt: ts,
    updatedAt: ts,
    completedAt: ts,
    ...over,
  }
}

describe('createIngest', () => {
  let db: any
  let cleanup: () => void
  let baseDir: string
  let service: ReturnType<typeof createDocumentService>

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'eyas-ingest-'))
    const testDb = createTestDb('media-ingest')
    db = testDb.open()
    cleanup = testDb.cleanup
    createDocumentsTables(db)
    service = createDocumentService(db, createLocalProvider(baseDir), undefined, undefined, {
      media: { maxFileSizeMb: 200 },
    })
  })

  afterEach(async () => {
    cleanup()
    await rm(baseDir, { recursive: true, force: true })
  })

  it('uploads bytes, links to the conversation as ai, sets documentIds', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } })

    const ingest = createIngest({ documents: service, fetchImpl: mockFetch })
    const next = await ingest(
      jobStub({
        conversationId: 'c1',
        resultUrls: ['https://cdn.example/out.png'],
        documentIds: [],
      }),
    )

    expect(next.documentIds).toHaveLength(1)
    expect(service.listByOwner('conversations', 'c1')).toHaveLength(1)
    const links = service.getLinks(next.documentIds[0]!)
    expect(links).toHaveLength(1)
    expect(links[0]!.source).toBe('ai')
  })

  it('keeps completed status and resultUrls when fetch throws, notes ingest in error', async () => {
    const mockFetch: typeof fetch = async () => {
      throw new Error('network down')
    }

    const ingest = createIngest({ documents: service, fetchImpl: mockFetch })
    const urls = ['https://cdn.example/out.png']
    const next = await ingest(
      jobStub({
        conversationId: 'c1',
        resultUrls: urls,
        documentIds: [],
        status: 'completed',
      }),
    )

    expect(next.status).toBe('completed')
    expect(next.resultUrls).toEqual(urls)
    expect(next.documentIds).toEqual([])
    expect(next.error).toMatch(/ingest/i)
  })
})
