// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// EYAS v1 → v2 prompt migration rollback.
//
// Restores agent_definitions rows from the pre-migration snapshot table and
// clears the workspace_path / addressable v2 columns.
//
// USAGE:
//   bun run scripts/migrate-prompts-v2-rollback.ts
//   bun run scripts/migrate-prompts-v2-rollback.ts --remove-files
//
// SAFETY:
//   - Requires the snapshot table to exist and contain rows (refuses to run otherwise)
//   - --remove-files deletes data/agents/ — use with caution
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { loadConfig } from '../src/core/config/loader.js'

const DEFAULT_DATA_DIR = 'data'

// ─── Rollback snapshot row shape ─────────────────────────────────────────────

interface SnapshotRow {
  id: string
  data: string
  snapshot_at: string
}

// ─── CLI argument parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[]): { removeFiles: boolean } {
  const args = argv.slice(2)
  const removeFiles = args.includes('--remove-files')
  return { removeFiles }
}

// ─── Core rollback logic (exported for testing) ───────────────────────────────

// BunSQLiteDatabase<Record<string, never>> is the zero-schema variant returned
// by `drizzle(sqlite)` without a schema object. Tests cast their instance via
// `db as never` to satisfy this signature (same pattern as cascade-migration tests).
export async function restoreFromSnapshot(db: BunSQLiteDatabase): Promise<number> {
  // Check that the snapshot table exists and has rows.
  const tableCheck = db.all(
    sql`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_definitions_v1_snapshot'`,
  ) as Array<{ name: string }>
  if (tableCheck.length === 0) {
    throw new Error(
      'agent_definitions_v1_snapshot table does not exist. ' +
        'Run `migrate run` first (it creates the snapshot), then retry rollback.',
    )
  }

  const snapshots = db.all(
    sql`SELECT * FROM agent_definitions_v1_snapshot`,
  ) as SnapshotRow[]
  if (snapshots.length === 0) {
    throw new Error('Snapshot table exists but contains no rows — nothing to restore.')
  }

  for (const snap of snapshots) {
    const v1 = JSON.parse(snap.data) as Record<string, unknown>

    // Restore all v1 columns and clear the v2 workspace fields.
    db.run(sql`UPDATE agent_definitions SET
      role          = ${(v1.role as string | null) ?? null},
      goal          = ${(v1.goal as string | null) ?? null},
      backstory     = ${(v1.backstory as string | null) ?? null},
      system_prompt = ${(v1.systemPrompt as string | null) ?? null},
      capabilities  = ${(v1.capabilities as string | null) ?? null},
      tools         = ${(v1.tools as string | null) ?? null},
      constraints   = ${(v1.constraints as string | null) ?? null},
      workspace_path = NULL,
      addressable    = 0
    WHERE id = ${snap.id}`)
  }

  return snapshots.length
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<void> {
  const { removeFiles } = parseArgs(argv)

  const config = loadConfig('config/default.yaml')
  const dbPath = config.database.path
  const dataDir = DEFAULT_DATA_DIR

  if (!existsSync(dbPath)) {
    throw new Error(`db not found: ${dbPath}`)
  }

  const sqlite = new Database(dbPath)
  const db = drizzle(sqlite)

  const restoredCount = await restoreFromSnapshot(db)
  console.log(`[rollback] restored ${restoredCount} agent rows from snapshot`)

  if (removeFiles) {
    const agentsDir = join(dataDir, 'agents')
    if (!existsSync(agentsDir)) {
      sqlite.close()
      throw new Error(
        `--remove-files: ${agentsDir} does not exist — refusing silent no-op. ` +
          'Omit --remove-files if no workspace files were written.',
      )
    }
    rmSync(agentsDir, { recursive: true, force: true })
    console.log(`[rollback] removed ${agentsDir}`)
  }

  console.log('[rollback] complete')
  sqlite.close()
}

// Only auto-run when this file is the entry point (not when imported by tests or CLI).
if (import.meta.main) {
  main(process.argv).catch((err) => {
    console.error('[rollback] failed:', err)
    process.exit(1)
  })
}
