// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { isGitRepo } from '@modules/tools/working-directories.js'
import type { GodModeIsolation } from './types.js'

const COPY_EXCLUDES = new Set([
  'node_modules',
  '.git',
  'dist',
  '__pycache__',
  '.venv',
  '.eyas-god',
  '.eyas-worktrees',
])

const GOD_DIR = '.eyas-god'

/** Source roots that have been forked this process — GC walks these. */
const knownRoots = new Set<string>()

export function chooseIsolation(sourceDir: string | null): GodModeIsolation {
  if (sourceDir == null || sourceDir.trim() === '') return 'none'
  return isGitRepo(sourceDir) ? 'worktree' : 'copy'
}

export function workerTreePath(runId: string, slotId: string): string {
  return join(GOD_DIR, runId, slotId)
}

export function forkWorkerTree(opts: {
  sourceDir: string
  runId: string
  slotId: string
}): { isolation: 'worktree' | 'copy'; workspacePath: string; branch?: string } {
  const isolation = chooseIsolation(opts.sourceDir)
  if (isolation === 'none') {
    throw new Error('forkWorkerTree requires a source directory')
  }

  const workspacePath = join(opts.sourceDir, workerTreePath(opts.runId, opts.slotId))
  mkdirSync(dirname(workspacePath), { recursive: true })
  knownRoots.add(opts.sourceDir)

  if (isolation === 'worktree') {
    const branch = `god/${opts.runId}-${opts.slotId}`
    execFileSync('git', ['worktree', 'add', '-b', branch, workspacePath, 'HEAD'], {
      cwd: opts.sourceDir,
      stdio: 'pipe',
    })
    return { isolation, workspacePath, branch }
  }

  copyTree(opts.sourceDir, workspacePath)
  return { isolation, workspacePath }
}

/** Copy children (not the root) so dest can live under source/.eyas-god. */
function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const ent of readdirSync(src, { withFileTypes: true })) {
    if (COPY_EXCLUDES.has(ent.name)) continue
    const from = join(src, ent.name)
    const to = join(dest, ent.name)
    if (ent.isDirectory()) {
      cpSync(from, to, {
        recursive: true,
        filter: (p) => !COPY_EXCLUDES.has(basename(p)),
      })
    } else {
      cpSync(from, to)
    }
  }
}

export function promoteChangedFiles(opts: {
  workspacePath: string
  destDir: string
  isolation: 'worktree' | 'copy'
}): { copied: string[] } {
  const rels =
    opts.isolation === 'worktree'
      ? listWorktreeChanges(opts.workspacePath)
      : listCopyChanges(opts.workspacePath, opts.destDir)

  const copied: string[] = []
  for (const rel of rels) {
    if (isExcludedRel(rel)) continue
    const from = join(opts.workspacePath, rel)
    if (!existsSync(from) || statSync(from).isDirectory()) continue
    const to = join(opts.destDir, rel)
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to)
    copied.push(rel)
  }

  assertDestNotOnGodBranch(opts.destDir)
  return { copied }
}

export function gcGodWorkspaces(opts: {
  olderThanMs: number
  now?: number
  /** Extra source dirs to scan (boot / scheduler). Merged with in-process forks. */
  roots?: string[]
}): { removed: number } {
  const now = opts.now ?? Date.now()
  let removed = 0
  const roots = collectGcRoots(opts.roots)

  for (const root of roots) {
    const godRoot = join(root, GOD_DIR)
    if (!existsSync(godRoot)) {
      sweepOrphanGodBranches(root)
      continue
    }

    for (const name of readdirSync(godRoot)) {
      const runDir = join(godRoot, name)
      let st
      try {
        st = statSync(runDir)
      } catch {
        continue
      }
      if (!st.isDirectory()) continue
      if (now - st.mtimeMs < opts.olderThanMs) continue
      removeRunTree(root, runDir)
      removed++
    }

    sweepOrphanGodBranches(root)

    try {
      if (existsSync(godRoot) && readdirSync(godRoot).length === 0) {
        rmSync(godRoot, { recursive: true, force: true })
      }
    } catch {
      /* leave an in-use god root alone */
    }
  }

  return { removed }
}

function collectGcRoots(extra?: string[]): Set<string> {
  const roots = new Set(knownRoots)
  // Isolation-none trees (unused today) would land under tmpdir.
  roots.add(tmpdir())
  if (extra) {
    for (const r of extra) {
      if (r) roots.add(r)
    }
  }
  return roots
}

