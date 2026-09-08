// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdirSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

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
