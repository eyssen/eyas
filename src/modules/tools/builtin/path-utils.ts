// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { realpathSync, existsSync } from 'node:fs'
import { resolve, normalize, relative, isAbsolute, sep } from 'node:path'
import { NO_WORKING_DIR } from '../working-directories.js'

/** Basename / path fragments that must never be read or written by file tools. */
const SENSITIVE_BASENAME_RE =
  /^(master\.key|\.env(\.[A-Za-z0-9_-]+)?|id_rsa|id_ed25519|id_ecdsa|id_dsa)$/i

const SENSITIVE_PATH_RE =
  /(^|[\\/])(\.ssh|data[\\/]sqlite)([\\/]|$)|master\.key|\.env(\.[A-Za-z0-9_-]+)?(?=$|[\\/])/i

export interface ResolvePathOk {
  ok: true
  /** Absolute path under the workspace root (normalized, no trailing sep except root). */
  absolute: string
  /** Path relative to the workspace root (posix-ish for display). */
  relative: string
  root: string
}

export interface ResolvePathErr {
  ok: false
  error: string
}

export type ResolvePathResult = ResolvePathOk | ResolvePathErr

/**
 * Resolve a user-supplied path against the tool workspace root and jail it.
 * Rejects absolute paths outside the root, `..` escapes, and sensitive paths.
 */
function collectRoots(workingDirectory?: string, allowedRoots?: string[]): string[] {
  const roots = (allowedRoots?.length ? allowedRoots : workingDirectory ? [workingDirectory] : [])
    .map((r) => r.trim())
    .filter(Boolean)
  return [...new Set(roots.map((r) => resolve(r)))]
}

export function resolveToolPath(
  userPath: string,
  workingDirectory?: string,
  allowedRoots?: string[],
): ResolvePathResult {
  if (typeof userPath !== 'string' || userPath.length === 0) {
    return { ok: false, error: 'path is required' }
  }
  if (userPath.length > 4096) {
    return { ok: false, error: 'path is too long' }
  }
  if (userPath.includes('\0')) {
    return { ok: false, error: 'path contains null byte' }
  }

  const roots = collectRoots(workingDirectory, allowedRoots)
  if (roots.length === 0) {
    return { ok: false, error: NO_WORKING_DIR }
  }
  const root = roots[0]
  const candidate = isAbsolute(userPath) ? normalize(userPath) : resolve(root, userPath)

  // Symlink-aware jail: if the path (or a prefix) exists, realpath it.
  let resolved = candidate
  try {
    if (existsSync(candidate)) {
      resolved = realpathSync(candidate)
    } else {
      // Resolve existing parent for symlink escape checks
      let parent = resolve(candidate, '..')
      while (parent !== resolve(parent, '..')) {
        if (existsSync(parent)) {
          const realParent = realpathSync(parent)
          const leaf = candidate.slice(parent.length).replace(/^[\\/]/, '')
          resolved = resolve(realParent, leaf)
          break
        }
        parent = resolve(parent, '..')
      }
    }
  } catch {
    return { ok: false, error: 'failed to resolve path' }
  }

  const rootReals = roots.map((r) => {
    try {
      return existsSync(r) ? realpathSync(r) : r
    } catch {
      return r
    }
  })

  let matchedRoot: string | null = null
  let rel = ''
  for (const rootReal of rootReals) {
    const candidateRel = relative(rootReal, resolved)
    if (candidateRel === '' || (!candidateRel.startsWith('..') && !isAbsolute(candidateRel))) {
      matchedRoot = rootReal
      rel = candidateRel
      break
    }
  }
  if (!matchedRoot) {
    return { ok: false, error: `path escapes working directories: ${userPath}` }
  }

  const base = resolved.split(/[\\/]/).pop() ?? ''
  if (SENSITIVE_BASENAME_RE.test(base) || SENSITIVE_PATH_RE.test(resolved)) {
    return { ok: false, error: 'path touches a sensitive location' }
  }

  return {
    ok: true,
    absolute: resolved,
    relative: rel.split(sep).join('/'),
    root: matchedRoot,
  }
}

export function getWorkspaceRoot(workingDirectory?: string): string {
  if (!workingDirectory) return ''
  const root = resolve(workingDirectory)
  try {
    return existsSync(root) ? realpathSync(root) : root
  } catch {
    return root
  }
}
