// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

/**
 * Additive column migration, in the shape the rest of the codebase uses
 * (`memory/schema.ts`): asked of the table itself rather than inferred from a
 * failed `ALTER`, so an install that predates the column upgrades in place and
 * one that already has it is untouched.
 */
function addColumnIfMissing(db: EyasDb, table: string, column: string, ddl: string): void {
  const cols = (db as unknown as { all: (q: unknown) => Array<{ name: string }> }).all(
    sql.raw(`PRAGMA table_info(${table})`),
  )
  if (!cols.some((c) => c.name === column)) db.run(sql.raw(`ALTER TABLE ${table} ADD COLUMN ${ddl}`))
}

export function createDataPortTables(db: EyasDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS data_port_scans (
    id TEXT PRIMARY KEY,
    source_profile TEXT NOT NULL,
    detected_profile TEXT NOT NULL,
    root_path TEXT NOT NULL,
    candidates_json TEXT NOT NULL,
    stats_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    instructions TEXT,
    created_at TEXT NOT NULL
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS data_port_jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    source_profile TEXT NOT NULL,
    scan_id TEXT NOT NULL,
    selection_json TEXT NOT NULL,
    phase TEXT NOT NULL DEFAULT 'queued',
    progress REAL NOT NULL DEFAULT 0,
    stats_json TEXT NOT NULL,
    error TEXT,
    instructions TEXT,
    enrich INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  )`)

  // Best-effort migrations for existing installs
  try { db.run(sql`ALTER TABLE data_port_scans ADD COLUMN instructions TEXT`) } catch { /* exists */ }
  try { db.run(sql`ALTER TABLE data_port_jobs ADD COLUMN instructions TEXT`) } catch { /* exists */ }
  // The model pass is an explicit request, so an install that predates the
  // switch reads as "not asked for" rather than as "unset, do what you like".
  addColumnIfMissing(db, 'data_port_jobs', 'enrich', 'enrich INTEGER NOT NULL DEFAULT 0')

  db.run(sql`CREATE TABLE IF NOT EXISTS data_port_proposals (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    workspace_file TEXT NOT NULL,
    title TEXT NOT NULL,
    proposed_body TEXT NOT NULL,
    existing_body TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    resolved_at TEXT
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_data_port_jobs_status ON data_port_jobs(status)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_data_port_proposals_status ON data_port_proposals(status)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_data_port_proposals_job ON data_port_proposals(job_id)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS data_port_applied (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    source_path TEXT,
    sha256 TEXT,
    created_at TEXT NOT NULL
  )`)
  // The digest of what was written, so a rollback can tell an untouched import
  // from a note the owner has edited since. Nullable: a row written before this
  // column existed has no digest, and rollback then falls back to its tag check.
  addColumnIfMissing(db, 'data_port_applied', 'sha256', 'sha256 TEXT')
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_data_port_applied_job ON data_port_applied(job_id)`)

  // ── R11: one row per candidate, one row per directory ─────────────────
  db.run(sql`CREATE TABLE IF NOT EXISTS data_port_candidates (
    scan_id TEXT NOT NULL,
    id TEXT NOT NULL,
    seq INTEGER NOT NULL,              -- scan emission order; keyset cursor for the runner
    relative_path TEXT NOT NULL,
    classified_path TEXT,
    folder TEXT NOT NULL,              -- posix dirname, '.' at the root
    depth INTEGER NOT NULL,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    importable INTEGER NOT NULL,       -- target <> 'none'
    title TEXT NOT NULL,
    preview TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    confidence REAL NOT NULL,
    reason TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    reason_prefix TEXT NOT NULL,       -- 'directory-skipped' for 'directory-skipped:node_modules'
    selected_by_default INTEGER NOT NULL,
    search_text TEXT NOT NULL,         -- lower(relative_path || ' ' || title)
    scope TEXT,
    unit TEXT,
    turns INTEGER,
    session_id TEXT,
    session_date TEXT,
    adapter_id TEXT,
    source_path TEXT,                  -- absolute; NEVER returned by the API
    sha256 TEXT,
    mtime TEXT,
    birthtime TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    warnings_json TEXT NOT NULL DEFAULT '[]',
    directory_json TEXT,               -- {class, files, dirs, unreadable} on directory-skipped rows
    paths_json TEXT,
    assets_json TEXT,
    not_bundled_json TEXT,
    PRIMARY KEY (scan_id, id)
  )`)
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_dpc_scan_seq ON data_port_candidates(scan_id, seq)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_dpc_scan_path ON data_port_candidates(scan_id, relative_path, seq)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_dpc_scan_kind ON data_port_candidates(scan_id, kind, seq)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_dpc_scan_reason ON data_port_candidates(scan_id, reason_prefix, reason_code)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_dpc_scan_folder ON data_port_candidates(scan_id, folder, seq)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_dpc_scan_selected ON data_port_candidates(scan_id, importable, selected_by_default, seq)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_dpc_scan_source ON data_port_candidates(scan_id, source_path, seq)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS data_port_scan_dirs (
    scan_id TEXT NOT NULL,
    path TEXT NOT NULL,                -- '.' = root, posix, scan-relative
    parent TEXT,
    name TEXT NOT NULL,
    depth INTEGER NOT NULL,
    skipped_class TEXT,                -- NULL = entered; a DirectoryClass otherwise (D-9)
    file_count INTEGER NOT NULL,       -- direct files when entered; recursive count when skipped
    alias_of TEXT,                     -- realpath de-dupe: the path already mapped
    PRIMARY KEY (scan_id, path)
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_dpd_parent ON data_port_scan_dirs(scan_id, parent)`)

  // Scans: status and progress of a background scan, plus the blob format marker.
  // `format` 1 = candidates in `candidates_json` (pre-R11), 2 = rows in the table.
  addColumnIfMissing(db, 'data_port_scans', 'status', "status TEXT NOT NULL DEFAULT 'done'")
  addColumnIfMissing(db, 'data_port_scans', 'progress_json', 'progress_json TEXT')
  addColumnIfMissing(db, 'data_port_scans', 'scan_ms', 'scan_ms INTEGER')
  addColumnIfMissing(db, 'data_port_scans', 'finished_at', 'finished_at TEXT')
  addColumnIfMissing(db, 'data_port_scans', 'format', 'format INTEGER NOT NULL DEFAULT 1')
  addColumnIfMissing(db, 'data_port_scans', 'candidate_count', 'candidate_count INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'data_port_scans', 'counts_json', 'counts_json TEXT')

  // Jobs: the selection wire, the resume cursor, timing.
  addColumnIfMissing(db, 'data_port_jobs', 'selection_mode', "selection_mode TEXT NOT NULL DEFAULT 'ids'")
  addColumnIfMissing(db, 'data_port_jobs', 'selection_total', 'selection_total INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'data_port_jobs', 'cursor_seq', 'cursor_seq INTEGER NOT NULL DEFAULT -1')
  addColumnIfMissing(db, 'data_port_jobs', 'started_at', 'started_at TEXT')
  addColumnIfMissing(db, 'data_port_jobs', 'import_ms', 'import_ms INTEGER')
  addColumnIfMissing(db, 'data_port_jobs', 'resumed_count', 'resumed_count INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'data_port_jobs', 'elapsed_ms', 'elapsed_ms INTEGER NOT NULL DEFAULT 0')

  // Ledger: provenance for every kind (R11.6) and the digest lookups (R11.8).
  addColumnIfMissing(db, 'data_port_applied', 'adapter', 'adapter TEXT')
  addColumnIfMissing(db, 'data_port_applied', 'paths_json', 'paths_json TEXT')
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_data_port_applied_sha ON data_port_applied(kind, sha256)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_data_port_applied_kind_ref ON data_port_applied(kind, ref)`)
}
