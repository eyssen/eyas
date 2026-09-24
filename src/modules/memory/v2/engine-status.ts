// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// What the recall engine is doing right now, for the Memory page's "Recall
// engine" card (GET /api/v1/memory/engine). Read-only, computed per request:
//   - the embedder L3 and the query-side KNN run on (always local: e5, else
//     the hashed stem embedder), the same for every chat provider;
//   - how many of the gists and facts recall can return already have a vector
//     under that embedder, and when the incremental L3 worker last ran;
//   - how many project and project-type partitions hold live vectors (D1);
//   - what the L0 capture records (effective: a switch under a capture that is
//     off records nothing, so it reads as off);
//   - the recall switches: contains-secrets and the index budget.
// No content leaves here — only counts, flags and the embedder's id.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { EmbeddingProvider } from '../embeddings/types.js'
import { HASH_EMBED_MODEL_ID } from '../embeddings/hash-embedder.js'
import { E5_MODEL_ID } from '../embeddings/local-embedder.js'
import { recallIncludesSecrets } from '../memory-index.js'
import { DEFAULT_MEMORY_RECALL_CHARS } from '@modules/prompt-wizard/token-budget'
import { embeddableFactWhere, embeddableGistWhere } from './l3-embed.js'

export interface EngineCoverage {
  /** Recallable rows that have a vector under the current embedder. */
  embedded: number
  /** Rows the L3 pass embeds (live, not quarantined, secrets rule applied). */
  total: number
}

export interface MemoryEngineStatus {
  /** null: no embedder was built this start, so dense recall is off. */
  embedder: { modelId: string; kind: 'e5' | 'hash' } | null
  l3: { gists: EngineCoverage; facts: EngineCoverage; lastRunAt: number | null }
  /** D1 partitions that hold at least one live vector. The global partition is always there. */
  partitions: { projects: number; projectTypes: number }
  capture: { l0Enabled: boolean; toolResults: boolean; thinking: boolean }
  recall: { includeSecrets: boolean; indexBudgetChars: number }
}

export interface MemoryEngineSources {
  db: EyasDb
  /** The L3 / recall embedder (ctx.embeddingBridge), read per request. */
  bridge: () => EmbeddingProvider | undefined
  /** The incremental L3 worker, read per request. */
  worker: () => { status(): { lastRunAt: number | null } } | undefined
  /** The live config object (memory.l0, memory.recall, memory.index). */
  config: () => unknown
  /** L0 capture was wired this start (false when disabled or SQLite could not be probed). */
  captureActive: () => boolean
}

function embedderOf(bridge: EmbeddingProvider | undefined): MemoryEngineStatus['embedder'] {
  if (!bridge) return null
  let modelId = HASH_EMBED_MODEL_ID
  try {
    modelId = bridge.modelId?.() || HASH_EMBED_MODEL_ID
  } catch { /* keep the fallback label, as the L3 pass does */ }
  return { modelId, kind: modelId === E5_MODEL_ID ? 'e5' : 'hash' }
}

/** A missing v2 table (its creation failed this start) is no memory, not an error. */
function safeRow<T>(read: () => T | undefined, fallback: T): T {
  try {
    return read() ?? fallback
  } catch {
    return fallback
  }
}

function coverage(db: EyasDb, owner: 'gist' | 'fact', modelId: string | null, includeSecrets: boolean): EngineCoverage {
  const row = safeRow(() => {
    const where = owner === 'gist' ? embeddableGistWhere(includeSecrets) : embeddableFactWhere(includeSecrets)
    const from = owner === 'gist' ? sql`memory_gist g` : sql`memory_fact f`
    const id = owner === 'gist' ? sql`g.id` : sql`f.id`
    return db.all<{ total: number; embedded: number | null }>(sql`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN EXISTS (
          SELECT 1 FROM memory_embedding e
          WHERE e.owner_type = ${owner} AND e.owner_id = ${id} AND e.model_id = ${modelId ?? ''}
        ) THEN 1 ELSE 0 END) AS embedded
      FROM ${from}
      WHERE ${where}
    `)[0]
  }, { total: 0, embedded: 0 })
  return {
    embedded: modelId === null ? 0 : Number(row.embedded ?? 0),
    total: Number(row.total ?? 0),
  }
}

function partitions(db: EyasDb): MemoryEngineStatus['partitions'] {
  const rows = safeRow(() => db.all<{ scopeType: string; n: number }>(sql`
    SELECT p.scope_type AS scopeType, COUNT(DISTINCT p.project_key) AS n
    FROM memory_partition_key p
    WHERE EXISTS (
      SELECT 1 FROM memory_embedding e
      WHERE e.project_key = p.project_key AND e.live_in_index = 1
    )
    GROUP BY p.scope_type
  `), [])
  const count = (scope: string) => Number(rows.find((r) => r.scopeType === scope)?.n ?? 0)
  return { projects: count('project'), projectTypes: count('project_type') }
}

function lastRunAt(worker: ReturnType<MemoryEngineSources['worker']>): number | null {
  try {
    const at = worker?.status().lastRunAt
    return typeof at === 'number' && Number.isFinite(at) ? at : null
  } catch {
    return null
  }
}

function memoryConfig(config: unknown): {
  l0?: { enabled?: unknown; captureToolResults?: unknown; captureThinking?: unknown }
  index?: { budgetChars?: unknown }
} {
  const memory = (config as { memory?: unknown } | null | undefined)?.memory
  return memory && typeof memory === 'object' ? memory as ReturnType<typeof memoryConfig> : {}
}

export function readMemoryEngineStatus(src: MemoryEngineSources): MemoryEngineStatus {
  const config = src.config()
  const memory = memoryConfig(config)
  const includeSecrets = recallIncludesSecrets(config)
  const embedder = embedderOf(src.bridge())
  const modelId = embedder?.modelId ?? null

  let active = false
  try { active = src.captureActive() === true } catch { active = false }
  // memory.l0.enabled defaults to true (config/schema.ts); the ingest is wired
  // at start only, so a capture that did not start records nothing either way.
  const l0Enabled = active && memory.l0?.enabled !== false

  const budget = memory.index?.budgetChars
  return {
    embedder,
    l3: {
      gists: coverage(src.db, 'gist', modelId, includeSecrets),
      facts: coverage(src.db, 'fact', modelId, includeSecrets),
      lastRunAt: lastRunAt(src.worker()),
    },
    partitions: partitions(src.db),
    capture: {
      l0Enabled,
      toolResults: l0Enabled && memory.l0?.captureToolResults === true,
      thinking: l0Enabled && memory.l0?.captureThinking === true,
    },
    recall: {
      includeSecrets,
      indexBudgetChars: typeof budget === 'number' && Number.isFinite(budget) && budget > 0 ? budget : DEFAULT_MEMORY_RECALL_CHARS,
    },
  }
}
