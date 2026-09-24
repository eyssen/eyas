// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdirSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  screenStoredWorkingDirectories,
  type RefusedStoredFolder,
  type ScreenedWorkingDirectories,
} from '@modules/tools/working-directories.js'

export function isUnderRoot(absPath: string, roots: string[]): boolean {
  if (!absPath || roots.length === 0) return false
  const resolved = resolve(absPath)
  return roots.some((root) => {
    const rootAbs = resolve(root)
    const rel = relative(rootAbs, resolved)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

export function resolveSessionCwd(opts: {
  requested?: string
  workingDirectories?: string[]
  fallback: string
}): string {
  const roots = (opts.workingDirectories ?? []).filter((p) => typeof p === 'string' && p.trim().length > 0)
  if (opts.requested && opts.requested.trim()) {
    const abs = resolve(opts.requested.trim())
    if (roots.length > 0 && !isUnderRoot(abs, roots)) {
      throw new Error('cwd is outside the conversation working directories')
    }
    return abs
  }
  if (roots[0]) return resolve(roots[0])
  mkdirSync(opts.fallback, { recursive: true })
  return opts.fallback
}

export interface TuiFolders {
  /** The folder the terminal starts in. */
  cwd: string
  /** The folders it may work in: the cwd first, then every allowed folder of the request. */
  workingDirectories: string[]
  /** Folders of the request a protection rule refuses (shown to the user as folderRefused). */
  refused: RefusedStoredFolder[]
}

/**
 * The folders of an OpenCode terminal (TUI). OpenCode's model works there
 * with the tools the human approves in the terminal, so the folders pass the
 * screening every other CLI run's folders pass (K2): a folder that is, sits
 * in or contains a protected place (EYAS's data, another tool's storage, a
 * notes vault, the home folder) is dropped — the requested cwd too — and the
 * terminal opens in the first allowed folder, else in `fallback` (the
 * conversation's own workspace). A requested cwd must still lie inside the
 * request's folders when it names any.
 */
export function resolveTuiFolders(opts: {
  requested?: string
  workingDirectories?: string[]
  fallback: string
  screen?: (raw: unknown) => ScreenedWorkingDirectories
}): TuiFolders {
  const screen = opts.screen ?? ((raw: unknown) => screenStoredWorkingDirectories(raw))
  const listed = (opts.workingDirectories ?? []).filter((p) => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim())
  let cwd = opts.requested?.trim() ? resolve(opts.requested.trim()) : undefined
  if (cwd && listed.length > 0 && !isUnderRoot(cwd, listed)) {
    throw new Error('cwd is outside the conversation working directories')
  }
  const screened = screen(listed)
  const refused = [...screened.refused]
  const allowed = screened.entries.map((e) => resolve(e.path))
  if (cwd) {
    const own = screen([cwd])
    if (own.refused.length > 0) {
      for (const r of own.refused) {
        if (!refused.some((x) => resolve(x.path) === resolve(r.path))) refused.push(r)
      }
      cwd = undefined
    }
  }
  if (!cwd) {
    cwd = allowed[0]
    if (!cwd) {
      mkdirSync(opts.fallback, { recursive: true })
      cwd = opts.fallback
    }
  }
  const workingDirectories = [cwd, ...allowed.filter((p) => p !== cwd)]
  return { cwd, workingDirectories, refused }
}
