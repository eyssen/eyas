// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

/**
 * Creates the three tables backing the artifacts module:
 *   - artifacts             : one row per logical artifact
 *   - artifact_versions     : append-only payload history, unique on (artifact_id, version)
 *   - artifact_refs         : directed edges between artifacts (typed relationships)
 */
export function createArtifactTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    current_version INTEGER NOT NULL DEFAULT 1,
    produced_by TEXT,
    consumed_by TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON artifacts(kind)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS artifact_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    created_by TEXT,
    change_note TEXT,
    UNIQUE(artifact_id, version)
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact ON artifact_versions(artifact_id)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS artifact_refs (
    from_artifact TEXT NOT NULL REFERENCES artifacts(id),
    to_artifact TEXT NOT NULL REFERENCES artifacts(id),
    ref_type TEXT NOT NULL,
    PRIMARY KEY (from_artifact, to_artifact, ref_type)
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_artifact_refs_to ON artifact_refs(to_artifact)`)
}
