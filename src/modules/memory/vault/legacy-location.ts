// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * The memory vault lives in `<dataDir>/vault` (InstancePaths.vaultDir), so it
 * follows EYAS_DATA_DIR like every other piece of EYAS data.
 *
 * Before that it sat at `data/vault` relative to the working directory, which
 * after bootstrap's chdir is `<home>/data/vault` — the same folder as long as
 * the data dir is the default `<home>/data`. An install that set EYAS_DATA_DIR
 * therefore kept its notes in the old place, and would open an empty vault
 * now. On start, those notes are copied (never moved) once into the new vault,
 * and only while that vault holds no note of its own, so nothing already there
 * is ever overwritten and the original stays where it was.
 */

import { cpSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { realpathBestEffort } from '@shared/fs-realpath.js'
import type { InstancePaths } from '@core/instance.js'

interface VaultLocationLogger {
  warn: (obj: object, msg?: string) => void
  error: (obj: object, msg?: string) => void
}

/** Where the vault lived before it followed the data dir: `<home>/data/vault`. */
export function legacyVaultDir(home: string): string {
  return join(resolve(home), 'data', 'vault')
}

/**
 * Number of `.md` files under `dir` (dot-folders included, symlinked folders
 * not followed), counting at most `stopAt`. A missing or unreadable folder
 * counts as none.
 */
function countNotes(dir: string, stopAt = Number.POSITIVE_INFINITY): number {
  let found = 0
  const walk = (current: string): void => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found >= stopAt) return
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) found++
    }
  }
  walk(dir)
  return found
}

function realLocation(path: string): string {
  try {
    return realpathBestEffort(path)
  } catch {
    return resolve(path)
  }
}

export type LegacyVaultState =
  /** The legacy folder IS the vault (default data dir): nothing to do. */
  | { kind: 'same-location'; vaultDir: string }
  /** No legacy folder, or one without a single note. */
  | { kind: 'no-legacy'; vaultDir: string; legacyDir: string }
  /** Legacy notes exist and the vault holds none: the next start copies them. */
  | { kind: 'pending'; vaultDir: string; legacyDir: string; notes: number }
  /** Both hold notes: the legacy folder is not read and not merged. */
  | { kind: 'diverged'; vaultDir: string; legacyDir: string; notes: number }

/** Read-only look at the two locations; shared by the start-up copy and `eyas doctor`. */
export function inspectLegacyVault(paths: Pick<InstancePaths, 'home' | 'vaultDir'>): LegacyVaultState {
  const vaultDir = resolve(paths.vaultDir)
  const legacyDir = legacyVaultDir(paths.home)
  if (realLocation(legacyDir) === realLocation(vaultDir)) return { kind: 'same-location', vaultDir }
  const notes = existsSync(legacyDir) ? countNotes(legacyDir) : 0
  if (notes === 0) return { kind: 'no-legacy', vaultDir, legacyDir }
  if (countNotes(vaultDir, 1) > 0) return { kind: 'diverged', vaultDir, legacyDir, notes }
  return { kind: 'pending', vaultDir, legacyDir, notes }
}

export type LegacyVaultCopyResult =
  | { action: 'none'; state: LegacyVaultState }
  | { action: 'kept'; state: LegacyVaultState }
  | { action: 'copied'; state: LegacyVaultState; notes: number }
  | { action: 'failed'; state: LegacyVaultState; error: string }

/**
 * Copy the legacy vault into `vaultDir` when — and only when — the two are
 * different folders, the legacy one holds notes and `vaultDir` holds none.
 *
 * The copy goes to a staging folder beside the vault first and is put in
 * place only once complete, so a failed or interrupted copy leaves the vault
 * as empty as it was and the next start tries again. Files already in the
 * vault are never overwritten, and the legacy folder is never touched.
 * Never throws: a failure is logged with its remedy and reported.
 */
export function copyLegacyVaultIfNeeded(
  paths: Pick<InstancePaths, 'home' | 'vaultDir'>,
  logger?: VaultLocationLogger,
): LegacyVaultCopyResult {
  // Never throws: every filesystem read in it answers "none" on error.
  const state = inspectLegacyVault(paths)

  if (state.kind === 'same-location' || state.kind === 'no-legacy') return { action: 'none', state }

  if (state.kind === 'diverged') {
    logger?.warn(
      { legacyDir: state.legacyDir, vaultDir: state.vaultDir, legacyNotes: state.notes },
      'memory vault: notes in the legacy vault folder are not used — EYAS reads only the vault in its data dir (EYAS_DATA_DIR), which already has notes, so nothing was copied or merged. Remedy: copy any note you still need into the vault by hand, then delete the legacy folder.',
    )
    return { action: 'kept', state }
  }

  const source = realLocation(state.legacyDir)
  const staging = join(dirname(state.vaultDir), '.vault-legacy-copy')
  try {
    rmSync(staging, { recursive: true, force: true })
    cpSync(source, staging, { recursive: true, preserveTimestamps: true })
    if (existsSync(state.vaultDir)) {
      // The vault folder exists but holds no note (an earlier start made its
      // empty scaffold): merge in, never replacing a file that is there.
      cpSync(staging, state.vaultDir, { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true })
      rmSync(staging, { recursive: true, force: true })
    } else {
      renameSync(staging, state.vaultDir)
    }
  } catch (err) {
    try { rmSync(staging, { recursive: true, force: true }) } catch { /* best effort */ }
    const error = err instanceof Error ? err.message : String(err)
    logger?.error(
      { err: error, legacyDir: state.legacyDir, vaultDir: state.vaultDir },
      'memory vault: copying the legacy vault into the data dir failed; the vault stays empty and the copy is retried on the next start. Remedy: make the data dir writable, or copy the legacy folder into the vault by hand.',
    )
    return { action: 'failed', state, error }
  }

  logger?.warn(
    { legacyDir: state.legacyDir, vaultDir: state.vaultDir, notes: state.notes },
    'memory vault: copied the legacy vault folder into the data dir (EYAS_DATA_DIR); EYAS uses only the copy from now on. Remedy: once you have checked the copy, delete the legacy folder.',
  )
  return { action: 'copied', state, notes: state.notes }
}

/**
 * The vault folder for this instance, with any legacy notes copied in first.
 * The memory module hands the result to both the vault service and its
 * watcher, so the two can never disagree about where the vault is.
 */
export function prepareVaultDir(
  paths: Pick<InstancePaths, 'home' | 'vaultDir'>,
  logger?: VaultLocationLogger,
): string {
  copyLegacyVaultIfNeeded(paths, logger)
  return resolve(paths.vaultDir)
}