function listWorktreeChanges(workspacePath: string): string[] {
  const names = new Set<string>()
  for (const args of [
    ['diff', '--name-only'],
    ['diff', '--cached', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    try {
      const out = execFileSync('git', args, {
        cwd: workspacePath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      for (const line of out.split('\n')) {
        const rel = line.trim()
        if (rel) names.add(rel)
      }
    } catch {
      /* workspace may not be a git dir */
    }
  }
  return [...names]
}

export function listCopyChanges(workspacePath: string, destDir: string): string[] {
  const changed: string[] = []
  for (const rel of walkFiles(workspacePath)) {
    if (filesDiffer(join(workspacePath, rel), join(destDir, rel))) {
      changed.push(rel)
    }
  }
  return changed
}

function walkFiles(root: string): string[] {
  const out: string[] = []
  function rec(dir: string, rel: string): void {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (COPY_EXCLUDES.has(ent.name)) continue
      const childRel = rel ? `${rel}/${ent.name}` : ent.name
      const full = join(dir, ent.name)
      if (ent.isDirectory()) rec(full, childRel)
      else if (ent.isFile() || ent.isSymbolicLink()) out.push(childRel)
    }
  }
  rec(root, '')
  return out
}

function filesDiffer(src: string, dest: string): boolean {
  if (!existsSync(dest)) return true
  let srcStat
  let destStat
  try {
    srcStat = statSync(src)
    destStat = statSync(dest)
  } catch {
    return true
  }
  if (!srcStat.isFile() || !destStat.isFile()) return true
  if (srcStat.size !== destStat.size) return true
  return fileHash(src) !== fileHash(dest)
}

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function isExcludedRel(rel: string): boolean {
  return rel.split(/[\\/]/).some((part) => COPY_EXCLUDES.has(part))
}

function assertDestNotOnGodBranch(destDir: string): void {
  if (!isGitRepo(destDir)) return
  try {
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: destDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (branch.startsWith('god/')) {
      throw new Error(`destDir is checked out on ${branch}; refuse to leave god/* on dest`)
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('refuse to leave')) throw err
  }
}

function removeRunTree(root: string, runDir: string): void {
  const runId = basename(runDir)
  let slots: string[] = []
  try {
    slots = readdirSync(runDir)
  } catch {
    slots = []
  }

  if (isGitRepo(root)) {
    for (const slot of slots) {
      const slotPath = join(runDir, slot)
      try {
        execFileSync('git', ['worktree', 'remove', slotPath, '--force'], {
          cwd: root,
          stdio: 'pipe',
        })
      } catch {
        /* not a worktree or already gone */
      }
      try {
        execFileSync('git', ['branch', '-D', `god/${runId}-${slot}`], {
          cwd: root,
          stdio: 'pipe',
        })
      } catch {
        /* branch may not exist (copy isolation) */
      }
    }
  }

  rmSync(runDir, { recursive: true, force: true })
}

function sweepOrphanGodBranches(root: string): void {
  if (!isGitRepo(root)) return

  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: root, stdio: 'pipe' })
  } catch {
    /* not a repo / git missing */
  }

  let branches: string[] = []
  try {
    const out = execFileSync('git', ['branch', '--list', 'god/*'], {
      cwd: root,
      encoding: 'utf-8',
    })
    branches = out
      .split('\n')
      .map((l) => l.replace(/^\*?\s+/, '').trim())
      .filter(Boolean)
  } catch {
    return
  }
  if (branches.length === 0) return

  let porcelain = ''
  try {
    porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: root,
      encoding: 'utf-8',
    })
  } catch {
    porcelain = ''
  }

  const liveByBranch = parseWorktreePorcelain(porcelain)

  for (const branch of branches) {
    const wtPath = liveByBranch.get(branch)
    if (wtPath && existsSync(wtPath)) continue
    if (wtPath) {
      try {
        execFileSync('git', ['worktree', 'remove', wtPath, '--force'], {
          cwd: root,
          stdio: 'pipe',
        })
      } catch {
        /* already unregistered */
      }
    }
    try {
      execFileSync('git', ['branch', '-D', branch], { cwd: root, stdio: 'pipe' })
    } catch {
      /* already gone */
    }
  }
}

function parseWorktreePorcelain(porcelain: string): Map<string, string> {
  const map = new Map<string, string>()
  let currentPath = ''
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length).trim()
    } else if (line.startsWith('branch refs/heads/')) {
      map.set(line.slice('branch refs/heads/'.length).trim(), currentPath)
    } else if (line === '') {
      currentPath = ''
    }
  }
  return map
}
