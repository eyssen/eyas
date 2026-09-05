// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Sovereign layered memory — the v2 tables (spec §5 with the Phase 0
// corrections, spike §2 #7 and #21). Additive and idempotent: every
// statement is CREATE ... IF NOT EXISTS, nothing legacy is altered, and a
// re-run is a no-op. Three rules the whole design rests on:
//   1. ONE integer allocator (memory_item.rid) is shared by every typed row,
//      the contentless FTS rowid, the vec0 rowid and memory_tag.memory_rid —
//      ULIDs (id) are the sync identity, never the filter path.
//   2. Timestamps are INTEGER epoch milliseconds everywhere.
//   3. Deleting is a tombstone; the only physical deletes cascade from
//      memory_item, so rebuild/undo can clear a derived layer in one statement
//      and can never touch L0 by accident (item_type 'raw' is excluded there).

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities.js'

export const MEMORY_V2_SCHEMA_VERSION = '1'
export const EMBEDDING_DIMENSIONS = 384

export type MemoryItemType = 'raw' | 'fact' | 'gist' | 'entity' | 'embedding'
const ITEM_TYPES: readonly MemoryItemType[] = ['raw', 'fact', 'gist', 'entity', 'embedding']

/** Every regular table this module owns (the FTS and vec0 virtual tables are conditional). */
export const MEMORY_V2_TABLES = [
  'memory_meta', 'memory_item', 'memory_blob', 'memory_raw', 'memory_fact', 'memory_fact_archive',
  'memory_fact_source', 'memory_gist', 'memory_gist_source', 'memory_entity', 'memory_partition_key',
  'memory_embedding', 'memory_tag', 'memory_link', 'memory_run', 'memory_access_log', 'memory_dek',
  'memory_purge_log', 'memory_idf', 'share_scope', 'share_peer', 'share_grant', 'tombstone',
] as const

const TRUST_TIERS = "('owner','derived','ingested','peer','quarantined')"
const PRESENCE_TIERS = "('hot','warm','cold')"

/** Spec §5 `syncCols` + the surrogate key and the tombstone flag, shared by raw/fact/gist/entity. */
const SYNC_COLUMNS = `
    rid INTEGER PRIMARY KEY REFERENCES memory_item(rid) ON DELETE CASCADE,
    id TEXT NOT NULL UNIQUE,
    content_hash TEXT NOT NULL,
    origin_instance_id TEXT NOT NULL,
    hlc_physical_ms INTEGER NOT NULL,
    hlc_logical INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    tombstoned INTEGER NOT NULL DEFAULT 0`

/** memory_fact and memory_fact_archive share these (the archive adds archived_at). */
const FACT_COLUMNS = `${SYNC_COLUMNS},
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object_text TEXT NOT NULL,
    valid_from INTEGER,
    valid_until INTEGER,
    invalidated_by_fact_id TEXT,
    confidence REAL NOT NULL DEFAULT 0.5,
    trust_tier TEXT NOT NULL CHECK (trust_tier IN ${TRUST_TIERS}),
    extraction_run_id TEXT,
    entity_id TEXT,
    decay_score REAL NOT NULL DEFAULT 1.0,
    presence_tier TEXT NOT NULL DEFAULT 'hot' CHECK (presence_tier IN ${PRESENCE_TIERS}),
    archived INTEGER NOT NULL DEFAULT 0,
    facts_pending INTEGER NOT NULL DEFAULT 0`

function run(db: EyasDb, ddl: string): void {
  db.run(sql.raw(ddl))
}

