// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// One-time-in-effect move of conversation workspaces out of a git checkout.
//
// Before the CLI runtime seam, every auto-created workspace lived at
// <dataDir>/workspaces/<id>. On a source install the data dir sits inside the
// EYAS git checkout, so a CLI started there treated the EYAS repository as its
// project (its instruction files, git status, permission rules and memory
// scope). The workspaces root now avoids any git work tree
// (core/instance.ts resolveWorkspacesDir); this moves the old folders across
// and repoints the conversations that used them.
//
// Idempotent: a second run finds nothing to move and nothing to rewrite.
// Conservative: only direct children of the legacy root are auto workspaces;
// a Folder the user chose (anything else) is never moved or rewritten, and a
// row is repointed only once its folder is no longer at the legacy path.

import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import type { ModuleContext } from '@core/types'
import { isSafeWorkspaceSegment } from '@modules/model/cli-runtime/workspaces.js'

export interface WorkspaceMigrationResult {
  moved: number
  rewritten: number
  /** Legacy folders left in place because the target already existed or the move failed. */
  kept: number
}

type Logger = Pick<ModuleContext['logger'], 'info' | 'warn'>

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function moveDir(src: string, dest: string): void {
  try {
    renameSync(src, dest)
  } catch (err) {
    // A different filesystem: copy, then remove the original.
    if ((err as NodeJS.ErrnoException)?.code !== 'EXDEV') throw err
    cpSync(src, dest, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false })
    rmSync(src, { recursive: true, force: true })
  }
}

/** Move every legacy workspace folder into the new root. */
function moveLegacyFolders(legacyRoot: string, newRoot: string, logger: Logger, result: WorkspaceMigrationResult): void {
  if (!existsSync(legacyRoot)) return
  let entries: Array<{ name: string; isDirectory(): boolean }>
  try {
    entries = readdirSync(legacyRoot, { withFileTypes: true })
  } catch (err) {
    logger.warn({ err: String(err), legacyRoot }, 'conversations: legacy workspaces folder unreadable — left in place')
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeWorkspaceSegment(entry.name)) continue
    const src = join(legacyRoot, entry.name)
    const dest = join(newRoot, entry.name)
    if (existsSync(dest)) {
      result.kept++
      logger.warn({ src, dest }, 'conversations: workspace already exists at the new location — legacy folder left in place')
      continue
    }
    try {
      mkdirSync(newRoot, { recursive: true })
      moveDir(src, dest)
      result.moved++
    } catch (err) {
      result.kept++
      logger.warn({ err: String(err), src, dest }, 'conversations: moving a workspace failed — legacy folder left in place')
    }
  }
  try {
    if (readdirSync(legacyRoot).length === 0) rmdirSync(legacyRoot)
  } catch {
    // Not empty or already gone.
  }
}

/** The legacy auto path an entry points at, or null for anything else. */
function legacyTarget(path: string, legacyRoots: ReadonlySet<string>): string | null {
  const abs = resolve(path)
  const name = basename(abs)
  return legacyRoots.has(dirname(abs)) && isSafeWorkspaceSegment(name) ? name : null
}

/** Repoint conversation Folders that are legacy auto workspaces. */
function rewriteRows(
  db: ModuleContext['db'],
  legacyRoot: string,
  legacyRoots: ReadonlySet<string>,
  newRoot: string,
  result: WorkspaceMigrationResult,
): void {
  // Every legacy auto path contains 'workspaces'; the filter only narrows the scan.
  const rows = db.all<{ id: string; working_directories: string | null }>(
    sql`SELECT id, working_directories FROM conversations WHERE working_directories LIKE ${'%workspaces%'}`,
  )
  for (const row of rows) {
    let entries: unknown
    try {
      entries = JSON.parse(row.working_directories ?? 'null')
    } catch {
      continue
    }
    if (!Array.isArray(entries)) continue
    let changed = false
    const next = entries.map((entry) => {
      const path = typeof entry === 'string' ? entry : (entry && typeof entry === 'object' && typeof (entry as { path?: unknown }).path === 'string' ? (entry as { path: string }).path : null)
      if (!path) return entry
      const name = legacyTarget(path, legacyRoots)
      // Still at the legacy path (the move was skipped or failed): keep it.
      if (!name || existsSync(join(legacyRoot, name))) return entry
      changed = true
      const moved = join(newRoot, name)
      return typeof entry === 'string' ? moved : { ...(entry as Record<string, unknown>), path: moved }
    })
    if (!changed) continue
    db.run(sql`UPDATE conversations SET working_directories = ${JSON.stringify(next)} WHERE id = ${row.id}`)
    result.rewritten++
  }
}

/**
 * Move `<legacyRoot>/<id>` folders into `newRoot` and rewrite the
 * conversations whose Folders point at them. A no-op when both roots are the
 * same place.
 */
export function migrateLegacyWorkspaces(input: {
  db: ModuleContext['db']
  legacyRoot: string
  newRoot: string
  logger: Logger
}): WorkspaceMigrationResult {
  const result: WorkspaceMigrationResult = { moved: 0, rewritten: 0, kept: 0 }
  const legacyRoot = resolve(input.legacyRoot)
  const newRoot = resolve(input.newRoot)
  if (legacyRoot === newRoot || realpathOrSelf(legacyRoot) === realpathOrSelf(newRoot)) return result

  // Stored paths may be the literal legacy path or its realpath (a PATCH
  // re-validates Folders, which resolves symlinks) — match both.
  const legacyRoots = new Set([legacyRoot, realpathOrSelf(legacyRoot)])

  moveLegacyFolders(legacyRoot, newRoot, input.logger, result)
  rewriteRows(input.db, legacyRoot, legacyRoots, newRoot, result)

  if (result.moved || result.rewritten || result.kept) {
    input.logger.info({ ...result, from: legacyRoot, to: newRoot }, 'conversations: workspaces moved out of the data dir')
  }
  return result
}
