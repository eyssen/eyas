// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Everything memory/index.ts needs to turn the bridge into a live L0 writer,
// in one testable function: zstd init, ingest, bridge attach, the idle
// sweep on the scheduler, and the task-close flush from the bus.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasBus, EyasDb } from '@core/types'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import { initZstd } from '@shared/zstd.js'
import { createMemoryIngest, type MemoryIngest, type FlushReason } from './ingest.js'
import { attachIngest, disableIngestBridge } from './ingest-bridge.js'
import { registerFlushJob, type FlushJobScheduler } from './flush-job.js'
import { runExtraction } from './extractor.js'

export interface L0WireConfig {
  enabled: boolean
  toolResultMaxBytes: number
  idleFlushMinutes: number
  chunkTokens: number
  /** Read only to warn at boot; the tool hook reads the flag itself per call. */
  captureToolResults: boolean
  /** Extraction (plan p1c): `memory.engine`; absent = 'legacy'. */
  engine?: 'legacy' | 'v2'
  /** Extraction (plan p1c): `memory.l0.extractInLegacy`; absent = true. */
  extractInLegacy?: boolean
}

export interface L0WireContext {
  db: EyasDb
  logger: Logger
  caps: SqliteCapabilities
  instanceId: string
  /** Read per call so `config reload` takes effect without a restart. */
  config: () => L0WireConfig
  bus?: Pick<EyasBus, 'on'>
  scheduler?: FlushJobScheduler
}

function isClosedStage(db: EyasDb, stageId: string): boolean {
  try {
    const row = db.all<{ is_closed: number | null }>(sql`SELECT is_closed FROM stages WHERE id = ${stageId}`)[0]
    return Number(row?.is_closed ?? 0) === 1
  } catch {
    return false
  }
}

export async function wireL0Capture(ctx: L0WireContext): Promise<MemoryIngest | null> {
  const { db, logger, caps, instanceId } = ctx
  if (!ctx.config().enabled) {
    disableIngestBridge()
    logger.info('L0 capture disabled (memory.l0.enabled=false); nothing is recorded')
    return null
  }
  try {
    const tier = await initZstd()
    logger.info({ tier }, 'L0 capture: zstd ready')
  } catch (err) {
    // A Node without zlib zstd (23.0–23.7) and without the WASM package.
    // Loud, never silent (spike §2 #13). Disable rather than just returning:
    // the hooks are static imports in other modules and keep calling
    // captureUnit regardless, so an un-disabled bridge would buffer 5 000
    // units and then silently evict the oldest for the rest of the process,
    // with nothing that ever reports it.
    disableIngestBridge()
    logger.error({ err }, 'L0 capture unavailable: no zstd tier (Bun, Node >= 22.15, or @bokuweb/zstd-wasm required); capture is off')
    return null
  }

  const ingest = createMemoryIngest({
    db,
    caps,
    instanceId,
    logger,
    config: () => {
      const c = ctx.config()
      return { toolResultMaxBytes: c.toolResultMaxBytes, idleFlushMinutes: c.idleFlushMinutes, chunkTokens: c.chunkTokens }
    },
  })

  // Extraction (plan p1c): the one subscription. The ingest catches a throwing
  // listener, and runExtraction never throws: it owns a transaction or takes a
  // savepoint inside a caller's, and records a failed run instead of raising.
  ingest.onFlushed((conversationId, reason) => {
    runExtraction(db, conversationId, reason, {
      logger,
      config: () => {
        const c = ctx.config()
        return { engine: c.engine ?? 'legacy', extractInLegacy: c.extractInLegacy ?? true }
      },
    })
  })

  attachIngest(ingest, logger)

  if (ctx.scheduler && typeof ctx.scheduler.registerHandler === 'function') {
    try {
      registerFlushJob(ctx.scheduler, ingest)
    } catch (err) {
      // Same shape as memory.team_memory.retention's own try/catch in
      // memory/index.ts: a scheduler hiccup (list()/create() throwing) must
      // not sink the rest of the memory module's onStart over one cron job.
      // The idle sweep is lost for this boot; flush still happens on task
      // close, chunk and shutdown.
      logger.warn({ err }, 'L0 capture: flush job registration failed — idle sweep will not run this boot')
    }
  } else {
    logger.debug('L0 capture: scheduler unavailable — idle buffers flush only on task close, chunk or shutdown')
  }

  const safeFlush = (conversationId: string, reason: FlushReason): void => {
    try {
      ingest.flushConversation(conversationId, reason)
    } catch {
      /* logged inside the ingest; the units stay buffered */
    }
  }

  if (ctx.bus) {
    ctx.bus.on('eyas.conversations.closed', async (data) => {
      const id = (data as { conversationId?: string } | undefined)?.conversationId
      if (id) safeFlush(id, 'close')
    })
    ctx.bus.on('eyas.conversations.stage_changed', async (data) => {
      const d = data as { conversationId?: string; toStageId?: string | null } | undefined
      if (d?.conversationId && d.toStageId && isClosedStage(db, d.toStageId)) safeFlush(d.conversationId, 'close')
    })
  }

  if (ctx.config().captureToolResults) {
    // The flag can be set by anything that writes YAML. The written warnings
    // sit in three files nobody re-reads; this is the one place it surfaces at
    // runtime that tool output is being persisted verbatim and unredacted.
    logger.warn('L0 capture: memory.l0.captureToolResults is ON — tool results are stored verbatim and unredacted, and nothing scans or encrypts them at rest')
  }

  return ingest
}
