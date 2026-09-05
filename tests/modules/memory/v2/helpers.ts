// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { probeSqliteCapabilities, type SqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { generateId } from '@shared/crypto'
import type { CaptureUnit } from '@modules/memory/v2/ingest-bridge'
import type { MemoryIngestConfig } from '@modules/memory/v2/ingest'

/** A pino-shaped logger that records nothing. */
export const silentLogger: any = {
  info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {},
  child() { return silentLogger },
}

/** Mirrors the config/schema.ts defaults for memory.l0. */
export const testIngestConfig: MemoryIngestConfig = {
  toolResultMaxBytes: 8_192,
  idleFlushMinutes: 30,
  chunkTokens: 8_000,
}

/** Bare in-memory DB with only the memory v2 tables. */
export function makeV2Db(): { db: any; caps: SqliteCapabilities } {
  const db = createMemoryDb()
  const caps = probeSqliteCapabilities(getRawFromDrizzle(db))
  createMemoryV2Tables(db, caps)
  return { db, caps }
}

export function makeUnit(overrides: Partial<CaptureUnit> = {}): CaptureUnit {
  return {
    id: generateId(),
    sourceType: 'user_message',
    actor: 'owner-1',
    conversationId: 'conv-1',
    projectId: null,
    projectTypeId: null,
    occurredAtMs: Date.now(),
    content: 'The owner always answers in Hungarian, that is how the work is done.',
    trustTier: 'owner',
    ...overrides,
  }
}
