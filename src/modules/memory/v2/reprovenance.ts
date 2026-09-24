// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// One-shot: give the vault notes already in L0 the provenance they should
// have had (W8). migrate-imported.ts used to write every note as trust 'owner'
// with no project, so a note a model wrote minted owner-trust facts and a
// project note's facts became global memory. New notes now carry the trust
// and scope of their vault_index row; this pass fixes the old ones:
//   1. every live L0 row of a note ('vault:<path>') takes the note's stored
//      trust, project and project type (a row already quarantined stays
//      quarantined — this pass never raises trust);
//   2. the facts and gists derived from that note are tombstoned;
//   3. runExtraction(…, 'rebuild') re-derives them under the right trust and
//      project tags.
// All three happen in ONE transaction per note, so a failure leaves that note
// exactly as it was and it is retried at the next start. The BEGIN sits
// outside the try for the reason ingest.ts documents; runExtraction detects
// the open transaction and works inside a savepoint of its own.
// Keyed by memory_meta 'vault_provenance_v1', set only when every note was
// handled. Idempotent even without the key: a note whose rows already match
// is left alone. Vectors of tombstoned rows are retired by the L3 worker.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import { getMemoryMeta, setMemoryMeta } from './schema.js'
import { nextHlc } from './ingest.js'
import { runExtraction, type ExtractionConfig } from './extractor.js'
import { vaultConversationId } from './migrate-imported.js'
import type { TrustTier } from './ingest-bridge.js'
import { effectiveProjectId } from '../types.js'

export const VAULT_PROVENANCE_META_KEY = 'vault_provenance_v1'
export const VAULT_PROVENANCE_VERSION = '1'
/** Notes re-derived between two yields to the event loop. */
const YIELD_EVERY = 8

export interface VaultReprovenanceDeps {
  db: EyasDb
  logger: Logger
  /** Read per call, like every extraction trigger. */
  config: () => ExtractionConfig
}

export interface VaultReprovenanceResult {
  /** vault_index rows examined. */
  notes: number
  /** Notes whose L0 rows were corrected and re-derived. */
  fixed: number
  /** Notes left as they were (rolled back); retried at the next start. */
  failed: number
  /** Already done on an earlier start. */
  skipped: boolean
}

interface IndexRow {
  path: string
  trust_tier: string
  project_id: string | null
  project_type_id: string | null
}

interface RawRow {
  rid: number
  trust_tier: TrustTier
  project_id: string | null
  project_type_id: string | null
}

interface Target {
  trust: TrustTier
  projectId: string | null
  projectTypeId: string | null
}

/** A quarantined row stays quarantined; otherwise the note's own trust. */
function targetTrust(row: RawRow, target: Target): TrustTier {
  return row.trust_tier === 'quarantined' ? 'quarantined' : target.trust
}

function rowMatches(row: RawRow, target: Target): boolean {
  return row.trust_tier === targetTrust(row, target)
    && (row.project_id ?? null) === target.projectId
    && (row.project_type_id ?? null) === target.projectTypeId
}

function retag(db: EyasDb, rid: number, tagType: 'project' | 'project_type' | 'trust_tier', value: string | null): void {
  db.run(sql`DELETE FROM memory_tag WHERE memory_rid = ${rid} AND memory_type = 'raw' AND tag_type = ${tagType}`)
  if (value) {
    db.run(sql`INSERT OR IGNORE INTO memory_tag (memory_rid, memory_type, tag_type, tag_value)
      VALUES (${rid}, 'raw', ${tagType}, ${value})`)
  }
}