function createCoreTables(db: EyasDb): void {
  run(db, `CREATE TABLE IF NOT EXISTS memory_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`)

  // The one allocator. AUTOINCREMENT so a deleted rid is never reused by a
  // later row (FTS/vec projections may still hold it until rebuilt).
  run(db, `CREATE TABLE IF NOT EXISTS memory_item (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    item_type TEXT NOT NULL CHECK (item_type IN ('raw','fact','gist','entity','embedding')),
    id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_item_type_created ON memory_item (item_type, created_at)`)

  // Content-addressed, deduplicated WITHIN a crypto-shred partition (spike §2 #21 iv).
  run(db, `CREATE TABLE IF NOT EXISTS memory_blob (
    content_hash TEXT NOT NULL,
    shred_partition_id TEXT NOT NULL,
    compressed_blob BLOB NOT NULL,
    byte_length INTEGER NOT NULL,
    ref_count INTEGER NOT NULL DEFAULT 1 CHECK (ref_count >= 0),
    PRIMARY KEY (content_hash, shred_partition_id)
  )`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_raw (${SYNC_COLUMNS},
    shred_partition_id TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('user_message','assistant_message','tool_result','document','r6_sync','legacy_episodic')),
    actor TEXT NOT NULL,
    conversation_id TEXT,
    project_id TEXT,
    project_type_id TEXT,
    occurred_at INTEGER NOT NULL,
    trust_tier TEXT NOT NULL CHECK (trust_tier IN ${TRUST_TIERS}),
    dek_id TEXT,
    meta_json TEXT
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_raw_conversation ON memory_raw (conversation_id, occurred_at)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_raw_project ON memory_raw (project_id, occurred_at)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_raw_blob ON memory_raw (content_hash, shred_partition_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_raw_source ON memory_raw (source_type, occurred_at)`)
  // p1d's rebuildFromL0 has a correlated subquery keyed on shred_partition_id alone
  // (MAX(occurred_at) per partition) — without a leading index that re-scans all of
  // memory_raw once per outer row. This index serves that equality and the MAX.
  // It does NOT turn the sibling `shred_partition_id LIKE 'vault:%'` predicate into a
  // range scan (SQLite only does that under COLLATE NOCASE or with GLOB, neither of
  // which this column has — a collation was deliberately not added here, since that
  // would change the cross-plan contract); LIKE still degrades to a covering-index
  // scan over this one column rather than a full row scan.
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_raw_partition ON memory_raw (shred_partition_id, occurred_at)`)
}

function createFactAndGistTables(db: EyasDb): void {
  run(db, `CREATE TABLE IF NOT EXISTS memory_fact (${FACT_COLUMNS})`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_fact_subject_predicate ON memory_fact (subject, predicate, valid_until)`)
  // p1c's supersede-arbitration query wraps both columns in lower() (case-insensitive
  // match), once per candidate fact on every extraction — SQLite cannot use the plain
  // index above for that predicate. Expression index alongside it, not instead of it:
  // the case-sensitive index above still serves p1d's ORDER BY f.subject.
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_fact_subject_predicate_ci ON memory_fact (lower(subject), lower(predicate))`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_fact_run ON memory_fact (extraction_run_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_fact_entity ON memory_fact (entity_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_fact_hash ON memory_fact (content_hash)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_fact_presence ON memory_fact (presence_tier, decay_score)`)

  // Same shape, off the hot path and off the default consolidation scan (spec §4 L1 retention).
  run(db, `CREATE TABLE IF NOT EXISTS memory_fact_archive (${FACT_COLUMNS},
    archived_at INTEGER NOT NULL
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_fact_archive_subject ON memory_fact_archive (subject, predicate)`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_fact_source (
    fact_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    PRIMARY KEY (fact_id, episode_id)
  ) WITHOUT ROWID`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_fact_source_episode ON memory_fact_source (episode_id)`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_gist (${SYNC_COLUMNS},
    scope_type TEXT NOT NULL CHECK (scope_type IN ('global','task','project','project_type','topic','era')),
    scope_id TEXT,
    tree_depth INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    structured_json TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    trust_tier TEXT NOT NULL CHECK (trust_tier IN ${TRUST_TIERS}),
    token_count INTEGER NOT NULL DEFAULT 0,
    importance_score REAL NOT NULL DEFAULT 0.5,
    gist_source TEXT NOT NULL CHECK (gist_source IN ('heuristic','model')),
    consolidation_run_id TEXT,
    supersedes_gist_id TEXT,
    superseded_by_gist_id TEXT,
    is_current INTEGER NOT NULL DEFAULT 1,
    decay_score REAL NOT NULL DEFAULT 1.0,
    presence_tier TEXT NOT NULL DEFAULT 'hot' CHECK (presence_tier IN ${PRESENCE_TIERS}),
    alternate_of_gist_id TEXT,
    multi_project INTEGER NOT NULL DEFAULT 0,
    times_retrieved INTEGER NOT NULL DEFAULT 0,
    changelog_json TEXT
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_gist_scope ON memory_gist (scope_type, scope_id, is_current)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_gist_pinned ON memory_gist (scope_type, is_current) WHERE pinned = 1`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_gist_run ON memory_gist (consolidation_run_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_gist_presence ON memory_gist (presence_tier, decay_score)`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_gist_source (
    gist_id TEXT NOT NULL,
    child_type TEXT NOT NULL CHECK (child_type IN ('raw','fact','gist','entity')),
    child_id TEXT NOT NULL,
    PRIMARY KEY (gist_id, child_type, child_id)
  ) WITHOUT ROWID`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_gist_source_child ON memory_gist_source (child_type, child_id)`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_entity (${SYNC_COLUMNS},
    canonical_name TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    merged_into_entity_id TEXT
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_entity_name ON memory_entity (canonical_name)`)
  // Serves an equality lookup on lower(canonical_name). NOT used by p1c's current
  // entity-resolution query as written: that query ORs the canonical_name match with a
  // correlated json_each() subquery over aliases_json, and SQLite cannot satisfy an OR
  // across a plain expression index and an unindexed correlated subquery — it falls back
  // to a full table scan regardless of this index. It becomes useful once p1c's query is
  // rewritten as a UNION ALL of two indexable branches (name match; alias match). Kept
  // here (harmless write cost) because that rewrite is p1c's to make, not p1a's.
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_entity_name_ci ON memory_entity (lower(canonical_name))`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_entity_type_name ON memory_entity (entity_type, canonical_name)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_entity_merged ON memory_entity (merged_into_entity_id)`)
}

function createIndexLayerTables(db: EyasDb, caps: SqliteCapabilities): void {
  // vec0 partitions are INTEGER; projects and project types are ULIDs. 0 = global.
  run(db, `CREATE TABLE IF NOT EXISTS memory_partition_key (
    project_key INTEGER PRIMARY KEY AUTOINCREMENT,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('project','project_type')),
    scope_id TEXT NOT NULL,
    UNIQUE (scope_type, scope_id)
  )`)

  // int8 vectors of facts, gists and entity names only — never raw text (spec §4 L3).
  run(db, `CREATE TABLE IF NOT EXISTS memory_embedding (
    rid INTEGER PRIMARY KEY REFERENCES memory_item(rid) ON DELETE CASCADE,
    id TEXT NOT NULL UNIQUE,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('fact','gist','entity')),
    owner_id TEXT NOT NULL,
    owner_rid INTEGER NOT NULL,
    model_id TEXT NOT NULL,
    dimensions INTEGER NOT NULL DEFAULT ${EMBEDDING_DIMENSIONS},
    vector BLOB NOT NULL,
    project_key INTEGER NOT NULL DEFAULT 0,
    live_in_index INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    UNIQUE (owner_type, owner_id, model_id)
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_embedding_live ON memory_embedding (live_in_index, project_key)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_embedding_owner_rid ON memory_embedding (owner_rid)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_embedding_model ON memory_embedding (model_id)`)

  if (caps.vec0) {
    // rowid = memory_embedding.rid; rebuildable from memory_embedding.vector (Phase 2 populates it).
    try {
      run(db, `CREATE VIRTUAL TABLE IF NOT EXISTS memory_embedding_vec USING vec0(
        project_key INTEGER PARTITION KEY,
        embedding int8[${EMBEDDING_DIMENSIONS}]
      )`)
    } catch (err) {
      throw new Error(
        `memory_embedding_vec could not be created although caps.vec0 is true — sqlite-vec is not loaded on THIS connection; `
        + `probe it first with probeSqliteCapabilities(rawHandle) (${String(err)})`,
      )
    }
  }

  run(db, `CREATE TABLE IF NOT EXISTS memory_tag (
    memory_rid INTEGER NOT NULL REFERENCES memory_item(rid) ON DELETE CASCADE,
    memory_type TEXT NOT NULL CHECK (memory_type IN ('raw','fact','gist','entity','embedding')),
    tag_type TEXT NOT NULL CHECK (tag_type IN ('project','project_type','task','kind','entity','topic','source_type','language','trust_tier','layer')),
    tag_value TEXT NOT NULL,
    PRIMARY KEY (memory_rid, tag_type, tag_value)
  ) WITHOUT ROWID`)
  // The covering index every filtered read uses (`+rowid IN (SELECT memory_rid FROM memory_tag ...)`).
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_tag_lookup ON memory_tag (tag_type, tag_value, memory_type, memory_rid)`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_idf (
    stem TEXT PRIMARY KEY,
    df INTEGER NOT NULL
  ) WITHOUT ROWID`)
}

function createProvenanceTables(db: EyasDb): void {
  run(db, `CREATE TABLE IF NOT EXISTS memory_link (
    id TEXT PRIMARY KEY,
    from_type TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_type TEXT NOT NULL,
    to_id TEXT NOT NULL,
    link_type TEXT NOT NULL CHECK (link_type IN ('derived_from','supersedes','invalidates','part_of','merged_into','alternate_of','migrated_from')),
    run_id TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (from_type, from_id, to_type, to_id, link_type)
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_link_from ON memory_link (from_type, from_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_link_to ON memory_link (to_type, to_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_link_run ON memory_link (run_id)`)

  // memory_capture_runs widened (spec §5): a skip writes a row too.
  run(db, `CREATE TABLE IF NOT EXISTS memory_run (
    id TEXT PRIMARY KEY,
    run_type TEXT NOT NULL CHECK (run_type IN ('extraction','consolidation_light','consolidation_heavy','migration')),
    status TEXT NOT NULL CHECK (status IN ('ok','partial','failed','skipped','degraded_no_model')),
    conversation_id TEXT,
    model_used TEXT,
    prompt_template_hash TEXT,
    raw_model_output_hash TEXT,
    rejected_candidate_count INTEGER NOT NULL DEFAULT 0,
    quarantined_candidate_count INTEGER NOT NULL DEFAULT 0,
    model_calls_used INTEGER NOT NULL DEFAULT 0,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL,
    duration_api_ms INTEGER,
    provider_version TEXT,
    stats_json TEXT,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_run_type_created ON memory_run (run_type, created_at)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_run_conversation ON memory_run (conversation_id, created_at)`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    actor TEXT NOT NULL CHECK (actor IN ('system_index','model_drilldown','user_ui')),
    memory_type TEXT NOT NULL,
    memory_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('inject','drilldown_read','edit','tombstone','crypto_shred','purge')),
    context_task_id TEXT,
    tokens_estimate INTEGER,
    rank_detail_json TEXT
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_access_log_ts ON memory_access_log (ts)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_access_log_memory ON memory_access_log (memory_type, memory_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_access_log_task ON memory_access_log (context_task_id, ts)`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_dek (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    wrapped_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    destroyed_at INTEGER,
    UNIQUE (scope, scope_id)
  )`)

  // Survives every purge: kept outside every table it describes (spec §11).
  run(db, `CREATE TABLE IF NOT EXISTS memory_purge_log (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    reason TEXT NOT NULL,
    purged_by TEXT NOT NULL,
    purged_at INTEGER NOT NULL,
    details_json TEXT
  )`)
}

/** R6 scaffolding (spec §12): present and empty; a solo instance is L4 with an empty peer set. */
function createShareTables(db: EyasDb): void {
  run(db, `CREATE TABLE IF NOT EXISTS share_scope (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('project','tag')),
    scope_value TEXT NOT NULL,
    sync_gists INTEGER NOT NULL DEFAULT 0,
    hmac_key_id TEXT,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER,
    UNIQUE (scope_type, scope_value)
  )`)
  run(db, `CREATE TABLE IF NOT EXISTS share_peer (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL UNIQUE,
    public_key TEXT,
    last_ack_hlc INTEGER,
    presumed_gone_at INTEGER,
    created_at INTEGER NOT NULL
  )`)
  run(db, `CREATE TABLE IF NOT EXISTS share_grant (
    id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES share_scope(id),
    peer_id TEXT NOT NULL REFERENCES share_peer(id),
    token_id TEXT,
    issued_by_instance_id TEXT NOT NULL,
    expires_at INTEGER,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_share_grant_scope_peer ON share_grant (scope_id, peer_id)`)
  run(db, `CREATE TABLE IF NOT EXISTS tombstone (
    id TEXT PRIMARY KEY,
    entity_table TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    reason TEXT,
    hlc_physical_ms INTEGER NOT NULL,
    hlc_logical INTEGER NOT NULL DEFAULT 0,
    compacted_at INTEGER,
    created_at INTEGER NOT NULL
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_tombstone_entity ON tombstone (entity_table, entity_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_tombstone_compacted ON tombstone (compacted_at)`)
}

/**
 * Contentless FTS5 over L0 text (spec §5), rowid = memory_raw.rid, populated at flush.
 *
 * Only called under `if (caps.fts5)`: the probe (sqlite-capabilities.ts)
 * already created and queried a table with exactly this tokenizer on this
 * same SQLite build before caps.fts5 could be true, so a tokenizer fallback
 * here is unreachable dead code — and dead error-handling that would
 * silently swap `memory_raw_fts` to a diacritic-sensitive tokenizer (while
 * `vault_fts` and friends stay diacritic-insensitive) is worse than none.
 * `fts_tokenizer` is still recorded, matching what the probe verified.
 */
function createRawFts(db: EyasDb): void {
  run(db, `CREATE VIRTUAL TABLE IF NOT EXISTS memory_raw_fts USING fts5(
    body,
    content='',
    tokenize='unicode61 remove_diacritics 2'
  )`)
  setMemoryMeta(db, 'fts_tokenizer', 'unicode61 remove_diacritics 2')
}

export function createMemoryV2Tables(db: EyasDb, caps: SqliteCapabilities): void {
  createCoreTables(db)
  createFactAndGistTables(db)
  createIndexLayerTables(db, caps)
  createProvenanceTables(db)
  createShareTables(db)
  if (caps.fts5) createRawFts(db)
  db.run(sql`INSERT OR IGNORE INTO memory_meta (key, value) VALUES ('schema_version', ${MEMORY_V2_SCHEMA_VERSION})`)
}

/**
 * Reserve the integer surrogate for a ULID. Idempotent: an id that is
 * already allocated returns its existing rid (INSERT OR IGNORE — what makes
 * the migration re-runnable); the same id under another type is a bug.
 */
export function allocateRid(db: EyasDb, itemType: MemoryItemType, id: string, createdAt: number): number {
  // OR IGNORE also ignores CHECK violations, so the vocabulary is enforced here.
  if (!ITEM_TYPES.includes(itemType)) throw new RangeError(`allocateRid: invalid item_type '${String(itemType)}'`)
  db.run(sql`INSERT OR IGNORE INTO memory_item (item_type, id, created_at) VALUES (${itemType}, ${id}, ${createdAt})`)
  const row = db.all<{ rid: number; item_type: string }>(sql`SELECT rid, item_type FROM memory_item WHERE id = ${id}`)[0]
  if (!row) throw new Error(`allocateRid: memory_item row for ${id} is missing after insert`)
  if (row.item_type !== itemType) {
    throw new Error(`allocateRid: ${id} is already allocated as '${row.item_type}', not '${itemType}'`)
  }
  return row.rid
}

export function findRid(db: EyasDb, id: string): number | null {
  return db.all<{ rid: number }>(sql`SELECT rid FROM memory_item WHERE id = ${id}`)[0]?.rid ?? null
}

export function getMemoryMeta(db: EyasDb, key: string): string | null {
  return db.all<{ value: string }>(sql`SELECT value FROM memory_meta WHERE key = ${key}`)[0]?.value ?? null
}

export function setMemoryMeta(db: EyasDb, key: string, value: string): void {
  db.run(sql`INSERT INTO memory_meta (key, value) VALUES (${key}, ${value})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
}
