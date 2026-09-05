// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { createMemoryIngest, DUPLICATE_WINDOW_MS, type MemoryIngest, type MemoryIngestConfig } from '@modules/memory/v2/ingest'
import { makeV2Db, makeUnit, silentLogger } from './helpers'

let db: any
let ingest: MemoryIngest
let config: MemoryIngestConfig

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  const v2 = makeV2Db()
  db = v2.db
  config = { toolResultMaxBytes: 64, idleFlushMinutes: 30, chunkTokens: 100 }
  ingest = createMemoryIngest({ db, caps: v2.caps, config: () => config, instanceId: 'inst-test', logger: silentLogger })
})

const count = (conv: string) => (db.all(sql`SELECT COUNT(*) AS c FROM memory_raw WHERE conversation_id = ${conv}`) as any[])[0].c

describe('L0 ingest triggers', () => {
  it('flushes on its own once a conversation buffers ~chunkTokens, reporting reason chunk', () => {
    const flushed = vi.fn()
    ingest.onFlushed(flushed)
    ingest.enqueue(makeUnit({ content: 'x'.repeat(200) }))   // ~50 tokens, below 100
    expect(count('conv-1')).toBe(0)
    ingest.enqueue(makeUnit({ content: 'y'.repeat(200) }))   // crosses 100
    expect(count('conv-1')).toBe(2)
    expect(flushed).toHaveBeenCalledWith('conv-1', 'chunk')
    expect(ingest.bufferedUnits()).toBe(0)
  })

  it('sweepIdle flushes only conversations idle for idleFlushMinutes', () => {
    const t0 = Date.now()
    ingest.enqueue(makeUnit({ conversationId: 'old' }))
    expect(ingest.sweepIdle(t0 + 5 * 60_000)).toBe(0)
    expect(count('old')).toBe(0)
    expect(ingest.sweepIdle(t0 + 31 * 60_000)).toBe(1)
    expect(count('old')).toBe(1)
    expect(ingest.sweepIdle(t0 + 62 * 60_000)).toBe(0)
  })

  it('onFlushed fires with the reason, and not at all when every unit was a replay', () => {
    const flushed = vi.fn()
    ingest.onFlushed(flushed)
    const unit = makeUnit()
    ingest.enqueue(unit)
    ingest.flushConversation('conv-1', 'close')
    expect(flushed).toHaveBeenCalledTimes(1)
    expect(flushed).toHaveBeenCalledWith('conv-1', 'close')
    ingest.enqueue(unit)
    ingest.flushConversation('conv-1', 'manual')
    expect(flushed).toHaveBeenCalledTimes(1)
  })

  it('a throwing onFlushed listener does not undo the committed flush', () => {
    ingest.onFlushed(() => { throw new Error('extractor on fire') })
    ingest.enqueue(makeUnit())
    expect(() => ingest.flushConversation('conv-1', 'manual')).not.toThrow()
    expect(count('conv-1')).toBe(1)
  })

  it('caps tool results at toolResultMaxBytes with a marker and records the original size', () => {
    ingest.enqueue(makeUnit({ sourceType: 'tool_result', trustTier: 'ingested', content: 'A'.repeat(500), meta: { toolName: 'bash' } }))
    ingest.flushConversation('conv-1', 'manual')
    const [row] = db.all(sql`SELECT meta_json FROM memory_raw WHERE conversation_id = 'conv-1'`) as any[]
    const blob = (db.all(sql`SELECT byte_length FROM memory_blob`) as any[])[0]
    expect(JSON.parse(row.meta_json)).toEqual({ toolName: 'bash', truncated: true, originalBytes: 500 })
    expect(blob.byte_length).toBeLessThan(200)
    expect(blob.byte_length).toBeGreaterThan(64)
  })

  it('does not cap messages, only tool results', () => {
    ingest.enqueue(makeUnit({ content: 'B'.repeat(500) }))
    ingest.flushConversation('conv-1', 'manual')
    expect((db.all(sql`SELECT byte_length FROM memory_blob`) as any[])[0].byte_length).toBe(500)
  })

  it('suppresses one reply captured by BOTH paths within 10 minutes, but keeps two genuine repeats from one path', () => {
    const t = 1_700_000_000_000
    const base = { sourceType: 'assistant_message' as const, actor: 'agent-1', content: 'final answer' }
    const fromEvent = (over: Record<string, unknown> = {}) => makeUnit({ ...base, meta: { origin: 'agent_events' }, ...over })
    const fromMessage = (over: Record<string, unknown> = {}) => makeUnit({ ...base, meta: { origin: 'conversation_messages' }, ...over })

    // Both paths, both still pending: one occurrence.
    ingest.enqueue(fromEvent({ occurredAtMs: t }))
    ingest.enqueue(fromMessage({ occurredAtMs: t + 1_000 }))
    expect(ingest.bufferedUnits()).toBe(1)

    // Both paths, the first already flushed: still one occurrence.
    ingest.flushConversation('conv-1', 'manual')
    ingest.enqueue(fromMessage({ occurredAtMs: t + 2_000 }))
    expect(ingest.bufferedUnits()).toBe(0)

    // Past the window, it is a new occurrence again.
    ingest.enqueue(fromMessage({ occurredAtMs: t + DUPLICATE_WINDOW_MS + 1 }))
    expect(ingest.bufferedUnits()).toBe(1)

    // Two byte-identical replies from the SAME path are two real occurrences —
    // the old content-only key threw the second away silently.
    ingest.enqueue(fromEvent({ conversationId: 'conv-3', occurredAtMs: t }))
    ingest.enqueue(fromEvent({ conversationId: 'conv-3', occurredAtMs: t + 1_000 }))
    expect(ingest.bufferedUnits()).toBe(3)

    // Never across tasks, never across roles.
    ingest.enqueue(fromMessage({ conversationId: 'conv-2', occurredAtMs: t + 3_000 }))
    ingest.enqueue(makeUnit({ sourceType: 'user_message', content: 'final answer', occurredAtMs: t + 4_000 }))
    expect(ingest.bufferedUnits()).toBe(5)
  })

  it('flushAll flushes every buffered conversation', () => {
    ingest.enqueue(makeUnit({ conversationId: 'a' }))
    ingest.enqueue(makeUnit({ conversationId: 'b' }))
    expect(ingest.flushAll('manual')).toBe(2)
    expect(count('a') + count('b')).toBe(2)
    expect(ingest.bufferedUnits()).toBe(0)
  })

  it('flushAll keeps going past a conversation that throws, and does not count it', () => {
    // This is the shutdown path (memory/index.ts onStop calls flushAll): one
    // broken conversation must not cost every other conversation its flush.
    ingest.enqueue(makeUnit({ conversationId: 'bad' }))
    ingest.enqueue(makeUnit({ conversationId: 'good' }))
    const real = ingest.flushConversation.bind(ingest)
    ingest.flushConversation = (id, reason) => {
      if (id === 'bad') throw new Error('flush on fire')
      return real(id, reason)
    }
    expect(ingest.flushAll('manual')).toBe(1)
    expect(count('bad')).toBe(0)
    expect(count('good')).toBe(1)
    expect(ingest.bufferedUnits()).toBe(1)
  })
})
