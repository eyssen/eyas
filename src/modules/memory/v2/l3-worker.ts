// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Incremental L3: new gists and facts get their vectors seconds after the
// flush that extracted them, not at the next restart. Every committed L0
// flush kicks the worker (memory/index.ts, ingest.onFlushed after the
// extraction listener); the boot pass kicks it once more after the imported
// memory is migrated. A drain embeds until nothing is missing, retires the
// vectors of owners recall can no longer return, then applies the live-index
// cap.
//
// kick() is debounced (a burst of flushes is one drain) and never runs the
// drain on the caller's stack, so it never runs inside a caller's
// transaction. Drains are single-flight: a kick during a drain schedules one
// more pass after it instead of a second concurrent one.

import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import type { EmbeddingProvider } from '../embeddings/types.js'
import { HASH_EMBED_MODEL_ID } from '../embeddings/hash-embedder.js'
import { embedLayeredBatch, retireDeadEmbeddings, L3_EMBED_BATCH } from './l3-embed.js'
import { capLiveIndex } from './live-cap.js'

type RawDb = { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } }

export const L3_WORKER_DEBOUNCE_MS = 500
/** A steady stream of kicks still drains at least this often. */
export const L3_WORKER_MAX_WAIT_MS = 5_000

export interface L3WorkerDeps {
  db: EyasDb
  /** The raw handle of the same connection (vec0 writes); undefined keeps memory_embedding only. */
  getRawDb: () => RawDb | undefined
  /** The local L3 embedder — the same one retrieve() embeds queries with. */
  bridge: EmbeddingProvider
  logger?: Pick<Logger, 'info' | 'warn' | 'debug'>
  /** memory.recall.includeSecrets, read per drain so a config reload applies. */
  includeSecrets: () => boolean
  debounceMs?: number
  maxWaitMs?: number
  batchSize?: number
}

export interface L3DrainResult {
  gists: number
  facts: number
  entities: number
  retired: number
  demoted: number
}

export interface L3WorkerStatus {
  modelId: string
  /** A drain is running. */
  running: boolean
  /** A kick is waiting for its debounce. */
  scheduled: boolean
  runs: number
  lastRunAt: number | null
  lastDurationMs: number | null
  lastError: string | null
  totals: L3DrainResult
}

export interface L3EmbedWorker {
  /** Schedule a drain (debounced, single-flight). No-op after stop(). */
  kick(): void
  /** Drain now; resolves when this and any pass it queued are done. */
  drain(): Promise<L3DrainResult>
  /** Cancel a pending kick, stop between batches, wait for a running drain. */
  stop(): Promise<void>
  /** Counters for health and observability. */
  status(): L3WorkerStatus
}

const empty = (): L3DrainResult => ({ gists: 0, facts: 0, entities: 0, retired: 0, demoted: 0 })

function add(into: L3DrainResult, from: Partial<L3DrainResult>): void {
  into.gists += from.gists ?? 0
  into.facts += from.facts ?? 0
  into.entities += from.entities ?? 0
  into.retired += from.retired ?? 0
  into.demoted += from.demoted ?? 0
}

const yieldTick = () => new Promise<void>((r) => setTimeout(r, 0))

export function createL3EmbedWorker(deps: L3WorkerDeps): L3EmbedWorker {
  const debounceMs = Math.max(0, deps.debounceMs ?? L3_WORKER_DEBOUNCE_MS)
  const maxWaitMs = Math.max(debounceMs, deps.maxWaitMs ?? L3_WORKER_MAX_WAIT_MS)
  const batchSize = Math.max(1, deps.batchSize ?? L3_EMBED_BATCH)
  let timer: ReturnType<typeof setTimeout> | null = null
  let firstKickAt: number | null = null
  let inflight: Promise<L3DrainResult> | null = null
  let again = false
  let stopped = false
  const totals = empty()
  const stats = {
    runs: 0,
    lastRunAt: null as number | null,
    lastDurationMs: null as number | null,
    lastError: null as string | null,
  }

  const includeSecrets = (): boolean => {
    try {
      return deps.includeSecrets() === true
    } catch {
      return false
    }
  }

  async function pass(): Promise<L3DrainResult> {
    const out = empty()
    const started = Date.now()
    stats.lastError = null
    try {
      const rawDb = deps.getRawDb()
      const secrets = includeSecrets()
      if (deps.bridge.canEmbed()) {
        while (!stopped) {
          const batch = await embedLayeredBatch({
            db: deps.db, rawDb, bridge: deps.bridge, logger: deps.logger as Logger | undefined, includeSecrets: secrets,
          }, batchSize)
          add(out, batch)
          if (batch.gists + batch.facts + batch.entities === 0) break
          await yieldTick()
        }
      }
      if (!stopped) {
        out.retired = retireDeadEmbeddings({ db: deps.db, rawDb, logger: deps.logger as Logger | undefined, includeSecrets: secrets }).retired
        out.demoted = capLiveIndex(deps.db, rawDb).demoted
      }
    } catch (err) {
      // An embedder or a statement failing ends this pass; the next kick
      // retries. Never thrown to the flush that kicked it.
      stats.lastError = String((err as Error)?.message ?? err)
      deps.logger?.warn?.({ err }, 'L3 worker: drain failed; the next flush retries')
    }
    stats.runs++
    stats.lastRunAt = Date.now()
    stats.lastDurationMs = stats.lastRunAt - started
    add(totals, out)
    if (out.gists + out.facts + out.entities + out.retired + out.demoted > 0) {
      deps.logger?.info?.(out, 'L3 worker: vectors updated')
    }
    return out
  }

  function drain(): Promise<L3DrainResult> {
    if (stopped) return Promise.resolve(empty())
    if (inflight) {
      again = true
      return inflight
    }
    inflight = (async () => {
      const result = empty()
      try {
        do {
          again = false
          add(result, await pass())
        } while (again && !stopped)
      } finally {
        inflight = null
      }
      return result
    })()
    return inflight
  }

  function fire(): void {
    timer = null
    firstKickAt = null
    void drain().catch(() => { /* logged in pass */ })
  }

  return {
    kick(): void {
      if (stopped) return
      const now = Date.now()
      if (firstKickAt === null) firstKickAt = now
      if (timer) clearTimeout(timer)
      const wait = Math.max(0, Math.min(debounceMs, firstKickAt + maxWaitMs - now))
      timer = setTimeout(fire, wait)
      ;(timer as { unref?: () => void }).unref?.()
    },

    drain,

    async stop(): Promise<void> {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      firstKickAt = null
      if (inflight) {
        try { await inflight } catch { /* logged in pass */ }
      }
    },

    status(): L3WorkerStatus {
      let modelId = HASH_EMBED_MODEL_ID
      try { modelId = deps.bridge.modelId?.() || HASH_EMBED_MODEL_ID } catch { /* keep the fallback label */ }
      return {
        modelId,
        running: inflight !== null,
        scheduled: timer !== null,
        runs: stats.runs,
        lastRunAt: stats.lastRunAt,
        lastDurationMs: stats.lastDurationMs,
        lastError: stats.lastError,
        totals: { ...totals },
      }
    },
  }
}
