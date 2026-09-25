// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The memory_raw table exactly as schema version '1' created it (before
// 'thinking' joined the source_type CHECK). Tests downgrade a current database
// to this shape to exercise migrateMemoryV2Schema on a realistic v1 file.

import { sql } from 'drizzle-orm'

export const V1_MEMORY_RAW_DDL = `CREATE TABLE memory_raw (
    rid INTEGER PRIMARY KEY REFERENCES memory_item(rid) ON DELETE CASCADE,
    id TEXT NOT NULL UNIQUE,
    content_hash TEXT NOT NULL,
    origin_instance_id TEXT NOT NULL,
    hlc_physical_ms INTEGER NOT NULL,
    hlc_logical INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    tombstoned INTEGER NOT NULL DEFAULT 0,
    shred_partition_id TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('user_message','assistant_message','tool_result','document','r6_sync','legacy_episodic')),
    actor TEXT NOT NULL,
    conversation_id TEXT,
    project_id TEXT,
    project_type_id TEXT,
    occurred_at INTEGER NOT NULL,
    trust_tier TEXT NOT NULL CHECK (trust_tier IN ('owner','derived','ingested','peer','quarantined')),
    dek_id TEXT,
    meta_json TEXT
  )`

const V1_RAW_INDEXES = [
  'CREATE INDEX idx_memory_raw_conversation ON memory_raw (conversation_id, occurred_at)',
  'CREATE INDEX idx_memory_raw_project ON memory_raw (project_id, occurred_at)',
  'CREATE INDEX idx_memory_raw_blob ON memory_raw (content_hash, shred_partition_id)',
  'CREATE INDEX idx_memory_raw_source ON memory_raw (source_type, occurred_at)',
  'CREATE INDEX idx_memory_raw_partition ON memory_raw (shred_partition_id, occurred_at)',
]

export const RAW_INDEX_NAMES = [
  'idx_memory_raw_blob', 'idx_memory_raw_conversation', 'idx_memory_raw_partition', 'idx_memory_raw_project', 'idx_memory_raw_source',
]

/**
 * Replace a still-empty current memory_raw with the v1 table and mark the
 * database as schema version '1'. Call it before any raw row is written.
 */
export function downgradeToV1(db: any): void {
  db.run(sql.raw('DROP TABLE memory_raw'))
  db.run(sql.raw(V1_MEMORY_RAW_DDL))
  for (const ddl of V1_RAW_INDEXES) db.run(sql.raw(ddl))
  db.run(sql`UPDATE memory_meta SET value = '1' WHERE key = 'schema_version'`)
}

export function storedRawDdl(db: any): string {
  return (db.all(sql`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_raw'`) as Array<{ sql: string }>)[0]?.sql ?? ''
}

export function rawIndexNames(db: any): string[] {
  return (db.all(sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'memory_raw' AND name LIKE 'idx_%' ORDER BY name`) as Array<{ name: string }>)
    .map((r) => r.name)
}
