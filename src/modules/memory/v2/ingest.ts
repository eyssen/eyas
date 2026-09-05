// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// L0 ingest — the only writer of memory_raw / memory_blob / memory_raw_fts /
// memory_tag(layer=raw). Units arrive from the bridge with a capture-time
// ULID; they are buffered per conversation and flushed on task close, idle
// or an ~8k-token chunk. Idempotency is keyed on that ULID (memory_item.id),
// never on content: a retried flush is a no-op; two byte-identical
// occurrences in two conversations are two raw rows with two blobs (one per
// shred partition) sharing one content_hash; within one conversation they
// share one blob (ref_count 2). Spec §6 + spike §2 #21(iv).

import { sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import { zstdCompress } from '@shared/zstd.js'
import { estimateTokens } from '@modules/prompt-wizard/token-budget.js'
import { allocateRid } from './schema.js'
import { detectLanguage } from './language.js'
import type { CaptureUnit } from './ingest-bridge.js'

export type FlushReason = 'close' | 'idle' | 'chunk' | 'manual'

export interface FlushResult {
  conversationId: string
  rawRows: number
  newBlobs: number
  skipped: number
}

export interface MemoryIngestConfig {
  toolResultMaxBytes: number
  idleFlushMinutes: number
  chunkTokens: number
}

export interface MemoryIngest {
  enqueue(unit: CaptureUnit): void
  flushConversation(conversationId: string, reason: FlushReason): FlushResult
  sweepIdle(nowMs?: number): number
  onFlushed(cb: (conversationId: string, reason: string) => void): void
  /** Flush every buffered conversation (shutdown, tests). Returns conversations flushed. */
  flushAll(reason: FlushReason): number
  /** Units buffered and not yet flushed, across all conversations. */
  bufferedUnits(): number
}

export interface MemoryIngestDeps {
  db: EyasDb
  caps: SqliteCapabilities
  /** Read on every call so `config reload` takes effect without a restart. */
  config: () => MemoryIngestConfig
  instanceId: string
  logger: Logger
}

/** An assistant reply persisted twice for one task (LlmResponse event + addMessage) inside this window is one occurrence. */
export const DUPLICATE_WINDOW_MS = 10 * 60_000
/** Contentless FTS body clip; tool results are already byte-capped by config. */
export const RAW_FTS_CLIP_CHARS = 16_000
/** A conversation whose flushes keep failing must not grow without bound. */
const MAX_BUFFERED_PER_CONVERSATION = 2_000

interface BufferedUnit extends CaptureUnit {
  contentHash: string
}

interface ConversationBuffer {
  units: BufferedUnit[]
  tokens: number
  lastActivityMs: number
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function changes(db: EyasDb): number {
  return db.all<{ c: number }>(sql`SELECT changes() AS c`)[0]?.c ?? 0
}

/** Byte-bounded clip on a UTF-8 boundary with a visible marker. */
function clipToBytes(text: string, maxBytes: number): { text: string; originalBytes: number; truncated: boolean } {
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength <= maxBytes) return { text, originalBytes: bytes.byteLength, truncated: false }
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, maxBytes)).replace(/�+$/u, '')
  return {
    text: `${head}\n…[truncated: ${bytes.byteLength} bytes total, kept ${maxBytes}]`,
    originalBytes: bytes.byteLength,
    truncated: true,
  }
}

// Hybrid logical clock (spec §5 syncCols). One instance today, so the
// logical part only disambiguates same-millisecond writes.
let hlcPhysical = 0
let hlcLogical = 0
/**
 * Shared by every writer of a syncable row. Exported for arbitrate.ts, which
 * writes memory_fact / memory_gist / memory_entity: without it a call inserting
 * three rows stamps all three with the same (physical, logical) pair for the
 * same origin instance, which is exactly what this counter exists to prevent.
 */
export function nextHlc(nowMs: number): { physicalMs: number; logical: number } {
  if (nowMs > hlcPhysical) {
    hlcPhysical = nowMs
    hlcLogical = 0
  } else {
    hlcLogical += 1
  }
  return { physicalMs: hlcPhysical, logical: hlcLogical }
}

