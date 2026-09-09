// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// EYAS v1 prompt column drop — DESTRUCTIVE, run only after verifying migration.
//
// Drops the v1 columns from agent_definitions and the prompt_templates table.
// This is a one-way operation. The DB backup is the only safety net.
//
// USAGE:
//   bun run scripts/migrate-prompts-v2-drop-cols.ts --yes
//
// PRE-CONDITIONS (all must pass or the script aborts):
//   1. DB exists
//   2. Every agent_definitions row has a non-null workspace_path (all migrated)
//   3. data/agents/ directory exists (sanity check that workspace files are in place)
//
// COLUMNS DROPPED:
//   agent_definitions: role, goal, backstory, system_prompt, capabilities, tools, constraints
//   Tables dropped: prompt_templates
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { loadConfig } from '../src/core/config/loader.js'

const DEFAULT_DATA_DIR = 'data'

// V1 columns to drop from agent_definitions
const V1_COLUMNS = ['role', 'goal', 'backstory', 'system_prompt', 'capabilities', 'tools', 'constraints'] as const

// ─── CLI argument parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[]): { yes: boolean } {
  const args = argv.slice(2)
  return { yes: args.includes('--yes') }
}

// ─── Core drop logic (exported for testing) ───────────────────────────────────

// BunSQLiteDatabase<Record<string, never>> is the zero-schema variant returned
// by `drizzle(sqlite)` without a schema object. Tests cast their instance via
// `db as never` to satisfy this signature (same pattern as cascade-migration tests).
export async function dropV1Columns(db: BunSQLiteDatabase): Promise<void> {
  // Pre-flight: check for any un-migrated agents.
  const unmigrated = db.all(
    sql`SELECT id FROM agent_definitions WHERE workspace_path IS NULL`,
  ) as Array<{ id: string }>
  if (unmigrated.length > 0) {
    const ids = unmigrated.map((r) => r.id).join(', ')
    throw new Error(
      `${unmigrated.length} row(s) still on v1 (workspace_path IS NULL): ${ids}\n` +
        'Run `eyas migrate run` (or `bun run scripts/migrate-prompts-v2.ts`) first.',
    )
  }

  // Drop v1 columns — SQLite 3.35+ (bun:sqlite ships this).
  for (const col of V1_COLUMNS) {
    db.run(sql.raw(`ALTER TABLE agent_definitions DROP COLUMN ${col}`))
  }

  // Drop the legacy prompt_templates table (if it exists — may not on fresh installs).
  db.run(sql`DROP TABLE IF EXISTS prompt_templates`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<void> {
  const { yes } = parseArgs(argv)

  if (!yes) {
    console.error('[drop-cols] Refusing to run without --yes flag.')
    console.error('  This operation is IRREVERSIBLE. Add --yes to proceed.')
    process.exit(1)
  }

  const config = loadConfig('config/default.yaml')
  const dbPath = config.database.path
  const dataDir = DEFAULT_DATA_DIR

  // Pre-flight 1: DB must exist
  if (!existsSync(dbPath)) {
    throw new Error(`db not found: ${dbPath}`)
  }

  // Pre-flight 2: data/agents/ must exist
  const agentsDir = join(dataDir, 'agents')
  if (!existsSync(agentsDir)) {
    throw new Error(
      `${agentsDir} does not exist — no workspace data found. ` +
        'Refusing to drop columns before confirming workspace files are in place. ' +
        'Run `eyas migrate run` first.',
    )
  }

  // Backup
  const bak = `${dbPath}.pre-drop-cols.bak`
  copyFileSync(dbPath, bak)
  console.log(`[drop-cols] backed up db → ${bak}`)

  const sqlite = new Database(dbPath)
  const db = drizzle(sqlite)

  await dropV1Columns(db)

  console.log(`[drop-cols] dropped columns: ${V1_COLUMNS.join(', ')}`)
  console.log('[drop-cols] dropped table: prompt_templates')
  console.log('[drop-cols] complete')

  sqlite.close()
}

// Only auto-run when this file is the entry point (not when imported by tests or CLI).
if (import.meta.main) {
  main(process.argv).catch((err) => {
    console.error('[drop-cols] failed:', err)
    process.exit(1)
  })
}
