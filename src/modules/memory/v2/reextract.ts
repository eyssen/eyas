// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// After extractDeterministic learned to mint `states` facts for imported
// document / legacy_episodic rows, conversations that were already extracted
// sit above their watermark with zero facts. `reason='rebuild'` ignores the
// watermark (extractor.ts) so a one-shot pass fills L1 without rewriting L0.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import { runExtraction, type ExtractionConfig } from './extractor.js'

export interface ReextractDeps {
  db: EyasDb
  logger: Logger
  config: () => ExtractionConfig
}

export interface ReextractResult {
  conversations: number
  ok: number
  failed: number
}

const BATCH = 8

export async function reextractMissingImportedFacts(deps: ReextractDeps): Promise<ReextractResult> {
  const rows = (deps.db as any).all(sql`
    SELECT DISTINCT r.conversation_id AS conversation_id
    FROM memory_raw r
    WHERE r.tombstoned = 0
      AND r.source_type IN ('document', 'legacy_episodic')
      AND r.conversation_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM memory_fact_source s
        JOIN memory_fact f ON f.id = s.fact_id
        WHERE s.episode_id = r.id AND f.tombstoned = 0
      )
  `) as Array<{ conversation_id: string }>

  const out: ReextractResult = { conversations: rows.length, ok: 0, failed: 0 }
  for (let i = 0; i < rows.length; i++) {
    const id = rows[i].conversation_id
    const result = runExtraction(deps.db, id, 'rebuild', {
      logger: deps.logger,
      config: deps.config,
    })
    if (result.status === 'ok') out.ok++
    else if (result.status === 'failed') out.failed++
    if ((i + 1) % 64 === 0) {
      deps.logger.info({ done: i + 1, total: rows.length, ok: out.ok, failed: out.failed }, 'L1 reextract progress')
    }
    if ((i + 1) % BATCH === 0) await new Promise<void>((r) => setTimeout(r, 0))
  }
  return out
}
