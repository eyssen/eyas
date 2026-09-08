// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/shared/file-tree-store.ts
//
// A versioned file tree under <root>/<entityId>/, with snapshots in
// versions/<n>/. The design module stores its content this
// way, for the same three reasons: an agent can edit it with ordinary file
// tools, a version is a directory snapshot so it diffs and exports, and any
// manifest is DERIVED from the files rather than maintained beside them.
//
// Every path is resolved and checked against the entity's own directory, so a
// traversal in an AI-authored filename cannot escape it.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

export const VERSIONS_DIR = 'versions'
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export class FileTreePathError extends Error {}

export interface FileTreeStore {
  dir(id: string): string
  read(id: string, path: string): string | null
  write(id: string, path: string, content: string): void
  remove(id: string, path: string): void
  list(id: string): string[]
  readAll(id: string): Record<string, string>
  snapshot(id: string, version: number): void
  restore(id: string, version: number): void
  destroy(id: string): void
}

function isUnderRoot(candidate: string, root: string): boolean {
  const normalized = root.endsWith(sep) ? root.slice(0, -1) : root
  return candidate === normalized || candidate.startsWith(normalized + sep)
}

export function assertEntityId(id: string, what = 'id'): void {
  if (!ID_RE.test(id)) throw new FileTreePathError(`invalid ${what}: ${id}`)
}

export function createFileTreeStore(root: string): FileTreeStore {
  const rootAbs = resolve(root)

  function dir(id: string): string {
    assertEntityId(id)
    return join(rootAbs, id)
  }

  function resolveIn(id: string, path: string): string {
    if (!path || path.includes('\0')) throw new FileTreePathError('empty or invalid path')
    const base = dir(id)
    const candidate = resolve(base, path)
    if (!isUnderRoot(candidate, base)) throw new FileTreePathError(`path escapes the entity directory: ${path}`)
    return candidate
  }

  function walk(base: string, acc: string[], skip: string): void {
    if (!existsSync(base)) return
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.name === skip) continue
      const full = join(base, entry.name)
      if (entry.isDirectory()) walk(full, acc, skip)
      else if (entry.isFile()) acc.push(full)
    }
  }

  function copyTree(from: string, to: string, skip: string | null): void {
    if (!existsSync(from)) return
    mkdirSync(to, { recursive: true })
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (skip && entry.name === skip) continue
      const src = join(from, entry.name)
      const dst = join(to, entry.name)
      if (entry.isDirectory()) copyTree(src, dst, null)
      else if (entry.isFile()) copyFileSync(src, dst)
    }
  }

  const store: FileTreeStore = {
    dir,

    read(id, path) {
      const p = resolveIn(id, path)
      if (!existsSync(p)) return null
      try {
        if (!statSync(p).isFile()) return null
      } catch { return null }
      return readFileSync(p, 'utf8')
    },

    write(id, path, content) {
      const p = resolveIn(id, path)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, content, 'utf8')
    },

    remove(id, path) {
      const p = resolveIn(id, path)
      if (existsSync(p)) rmSync(p, { force: true })
    },

    list(id) {
      const base = dir(id)
      const found: string[] = []
      walk(base, found, VERSIONS_DIR)
      return found.map((f) => relative(base, f).split(sep).join('/')).sort()
    },

    readAll(id) {
      const out: Record<string, string> = {}
      for (const rel of store.list(id)) {
        const content = store.read(id, rel)
        if (content !== null) out[rel] = content
      }
      return out
    },

    snapshot(id, version) {
      const base = dir(id)
      const target = join(base, VERSIONS_DIR, String(version))
      if (existsSync(target)) rmSync(target, { recursive: true, force: true })
      copyTree(base, target, VERSIONS_DIR)
    },

    restore(id, version) {
      const base = dir(id)
      const source = join(base, VERSIONS_DIR, String(version))
      if (!existsSync(source)) throw new FileTreePathError(`no snapshot for version ${version}`)
      // Clear the live tree, keep the snapshot history.
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (entry.name === VERSIONS_DIR) continue
        rmSync(join(base, entry.name), { recursive: true, force: true })
      }
      copyTree(source, base, null)
    },

    destroy(id) {
      const base = dir(id)
      if (existsSync(base)) rmSync(base, { recursive: true, force: true })
    },
  }

  return store
}
