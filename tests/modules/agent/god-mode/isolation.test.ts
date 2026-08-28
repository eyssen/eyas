// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  chooseIsolation,
  forkWorkerTree,
  gcGodWorkspaces,
  promoteChangedFiles,
  workerTreePath,
} from '@modules/agent/god-mode/isolation'

const temps: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

function writeFile(root: string, rel: string, contents: string): void {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, contents)
}

function initGitRepo(dir: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-m', 'init', '-q', '--allow-empty'], { cwd: dir })
}

function currentBranch(dir: string): string {
  return execFileSync('git', ['branch', '--show-current'], {
    cwd: dir,
    encoding: 'utf-8',
  }).trim()
}

function listBranches(dir: string, pattern: string): string {
  return execFileSync('git', ['branch', '--list', pattern], {
    cwd: dir,
    encoding: 'utf-8',
  })
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('chooseIsolation', () => {
  it('returns none for null or empty source', () => {
    expect(chooseIsolation(null)).toBe('none')
    expect(chooseIsolation('')).toBe('none')
    expect(chooseIsolation('   ')).toBe('none')
  })

  it('returns copy without .git and worktree after git init', () => {
    const dir = tempDir('eyas-god-iso-')
    expect(chooseIsolation(dir)).toBe('copy')
    execFileSync('git', ['init', '-q'], { cwd: dir })
    expect(chooseIsolation(dir)).toBe('worktree')
  })
})

describe('workerTreePath', () => {
  it('returns .eyas-god/<runId>/<slotId>', () => {
    expect(workerTreePath('run-1', 'slot-a')).toBe(join('.eyas-god', 'run-1', 'slot-a'))
  })
})

describe('forkWorkerTree', () => {
  it('copy fork excludes node_modules and includes src/a.ts', () => {
    const src = tempDir('eyas-god-copy-src-')
    writeFile(src, 'src/a.ts', 'export const a = 1\n')
    writeFile(src, 'node_modules/pkg/index.js', 'module.exports = 1\n')
    writeFile(src, 'dist/out.js', 'built\n')

    const result = forkWorkerTree({ sourceDir: src, runId: 'run-copy', slotId: 'slot-1' })

    expect(result.isolation).toBe('copy')
    expect(result.branch).toBeUndefined()
    expect(result.workspacePath).toBe(join(src, '.eyas-god', 'run-copy', 'slot-1'))
    expect(existsSync(join(result.workspacePath, 'src/a.ts'))).toBe(true)
    expect(readFileSync(join(result.workspacePath, 'src/a.ts'), 'utf-8')).toBe('export const a = 1\n')
    expect(existsSync(join(result.workspacePath, 'node_modules/pkg/index.js'))).toBe(false)
    expect(existsSync(join(result.workspacePath, 'dist/out.js'))).toBe(false)
  })

  it('worktree fork uses god/<runId>-<slotId> at .eyas-god/<runId>/<slotId>', () => {
    const src = tempDir('eyas-god-wt-src-')
    writeFile(src, 'src/a.ts', 'export const a = 1\n')
    initGitRepo(src)

    const result = forkWorkerTree({ sourceDir: src, runId: 'run-wt', slotId: 'slot-2' })

    expect(result.isolation).toBe('worktree')
    expect(result.branch).toBe('god/run-wt-slot-2')
    expect(result.workspacePath).toBe(join(src, '.eyas-god', 'run-wt', 'slot-2'))
    expect(existsSync(join(result.workspacePath, 'src/a.ts'))).toBe(true)
    expect(listBranches(src, 'god/*')).toContain('god/run-wt-slot-2')
    expect(currentBranch(src)).toBe('main')
  })
}, 30_000)

describe('promoteChangedFiles', () => {
  it('copies a changed file onto dest and does not copy an excluded dir', () => {
    const dest = tempDir('eyas-god-promo-dest-')
    writeFile(dest, 'src/a.ts', 'old\n')
    writeFile(dest, 'node_modules/pkg/index.js', 'dep\n')

    const { workspacePath, isolation } = forkWorkerTree({
      sourceDir: dest,
      runId: 'run-promo',
      slotId: 'slot-1',
    })
    expect(isolation).toBe('copy')
    writeFile(workspacePath, 'src/a.ts', 'new\n')
    writeFile(workspacePath, 'node_modules/pkg/evil.js', 'nope\n')

    const { copied } = promoteChangedFiles({ workspacePath, destDir: dest, isolation })

    expect(copied).toContain('src/a.ts')
    expect(copied.some((p) => p.includes('node_modules'))).toBe(false)
    expect(readFileSync(join(dest, 'src/a.ts'), 'utf-8')).toBe('new\n')
    expect(existsSync(join(dest, 'node_modules/pkg/evil.js'))).toBe(false)
    expect(readFileSync(join(dest, 'node_modules/pkg/index.js'), 'utf-8')).toBe('dep\n')
  })

  it('worktree promote copies diffs and does not leave god/* checked out on dest', () => {
    const dest = tempDir('eyas-god-promo-wt-')
    writeFile(dest, 'src/a.ts', 'old\n')
    initGitRepo(dest)

    const { workspacePath, isolation, branch } = forkWorkerTree({
      sourceDir: dest,
      runId: 'run-promo-wt',
      slotId: 'slot-1',
    })
    expect(isolation).toBe('worktree')
    writeFile(workspacePath, 'src/a.ts', 'new\n')
    writeFile(workspacePath, 'src/b.ts', 'untracked\n')

    const { copied } = promoteChangedFiles({ workspacePath, destDir: dest, isolation })

    expect(copied).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts']))
    expect(readFileSync(join(dest, 'src/a.ts'), 'utf-8')).toBe('new\n')
    expect(readFileSync(join(dest, 'src/b.ts'), 'utf-8')).toBe('untracked\n')
    expect(currentBranch(dest)).toBe('main')
    expect(currentBranch(dest)).not.toMatch(/^god\//)
    expect(branch).toBe('god/run-promo-wt-slot-1')
    expect(listBranches(dest, 'god/*')).toContain('god/run-promo-wt-slot-1')
  })
}, 30_000)

describe('gcGodWorkspaces', () => {
  it('removes a tree with mtime older than the threshold and keeps a fresh one', () => {
    const src = tempDir('eyas-god-gc-')
    writeFile(src, 'src/a.ts', 'ok\n')

    forkWorkerTree({ sourceDir: src, runId: 'old-run', slotId: 'slot-1' })
    forkWorkerTree({ sourceDir: src, runId: 'fresh-run', slotId: 'slot-1' })

    const oldRun = join(src, '.eyas-god', 'old-run')
    const freshRun = join(src, '.eyas-god', 'fresh-run')
    const now = Date.now()
    const stale = new Date(now - 120_000)
    utimesSync(oldRun, stale, stale)

    const { removed } = gcGodWorkspaces({ olderThanMs: 60_000, now })

    expect(removed).toBeGreaterThanOrEqual(1)
    expect(existsSync(oldRun)).toBe(false)
    expect(existsSync(freshRun)).toBe(true)
  })

  it('is safe on non-repos and deletes orphan god/* branches whose directory is gone', () => {
    const notRepo = tempDir('eyas-god-gc-norepo-')
    expect(() => gcGodWorkspaces({ olderThanMs: 1, now: Date.now() })).not.toThrow()
    expect(existsSync(notRepo)).toBe(true)

    const repo = tempDir('eyas-god-gc-orphan-')
    writeFile(repo, 'src/a.ts', 'ok\n')
    initGitRepo(repo)
    const forked = forkWorkerTree({ sourceDir: repo, runId: 'dead', slotId: 's1' })
    expect(forked.isolation).toBe('worktree')
    expect(listBranches(repo, 'god/*')).toContain('god/dead-s1')

    rmSync(forked.workspacePath, { recursive: true, force: true })
    const { removed } = gcGodWorkspaces({ olderThanMs: 0, now: Date.now() })
    expect(removed).toBeGreaterThanOrEqual(0)
    expect(listBranches(repo, 'god/*')).not.toContain('god/dead-s1')
  })
}, 30_000)
