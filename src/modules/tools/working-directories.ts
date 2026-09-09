// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ToolContext } from './types.js'

const SENSITIVE_BASENAME_RE =
  /^(master\.key|\.env(\.[A-Za-z0-9_-]+)?|id_rsa|id_ed25519|id_ecdsa|id_dsa)$/i

const SENSITIVE_PATH_RE =
  /(^|[\\/])(\.ssh|data[\\/]sqlite)([\\/]|$)|master\.key|\.env(\.[A-Za-z0-9_-]+)?(?=$|[\\/])/i

export const NO_WORKING_DIR =
  'no working directory configured — set Folders on this conversation or the project'

export interface NamedWorkingDirectory {
  name: string
  path: string
}

export function workspaceBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function parseNamedWorkingDirectories(raw: unknown): NamedWorkingDirectory[] {
  if (raw == null) return []
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return []
    try {
      return parseNamedWorkingDirectories(JSON.parse(trimmed))
    } catch {
      return []
    }
  }
  if (!Array.isArray(raw)) return []
  const out: NamedWorkingDirectory[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const path = item.trim()
      if (!path) continue
      out.push({ name: workspaceBasename(path), path })
      continue
    }
    if (item && typeof item === 'object' && typeof (item as { path?: unknown }).path === 'string') {
      const path = (item as { path: string }).path.trim()
      if (!path) continue
      const rawName = (item as { name?: unknown }).name
      const name = typeof rawName === 'string' ? rawName.trim() : ''
      out.push({ name: name || workspaceBasename(path), path })
    }
  }
  return out
}

export function parseWorkingDirectories(raw: unknown): string[] {
  return parseNamedWorkingDirectories(raw).map((entry) => entry.path)
}

/** Project list wins when non-empty; otherwise the type list. */
export function inheritWorkingDirectories(projectDirs: unknown, typeDirs: unknown): NamedWorkingDirectory[] {
  const own = parseNamedWorkingDirectories(projectDirs)
  if (own.length > 0) return own
  return parseNamedWorkingDirectories(typeDirs)
}

export function serializeWorkingDirectories(
  entries: NamedWorkingDirectory[],
): Array<string | { name: string; path: string }> {
  return entries.map((entry) => (
    !entry.name || entry.name === workspaceBasename(entry.path)
      ? entry.path
      : { name: entry.name, path: entry.path }
  ))
}

export interface ValidateWorkingDirectoriesOpts {
  /** Project save: at least one path. Conversation may be empty. */
  requireNonEmpty?: boolean
  /** When false, skip exists/isDirectory (not used in production). */
  mustExist?: boolean
}

export type ValidateWorkingDirectoriesResult =
  | { ok: true; paths: string[]; entries: NamedWorkingDirectory[] }
  | { ok: false; error: string }

export function validateWorkingDirectories(
  raw: unknown,
  opts: ValidateWorkingDirectoriesOpts = {},
): ValidateWorkingDirectoriesResult {
  const mustExist = opts.mustExist !== false
  if (raw == null) {
    if (opts.requireNonEmpty) return { ok: false, error: 'at least one working directory is required' }
    return { ok: true, paths: [], entries: [] }
  }
  if (!Array.isArray(raw) && typeof raw !== 'string') {
    return { ok: false, error: 'workingDirectories must be an array of paths' }
  }
  const incoming = parseNamedWorkingDirectories(raw)
  if (opts.requireNonEmpty && incoming.length === 0) {
    return { ok: false, error: 'at least one working directory is required' }
  }

  const entries: NamedWorkingDirectory[] = []
  const seen = new Set<string>()
  for (const item of incoming) {
    const path = item.path
    if (path.includes('\0')) return { ok: false, error: 'path contains null byte' }
    if (!isAbsolute(path)) return { ok: false, error: `path must be absolute: ${path}` }
    const normalized = resolve(path)
    if (SENSITIVE_BASENAME_RE.test(normalized.split(/[\\/]/).pop() ?? '') || SENSITIVE_PATH_RE.test(normalized)) {
      return { ok: false, error: 'path touches a sensitive location' }
    }
    if (mustExist) {
      if (!existsSync(normalized)) return { ok: false, error: `directory does not exist: ${path}` }
      let st
      try {
        st = statSync(normalized)
      } catch {
        return { ok: false, error: `cannot stat directory: ${path}` }
      }
      if (!st.isDirectory()) return { ok: false, error: `path is not a directory: ${path}` }
    }
    let real = normalized
    try {
      if (existsSync(normalized)) real = realpathSync(normalized)
    } catch {
      return { ok: false, error: `failed to resolve path: ${path}` }
    }
    if (seen.has(real)) continue
    seen.add(real)
    entries.push({ name: item.name || workspaceBasename(real), path: real })
  }
  return { ok: true, paths: entries.map((e) => e.path), entries }
}

export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

export function isPathInsideRoots(absPath: string, roots: string[]): boolean {
  if (!absPath || roots.length === 0) return false
  let resolved = resolve(absPath)
  try {
    if (existsSync(resolved)) resolved = realpathSync(resolved)
  } catch {
    return false
  }
  return roots.some((root) => {
    let rootReal = resolve(root)
    try {
      if (existsSync(rootReal)) rootReal = realpathSync(rootReal)
    } catch {
      /* keep resolved */
    }
    const rel = relative(rootReal, resolved)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

export type WorkspaceResolve =
  | { ok: true; primary: string; roots: string[] }
  | { ok: false; error: string }

/** Resolve the coding workspace from a tool context. No process.cwd() fallback. */
export function workspaceFromContext(ctx?: ToolContext): WorkspaceResolve {
  const fromList = parseWorkingDirectories(ctx?.workingDirectories)
  const roots = fromList.length > 0
    ? fromList
    : ctx?.workingDirectory
      ? [ctx.workingDirectory]
      : []
  if (roots.length === 0) return { ok: false, error: NO_WORKING_DIR }
  return { ok: true, primary: roots[0], roots }
}

export function toolWorkspaceFields(paths: unknown): {
  workingDirectory?: string
  workingDirectories?: string[]
} {
  const dirs = parseWorkingDirectories(paths)
  if (dirs.length === 0) return {}
  return { workingDirectory: dirs[0], workingDirectories: dirs }
}

export function displayRelative(absPath: string, roots: string[]): string {
  for (const root of roots) {
    const rel = relative(root, absPath)
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      return rel.split(sep).join('/') || '.'
    }
  }
  return absPath
}
