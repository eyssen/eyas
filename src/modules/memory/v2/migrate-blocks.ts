// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// One-shot: the retired shared memory blocks become ordinary L0 memory.
//
// memory_block_read / memory_block_write kept a second, model-written store
// (memory_blocks) beside L0, outside arbitration and the poison gate. The
// tools are gone; what agents wrote there is not lost. Every row is copied
// into L0 as a 'document' unit — trust 'derived', because a model wrote it —
// and from there it is extracted, arbitrated and recalled like everything
// else (memory_search, the standing recall). A block whose text the poison
// gate refuses lands 'quarantined': kept for audit, never recalled.
//
// Deterministic ids (legacyId over the block id), so a partial run resumes
// without duplicates; memory_meta 'blocks_migrated_v1' is set only when every
// block is in L0, and a later start then does nothing. The table itself stays
// (nothing writes it any more); a database that never had it has nothing to do.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import type { CaptureUnit } from './ingest-bridge.js'
import type { MemoryIngest } from './ingest.js'
import { getMemoryMeta, setMemoryMeta } from './schema.js'
import { legacyId, toEpochMs } from './migrate-imported.js'
import { admitModelAuthoredText } from './model-write-gate.js'

export const BLOCKS_MIGRATED_META_KEY = 'blocks_migrated_v1'
export const BLOCKS_MIGRATED_VERSION = '1'

/** The L0 pseudo-task of one block: its own, like a vault note's `vault:<path>`. */
export function memoryBlockConversationId(blockId: string): string {
  return `memory-block:${blockId}`
}

interface BlockRow {
  id: string
  scope: string
  scope_id: string
  key: string
  content: string | null
  version: number | null
  updated_by: string | null
  created_at: string | null
  updated_at: string | null
}

/** The L0 unit of one block; null when the block holds no text. */
export function buildMemoryBlockUnit(row: BlockRow): CaptureUnit | null {
  const body = (row.content ?? '').trim()
  if (!body) return null
  const occurredAtMs = toEpochMs(row.updated_at) || toEpochMs(row.created_at) || 1
  const conversationId = memoryBlockConversationId(row.id)
  const verdict = admitModelAuthoredText(row.key, body)
  return {
    id: legacyId(occurredAtMs, `legacy:memory_blocks:${row.id}`),
    sourceType: 'document',
    actor: 'memory_block',
    conversationId,
    // Blocks had no project: any agent could read any block, so they were global.
    projectId: null,
    projectTypeId: null,
    occurredAtMs,
    // The key names what the block is about; recall matches on it too.
    content: `${row.key}\n\n${body}`,
    trustTier: verdict.admitted ? 'derived' : 'quarantined',
    shredPartitionId: conversationId,
    meta: {
      origin: 'memory_block',
      scope: row.scope,
      scopeId: row.scope_id,
      key: row.key,
      version: row.version ?? 1,
      updatedBy: row.updated_by ?? null,
      ...(verdict.admitted ? {} : { poisonGate: verdict.pattern }),
    },
  }
}

function hasItem(db: EyasDb, id: string): boolean {
  return db.all<{ ok: number }>(sql`SELECT 1 AS ok FROM memory_item WHERE id = ${id} LIMIT 1`).length > 0
}

function readBlocks(db: EyasDb): BlockRow[] | null {
  try {
    return db.all<BlockRow>(sql`SELECT id, scope, scope_id, key, content, version, updated_by, created_at, updated_at
      FROM memory_blocks ORDER BY id`)
  } catch {
    return null // no memory_blocks table: nothing was ever written there
  }
}

export interface MigrateBlocksDeps {
  db: EyasDb
  ingest: MemoryIngest
  logger?: Pick<Logger, 'info' | 'warn'>
}

export interface MigrateBlocksResult {
  /** Blocks written into L0 by this run. */
  migrated: number
  /** Of those, the ones the poison gate quarantined. */
  quarantined: number
  /** Blocks already in L0, or empty. */
  skipped: number
  /** The marker was already set: nothing was read. */
  done: boolean
}

const BATCH = 16

export async function migrateBlocksIntoL0(deps: MigrateBlocksDeps): Promise<MigrateBlocksResult> {
  const { db, ingest } = deps
  const out: MigrateBlocksResult = { migrated: 0, quarantined: 0, skipped: 0, done: false }
  if (getMemoryMeta(db, BLOCKS_MIGRATED_META_KEY) === BLOCKS_MIGRATED_VERSION) return { ...out, done: true }

  const rows = readBlocks(db) ?? []
  const ids: string[] = []
  let batch = 0
  for (const row of rows) {
    const unit = buildMemoryBlockUnit(row)
    if (!unit || hasItem(db, unit.id)) {
      out.skipped++
      continue
    }
    ingest.enqueue(unit)
    ids.push(unit.id)
    out.migrated++
    if (unit.trustTier === 'quarantined') out.quarantined++
    if (++batch >= BATCH) {
      ingest.flushAll('manual')
      batch = 0
      await new Promise<void>((r) => setTimeout(r, 0))
    }
  }
  ingest.flushAll('manual')

  // The marker only once every block is really in L0; a flush that failed
  // leaves it unset and the next start resumes (the ids are deterministic).
  const missing = ids.filter((id) => !hasItem(db, id)).length
  if (missing === 0) setMemoryMeta(db, BLOCKS_MIGRATED_META_KEY, BLOCKS_MIGRATED_VERSION)
  else deps.logger?.warn({ missing }, 'memory blocks: some blocks did not reach L0; retried at the next start')
  return out
}