export function createMemoryIngest(deps: MemoryIngestDeps): MemoryIngest {
  const { db, caps, instanceId, logger } = deps
  const buffers = new Map<string, ConversationBuffer>()
  const flushedListeners: Array<(conversationId: string, reason: string) => void> = []
  const overflowWarned = new Set<string>()

  function bufferFor(conversationId: string): ConversationBuffer {
    let buf = buffers.get(conversationId)
    if (!buf) {
      buf = { units: [], tokens: 0, lastActivityMs: Date.now() }
      buffers.set(conversationId, buf)
    }
    return buf
  }

  function tag(rid: number, tagType: string, tagValue: string): void {
    db.run(sql`INSERT OR IGNORE INTO memory_tag (memory_rid, memory_type, tag_type, tag_value)
      VALUES (${rid}, 'raw', ${tagType}, ${tagValue})`)
  }

  /**
   * Two capture paths can record one assistant reply: the `LlmResponse` event
   * and the `addMessage` that follows it. Suppress the second — but ONLY when
   * the two copies came from DIFFERENT origins, which is the whole reason this
   * heuristic exists. Within one origin a byte-identical repeat is a genuine
   * second occurrence ("Done." twice), and spec §3 says L0 is complete.
   */
  function isDuplicateAssistantReply(buf: ConversationBuffer, unit: BufferedUnit): boolean {
    const origin = (unit.meta?.origin ?? null) as string | null
    const pendingDup = buf.units.some((u) =>
      u.sourceType === 'assistant_message'
      && u.contentHash === unit.contentHash
      && ((u.meta?.origin ?? null) as string | null) !== origin
      && Math.abs(u.occurredAtMs - unit.occurredAtMs) <= DUPLICATE_WINDOW_MS)
    if (pendingDup) return true
    const since = unit.occurredAtMs - DUPLICATE_WINDOW_MS
    const flushed = db.all<{ ok: number }>(sql`SELECT 1 AS ok FROM memory_raw
      WHERE conversation_id = ${unit.conversationId} AND source_type = 'assistant_message'
        AND content_hash = ${unit.contentHash} AND occurred_at >= ${since}
        AND json_extract(meta_json, '$.origin') IS NOT ${origin} LIMIT 1`)
    return flushed.length > 0
  }

  /** Writes one unit inside the caller's transaction. Returns what it did. */
  function writeUnit(unit: BufferedUnit): 'inserted' | 'skipped' | 'inserted_new_blob' {
    const existing = db.all<{ rid: number }>(sql`SELECT rid FROM memory_item WHERE id = ${unit.id}`)
    if (existing.length > 0) return 'skipped'

    const contentBytes = new TextEncoder().encode(unit.content)
    const partition = unit.shredPartitionId ?? unit.conversationId
    const compressed = zstdCompress(contentBytes)
    const blobParam = Buffer.from(compressed.buffer, compressed.byteOffset, compressed.byteLength)
    db.run(sql`INSERT OR IGNORE INTO memory_blob (content_hash, shred_partition_id, compressed_blob, byte_length, ref_count)
      VALUES (${unit.contentHash}, ${partition}, ${blobParam}, ${contentBytes.byteLength}, 0)`)
    const newBlob = changes(db) === 1
    db.run(sql`UPDATE memory_blob SET ref_count = ref_count + 1
      WHERE content_hash = ${unit.contentHash} AND shred_partition_id = ${partition}`)

    const now = Date.now()
    const rid = allocateRid(db, 'raw', unit.id, now)
    const hlc = nextHlc(now)
    const metaJson = unit.meta ? JSON.stringify(unit.meta) : null
    db.run(sql`INSERT INTO memory_raw (
        rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at,
        shred_partition_id, source_type, actor, conversation_id, project_id, project_type_id,
        occurred_at, trust_tier, dek_id, tombstoned, meta_json)
      VALUES (
        ${rid}, ${unit.id}, ${unit.contentHash}, ${instanceId}, ${hlc.physicalMs}, ${hlc.logical}, 1, ${now},
        ${partition}, ${unit.sourceType}, ${unit.actor}, ${unit.conversationId}, ${unit.projectId}, ${unit.projectTypeId},
        ${unit.occurredAtMs}, ${unit.trustTier}, NULL, 0, ${metaJson})`)

    if (caps.fts5) {
      db.run(sql`INSERT INTO memory_raw_fts (rowid, body) VALUES (${rid}, ${unit.content.slice(0, RAW_FTS_CLIP_CHARS)})`)
    }

    if (unit.projectId) tag(rid, 'project', unit.projectId)
    if (unit.projectTypeId) tag(rid, 'project_type', unit.projectTypeId)
    tag(rid, 'task', unit.conversationId)
    tag(rid, 'source_type', unit.sourceType)
    tag(rid, 'language', detectLanguage(unit.content))
    tag(rid, 'layer', 'raw')
    tag(rid, 'trust_tier', unit.trustTier)
    return newBlob ? 'inserted_new_blob' : 'inserted'
  }

  function flushUnits(conversationId: string, units: BufferedUnit[]): FlushResult {
    const result: FlushResult = { conversationId, rawRows: 0, newBlobs: 0, skipped: 0 }
    // BEGIN MUST STAY OUTSIDE THE try. If a caller already has a transaction
    // open, this BEGIN throws — and because the catch is unreachable, no
    // ROLLBACK runs and their uncommitted work survives. Moved inside "for
    // symmetry", the catch would fire and roll back THEIR transaction instead
    // of ours, which is precisely the data-loss bug p1a found in the SQLite
    // capability probe. Same hazard, same reason, as the `began` guards in
    // security-gate/autonomy-policy.ts and agent/god-mode/store.ts.
    db.run(sql`BEGIN IMMEDIATE`)
    try {
      for (const unit of units) {
        const outcome = writeUnit(unit)
        if (outcome === 'skipped') result.skipped++
        else {
          result.rawRows++
          if (outcome === 'inserted_new_blob') result.newBlobs++
        }
      }
      db.run(sql`COMMIT`)
    } catch (err) {
      try { db.run(sql`ROLLBACK`) } catch { /* the transaction may already be gone */ }
      throw err
    }
    return result
  }

  function notifyFlushed(conversationId: string, reason: FlushReason): void {
    for (const cb of flushedListeners) {
      try {
        cb(conversationId, reason)
      } catch (err) {
        logger.warn({ err, conversationId, reason }, 'L0 ingest: onFlushed listener threw; the flush itself is committed')
      }
    }
  }

  const ingest: MemoryIngest = {
    enqueue(raw: CaptureUnit): void {
      const cfg = deps.config()
      let content = raw.content
      let meta = raw.meta
      if (raw.sourceType === 'tool_result') {
        const clipped = clipToBytes(content, cfg.toolResultMaxBytes)
        content = clipped.text
        if (clipped.truncated) meta = { ...(meta ?? {}), truncated: true, originalBytes: clipped.originalBytes }
      }
      const unit: BufferedUnit = { ...raw, content, meta, contentHash: sha256Hex(new TextEncoder().encode(content)) }
      const buf = bufferFor(unit.conversationId)
      if (unit.sourceType === 'assistant_message' && isDuplicateAssistantReply(buf, unit)) {
        logger.debug({ conversationId: unit.conversationId, unitId: unit.id }, 'L0 ingest: assistant reply already captured for this task within the duplicate window; skipped')
        return
      }
      if (buf.units.length >= MAX_BUFFERED_PER_CONVERSATION) {
        buf.units.shift()
        if (!overflowWarned.has(unit.conversationId)) {
          overflowWarned.add(unit.conversationId)
          logger.warn({ conversationId: unit.conversationId, cap: MAX_BUFFERED_PER_CONVERSATION }, 'L0 ingest: conversation buffer full (flushes failing?); dropping the oldest unit')
        }
      }
      buf.units.push(unit)
      buf.tokens += estimateTokens(content)
      buf.lastActivityMs = Date.now()
      if (buf.tokens >= cfg.chunkTokens) {
        try {
          ingest.flushConversation(unit.conversationId, 'chunk')
        } catch (err) {
          logger.warn({ err, conversationId: unit.conversationId }, 'L0 ingest: chunk flush failed; units stay buffered for the next trigger')
        }
      }
    },

    flushConversation(conversationId: string, reason: FlushReason): FlushResult {
      const buf = buffers.get(conversationId)
      if (!buf || buf.units.length === 0) return { conversationId, rawRows: 0, newBlobs: 0, skipped: 0 }
      const units = buf.units.splice(0, buf.units.length)
      buf.tokens = 0
      try {
        const result = flushUnits(conversationId, units)
        buffers.delete(conversationId)
        // The buffer drained, so the next overflow is a new episode and
        // deserves its own warning. Without this, a conversation warns once
        // per process and every later drop is silent.
        overflowWarned.delete(conversationId)
        if (result.rawRows > 0) notifyFlushed(conversationId, reason)
        return result
      } catch (err) {
        // Put them back at the front so order survives a retry.
        buf.units.unshift(...units)
        buf.tokens = units.reduce((n, u) => n + estimateTokens(u.content), 0)
        logger.warn({ err, conversationId, reason, units: units.length }, 'L0 ingest: flush rolled back')
        throw err
      }
    },

    sweepIdle(nowMs: number = Date.now()): number {
      const idleMs = deps.config().idleFlushMinutes * 60_000
      let flushed = 0
      for (const [conversationId, buf] of [...buffers.entries()]) {
        if (buf.units.length === 0) { buffers.delete(conversationId); continue }
        if (nowMs - buf.lastActivityMs < idleMs) continue
        try {
          ingest.flushConversation(conversationId, 'idle')
          flushed++
        } catch {
          /* already logged in flushConversation; try again next sweep */
        }
      }
      return flushed
    },

    onFlushed(cb): void {
      flushedListeners.push(cb)
    },

    flushAll(reason: FlushReason): number {
      let flushed = 0
      for (const conversationId of [...buffers.keys()]) {
        try {
          ingest.flushConversation(conversationId, reason)
          flushed++
        } catch {
          /* logged in flushConversation; the units stay buffered */
        }
      }
      return flushed
    },

    bufferedUnits(): number {
      let n = 0
      for (const buf of buffers.values()) n += buf.units.length
      return n
    },
  }

  return ingest
}