/** Steps 1–2 for one note, inside the caller's transaction. */
function correctNote(db: EyasDb, conversationId: string, rows: RawRow[], target: Target): void {
  const now = Date.now()
  for (const row of rows) {
    const trust = targetTrust(row, target)
    // A change to a syncable row carries new sync metadata (as arbitrate's closures do).
    const hlc = nextHlc(now)
    db.run(sql`UPDATE memory_raw SET trust_tier = ${trust}, project_id = ${target.projectId},
        project_type_id = ${target.projectTypeId}, revision = revision + 1,
        hlc_physical_ms = ${hlc.physicalMs}, hlc_logical = ${hlc.logical}
      WHERE rid = ${row.rid}`)
    retag(db, row.rid, 'project', target.projectId)
    retag(db, row.rid, 'project_type', target.projectTypeId)
    retag(db, row.rid, 'trust_tier', trust)
  }
  const factHlc = nextHlc(now)
  db.run(sql`UPDATE memory_fact SET tombstoned = 1, revision = revision + 1,
      hlc_physical_ms = ${factHlc.physicalMs}, hlc_logical = ${factHlc.logical}
    WHERE tombstoned = 0 AND rid IN (SELECT t.memory_rid FROM memory_tag t
      WHERE t.memory_type = 'fact' AND t.tag_type = 'task' AND t.tag_value = ${conversationId})`)
  const gistHlc = nextHlc(now)
  db.run(sql`UPDATE memory_gist SET tombstoned = 1, is_current = 0, revision = revision + 1,
      hlc_physical_ms = ${gistHlc.physicalMs}, hlc_logical = ${gistHlc.logical}
    WHERE tombstoned = 0 AND scope_type = 'task' AND scope_id = ${conversationId}`)
}

export async function runVaultReprovenance(deps: VaultReprovenanceDeps): Promise<VaultReprovenanceResult> {
  const { db, logger } = deps
  if (getMemoryMeta(db, VAULT_PROVENANCE_META_KEY) === VAULT_PROVENANCE_VERSION) {
    return { notes: 0, fixed: 0, failed: 0, skipped: true }
  }
  const out: VaultReprovenanceResult = { notes: 0, fixed: 0, failed: 0, skipped: false }
  // Only notes whose trust the indexer derived; one it could not read keeps its rows.
  const notes = db.all<IndexRow>(sql`SELECT path, trust_tier, project_id, project_type_id
    FROM vault_index WHERE trust_tier IS NOT NULL ORDER BY path`)
  for (const note of notes) {
    out.notes++
    const conversationId = vaultConversationId(note.path)
    const target: Target = {
      trust: note.trust_tier as TrustTier,
      projectId: effectiveProjectId(note.project_id ?? null),
      projectTypeId: note.project_type_id ?? null,
    }
    const rows = db.all<RawRow>(sql`SELECT rid, trust_tier, project_id, project_type_id FROM memory_raw
      WHERE conversation_id = ${conversationId} AND source_type = 'document' AND tombstoned = 0`)
    if (rows.length === 0 || rows.every((r) => rowMatches(r, target))) continue

    // BEGIN MUST STAY OUTSIDE THE try (ingest.ts): a failed BEGIN has nothing
    // of ours to roll back, and must not roll back anyone else's work.
    try {
      db.run(sql`BEGIN IMMEDIATE`)
    } catch (err) {
      out.failed++
      logger.warn({ err, path: note.path }, 'vault provenance: no transaction; the note is retried at the next start')
      continue
    }
    try {
      correctNote(db, conversationId, rows, target)
      const extraction = runExtraction(db, conversationId, 'rebuild', { logger, config: deps.config })
      if (extraction.status === 'failed') throw new Error('re-extraction failed')
      db.run(sql`COMMIT`)
      out.fixed++
    } catch (err) {
      try { db.run(sql`ROLLBACK`) } catch { /* the transaction may already be gone */ }
      out.failed++
      logger.warn({ err, path: note.path }, 'vault provenance: note left unchanged; it is retried at the next start')
    }
    if (out.fixed > 0 && out.fixed % YIELD_EVERY === 0) await new Promise<void>((r) => setTimeout(r, 0))
  }
  if (out.failed === 0) setMemoryMeta(db, VAULT_PROVENANCE_META_KEY, VAULT_PROVENANCE_VERSION)
  return out
}
