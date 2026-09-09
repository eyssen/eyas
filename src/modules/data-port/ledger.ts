// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'

export type AppliedKind = 'vault' | 'episodic' | 'skill' | 'skill-assets' | 'agent' | 'proposal'

export interface AppliedRow {
  id: string
  jobId: string
  kind: AppliedKind
  ref: string
  sourcePath: string | null
  /**
   * sha256 of the verbatim content this import wrote, for EVERY kind: vault and
   * episodic = the body handed to the writer; skill = the assembled skill
   * content; skill-assets = the package digest that named the asset directory;
   * agent = the system prompt; proposal = the proposed body. `null` only on a
   * row written before the column existed.
   */
  sha256: string | null
  /** The adapter that read the item (R11.6). */
  adapter: string | null
  /** Every path the content was found at; empty on a pre-R11 row. */
  paths: string[]
  createdAt: string
}

export function recordApplied(
  db: EyasDb,
  input: {
    jobId: string; kind: AppliedKind; ref: string; sourcePath?: string | null; sha256?: string | null
    adapter?: string | null; paths?: string[] | null
  },
): string {
  const id = generateId()
  db.run(sql`INSERT INTO data_port_applied (id, job_id, kind, ref, source_path, sha256, adapter, paths_json, created_at)
    VALUES (${id}, ${input.jobId}, ${input.kind}, ${input.ref}, ${input.sourcePath ?? null}, ${input.sha256 ?? null},
            ${input.adapter ?? null}, ${input.paths?.length ? JSON.stringify(input.paths) : null}, ${new Date().toISOString()})`)
  return id
}

export function listApplied(db: EyasDb, jobId: string): AppliedRow[] {
  const rows = db.all<{ id: string; job_id: string; kind: AppliedKind; ref: string; source_path: string | null; sha256: string | null; adapter: string | null; paths_json: string | null; created_at: string }>(
    sql`SELECT id, job_id, kind, ref, source_path, sha256, adapter, paths_json, created_at FROM data_port_applied WHERE job_id = ${jobId} ORDER BY created_at ASC, id ASC`
  )
  return rows.map((r) => ({
    id: r.id,
    jobId: r.job_id,
    kind: r.kind,
    ref: r.ref,
    sourcePath: r.source_path ?? null,
    sha256: r.sha256 ?? null,
    adapter: r.adapter ?? null,
    paths: parsePaths(r.paths_json),
    createdAt: r.created_at,
  }))
}

function parsePaths(json: string | null): string[] {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

/** Whether THIS kind/ref pair is already in the ledger (resume adoption, Task 12). */
export function hasLedgerRef(db: EyasDb, kind: AppliedKind, ref: string): boolean {
  return (db.all(sql`SELECT 1 FROM data_port_applied WHERE kind = ${kind} AND ref = ${ref} LIMIT 1`) as unknown[]).length > 0
}

/** The ref an earlier import recorded for this digest — the indexed idempotency lookup (R11.8). */
export function findLedgerRefBySha(db: EyasDb, kind: AppliedKind, sha256: string): string | null {
  const rows = db.all<{ ref: string }>(
    sql`SELECT ref FROM data_port_applied WHERE kind = ${kind} AND sha256 = ${sha256} ORDER BY created_at ASC LIMIT 1`,
  )
  return rows[0]?.ref ?? null
}

export function deleteApplied(db: EyasDb, jobId: string): void {
  db.run(sql`DELETE FROM data_port_applied WHERE job_id = ${jobId}`)
}

/** Message chain of a thrown value, so a wrapped SQLite error is still readable. */
export function errorText(err: unknown): string {
  const parts: string[] = []
  let current: unknown = err
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    parts.push(current.message)
    current = current.cause
  }
  return parts.length > 0 ? parts.join(' | ') : String(err)
}

/**
 * True only when `BEGIN IMMEDIATE` failed because the caller already owns a
 * transaction — the one reason a write may carry on un-begun.
 *
 * The phrase MUST be looked for down the whole cause chain: drizzle wraps every
 * driver error, so the top-level message is only `Failed to run the query
 * 'BEGIN IMMEDIATE'` and the driver's own "cannot start a transaction within a
 * transaction" sits on `.cause`. A check against `err.message` alone is always
 * false, which turns a supported nesting into a thrown error and, worse, would
 * read a locked database (SQLITE_BUSY, which fails identically) as nesting if
 * the test were ever inverted. One copy of the phrase for the whole module.
 */
export function isNestedTransactionError(err: unknown): boolean {
  return /within a transaction/i.test(errorText(err))
}

/**
 * Drops the named rows only. A rollback that refused to remove an item keeps
 * that item's row: it is the last thing linking the surviving artifact to the
 * import that created it.
 *
 * All or nothing. A half-cleared ledger would claim some artifacts were never
 * imported, which is worse than a ledger that still lists everything. `began`
 * stays false when a caller already owns a transaction — theirs then covers
 * these deletes, and rolling it back on their behalf is not ours to do.
 */
export function deleteAppliedRows(db: EyasDb, ids: string[]): void {
  if (ids.length === 0) return
  let began = false
  try {
    db.run(sql.raw('BEGIN IMMEDIATE'))
    began = true
  } catch (err) {
    // `BEGIN IMMEDIATE` fails for SQLITE_BUSY exactly as it fails for nesting,
    // and a bare catch cannot tell the two apart. Carrying on regardless would
    // run the batch UN-TRANSACTED on a locked database, which is the half-
    // cleared ledger this transaction exists to prevent. So only the caller's
    // own transaction is a reason to continue; anything else fails closed,
    // before a single row is dropped. Same rule as memory/v2/extractor.ts.
    if (!isNestedTransactionError(err)) throw err
  }
  try {
    for (const id of ids) {
      db.run(sql`DELETE FROM data_port_applied WHERE id = ${id}`)
    }
    if (began) db.run(sql.raw('COMMIT'))
  } catch (err) {
    if (began) {
      try { db.run(sql.raw('ROLLBACK')) } catch { /* transaction already gone */ }
    }
    throw err
  }
}
