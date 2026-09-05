// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spec §15 Phase 1 acceptance, as rewritten by spike §2 #21(iv).

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { initZstd, zstdDecompress } from '@shared/zstd'
import { createMemoryIngest, sha256Hex, RAW_FTS_CLIP_CHARS, type MemoryIngest } from '@modules/memory/v2/ingest'
import { makeV2Db, makeUnit, silentLogger, testIngestConfig } from './helpers'

let db: any
let ingest: MemoryIngest

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  const v2 = makeV2Db()
  db = v2.db
  ingest = createMemoryIngest({ db, caps: v2.caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
})

const rawRows = (conv: string) => db.all(sql`SELECT * FROM memory_raw WHERE conversation_id = ${conv} ORDER BY rid`) as any[]
const blobs = () => db.all(sql`SELECT content_hash, shred_partition_id, ref_count, byte_length FROM memory_blob ORDER BY shred_partition_id`) as any[]
const tagsOf = (rid: number) => Object.fromEntries(
  (db.all(sql`SELECT tag_type, tag_value FROM memory_tag WHERE memory_rid = ${rid} AND memory_type = 'raw'`) as any[]).map((t) => [t.tag_type, t.tag_value]),
)

describe('L0 flush', () => {
  it('writes one raw row, one blob, one FTS row and the structural tags', () => {
    const unit = makeUnit({ projectId: 'p1', projectTypeId: 'type-a', occurredAtMs: 1_700_000_000_000, meta: { messageId: 7, attachments: ['doc-1'] } })
    ingest.enqueue(unit)
    const result = ingest.flushConversation('conv-1', 'manual')
    expect(result).toEqual({ conversationId: 'conv-1', rawRows: 1, newBlobs: 1, skipped: 0 })

    const [row] = rawRows('conv-1')
    expect(row.id).toBe(unit.id)
    expect(row.source_type).toBe('user_message')
    expect(row.actor).toBe('owner-1')
    expect(row.project_id).toBe('p1')
    expect(row.project_type_id).toBe('type-a')
    expect(row.occurred_at).toBe(1_700_000_000_000)
    expect(row.trust_tier).toBe('owner')
    expect(row.origin_instance_id).toBe('inst-test')
    expect(row.shred_partition_id).toBe('conv-1')
    expect(row.revision).toBe(1)
    expect(row.tombstoned).toBe(0)
    expect(row.dek_id).toBeNull()
    expect(typeof row.hlc_physical_ms).toBe('number')
    expect(typeof row.created_at).toBe('number')
    expect(JSON.parse(row.meta_json)).toEqual({ messageId: 7, attachments: ['doc-1'] })

    expect(tagsOf(row.rid)).toEqual({
      project: 'p1', project_type: 'type-a', task: 'conv-1', source_type: 'user_message',
      language: 'en', layer: 'raw', trust_tier: 'owner',
    })
    const fts = db.all(sql`SELECT rowid FROM memory_raw_fts WHERE memory_raw_fts MATCH 'hungarian'`) as any[]
    expect(fts.map((r) => r.rowid)).toEqual([row.rid])
  })

  it('two identical messages in two conversations → two raw rows, two blobs, one content_hash', () => {
    ingest.enqueue(makeUnit({ conversationId: 'conv-a', content: 'same bytes' }))
    ingest.enqueue(makeUnit({ conversationId: 'conv-b', content: 'same bytes' }))
    ingest.flushConversation('conv-a', 'manual')
    ingest.flushConversation('conv-b', 'manual')
    const all = db.all(sql`SELECT content_hash FROM memory_raw`) as any[]
    expect(all).toHaveLength(2)
    expect(new Set(all.map((r) => r.content_hash)).size).toBe(1)
    expect(blobs()).toEqual([
      { content_hash: all[0].content_hash, shred_partition_id: 'conv-a', ref_count: 1, byte_length: 10 },
      { content_hash: all[0].content_hash, shred_partition_id: 'conv-b', ref_count: 1, byte_length: 10 },
    ])
  })

  it('two identical messages in one conversation → two raw rows, one blob with ref_count 2', () => {
    ingest.enqueue(makeUnit({ content: 'same bytes', occurredAtMs: 1_000 }))
    ingest.enqueue(makeUnit({ content: 'same bytes', occurredAtMs: 2_000 }))
    const r = ingest.flushConversation('conv-1', 'manual')
    expect(r).toMatchObject({ rawRows: 2, newBlobs: 1 })
    expect(rawRows('conv-1')).toHaveLength(2)
    expect(blobs()).toEqual([{ content_hash: expect.any(String), shred_partition_id: 'conv-1', ref_count: 2, byte_length: 10 }])
  })

  it('a retried flush of the same ULID is a no-op — no row, no ref_count bump', () => {
    const unit = makeUnit()
    ingest.enqueue(unit)
    ingest.flushConversation('conv-1', 'manual')
    ingest.enqueue(unit)
    expect(ingest.flushConversation('conv-1', 'manual')).toEqual({ conversationId: 'conv-1', rawRows: 0, newBlobs: 0, skipped: 1 })
    expect(rawRows('conv-1')).toHaveLength(1)
    expect(blobs()[0].ref_count).toBe(1)
    expect((db.all(sql`SELECT COUNT(*) AS c FROM memory_item`) as any[])[0].c).toBe(1)
  })

  it('the blob decompresses to the original bytes and its hash is the row hash', () => {
    const unit = makeUnit({ content: 'árvíztűrő tükörfúrógép — with a long tail '.repeat(20) })
    ingest.enqueue(unit)
    ingest.flushConversation('conv-1', 'manual')
    const [row] = rawRows('conv-1')
    const blob = (db.all(sql`SELECT compressed_blob FROM memory_blob WHERE content_hash = ${row.content_hash}`) as any[])[0]
    const bytes = zstdDecompress(new Uint8Array(blob.compressed_blob))
    expect(new TextDecoder().decode(bytes)).toBe(unit.content)
    expect(sha256Hex(new TextEncoder().encode(unit.content))).toBe(row.content_hash)
  })

  it('FTS finds a Hungarian word with its diacritics stripped', () => {
    ingest.enqueue(makeUnit({ content: 'Az árvíztűrő tükörfúrógép a legjobb magyar tesztmondat, és mindig működik.' }))
    ingest.flushConversation('conv-1', 'manual')
    const [row] = rawRows('conv-1')
    const hits = (q: string) => (db.all(sql`SELECT rowid FROM memory_raw_fts WHERE memory_raw_fts MATCH ${q}`) as any[]).map((r) => r.rowid)
    expect(hits('arvizturo')).toEqual([row.rid])
    expect(hits('tukorfurogep')).toEqual([row.rid])
    expect(tagsOf(row.rid).language).toBe('hu')
  })

  it('omits project tags when there is no project, and honours an explicit shred partition', () => {
    ingest.enqueue(makeUnit({ projectId: null, projectTypeId: null, shredPartitionId: 'vault:notes/a.md', sourceType: 'document', trustTier: 'ingested' }))
    ingest.flushConversation('conv-1', 'manual')
    const [row] = rawRows('conv-1')
    const tags = tagsOf(row.rid)
    expect(tags.project).toBeUndefined()
    expect(tags.project_type).toBeUndefined()
    expect(tags.trust_tier).toBe('ingested')
    expect(row.shred_partition_id).toBe('vault:notes/a.md')
    expect(blobs()[0].shred_partition_id).toBe('vault:notes/a.md')
  })

  it('stores SQL NULL in meta_json — not the string "null" — when the unit carries no meta', () => {
    ingest.enqueue(makeUnit())
    ingest.flushConversation('conv-1', 'manual')
    expect(rawRows('conv-1')[0].meta_json).toBeNull()
  })

  it('clips the FTS body at RAW_FTS_CLIP_CHARS while the blob keeps the whole text', () => {
    const head = 'elsoegyeditokenword'
    const tail = 'utolsoegyeditokenword'
    const content = `${head} ${'x'.repeat(RAW_FTS_CLIP_CHARS)} ${tail}`
    ingest.enqueue(makeUnit({ content }))
    ingest.flushConversation('conv-1', 'manual')
    const [row] = rawRows('conv-1')
    const hits = (q: string) => (db.all(sql`SELECT rowid FROM memory_raw_fts WHERE memory_raw_fts MATCH ${q}`) as any[]).map((r) => r.rowid)
    expect(hits(head)).toEqual([row.rid])
    expect(hits(tail)).toEqual([])
    // The record itself stays complete — only the index is partial.
    const blob = (db.all(sql`SELECT compressed_blob FROM memory_blob WHERE content_hash = ${row.content_hash}`) as any[])[0]
    expect(new TextDecoder().decode(zstdDecompress(new Uint8Array(blob.compressed_blob)))).toBe(content)
  })

  it('flushing a conversation with nothing buffered returns zeros', () => {
    expect(ingest.flushConversation('nothing', 'manual')).toEqual({ conversationId: 'nothing', rawRows: 0, newBlobs: 0, skipped: 0 })
  })

  it('rolls the whole flush back when a write fails and keeps the units buffered', () => {
    ingest.enqueue(makeUnit())
    db.run(sql`DROP TABLE memory_raw`)
    expect(() => ingest.flushConversation('conv-1', 'manual')).toThrow()
    expect((db.all(sql`SELECT COUNT(*) AS c FROM memory_item`) as any[])[0].c).toBe(0)
    expect((db.all(sql`SELECT COUNT(*) AS c FROM memory_blob`) as any[])[0].c).toBe(0)
    expect(ingest.bufferedUnits()).toBe(1)
  })
})
