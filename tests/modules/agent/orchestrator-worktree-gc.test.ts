// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gcOrphanedWorktrees } from '@modules/agent/orchestrator'

/**
 * S7 regression tests — orphaned worktree cleanup.
 *
 * These exercise real git against a throwaway repo so we can verify that
 * (a) abandoned `agent/*` branches whose worktrees are gone get deleted,
 * (b) `git worktree prune` runs without throwing, and
 * (c) the function is safe to call on directories that aren't git repos.
 */
describe('orchestrator: gcOrphanedWorktrees', () => {
  let repo: string

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'eyas-wt-gc-'))
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo })
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init', '-q'], { cwd: repo })
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('deletes agent/* branches whose worktree directory has disappeared', () => {
    // Create an agent worktree, then rm -rf its directory to simulate a crash
    // that left the branch behind without the working copy.
    const wtPath = join(repo, '.eyas-worktrees', 'agent-zombie')
    execFileSync('git', ['worktree', 'add', '-b', 'agent/zombie-1', wtPath, 'HEAD'], {
      cwd: repo,
      stdio: 'pipe',
    })
    rmSync(wtPath, { recursive: true, force: true })

    const before = execFileSync('git', ['branch', '--list', 'agent/*'], {
      cwd: repo,
      encoding: 'utf-8',
    })
    expect(before).toContain('agent/zombie-1')

    const result = gcOrphanedWorktrees(repo)
    expect(result.pruned).toBe(true)
    expect(result.branchesDeleted).toBeGreaterThanOrEqual(1)

    const after = execFileSync('git', ['branch', '--list', 'agent/*'], {
      cwd: repo,
      encoding: 'utf-8',
    })
    expect(after).not.toContain('agent/zombie-1')
  })

  it('leaves live worktrees and their branches alone', () => {
    const wtPath = join(repo, '.eyas-worktrees', 'agent-live')
    execFileSync('git', ['worktree', 'add', '-b', 'agent/live-1', wtPath, 'HEAD'], {
      cwd: repo,
      stdio: 'pipe',
    })

    const result = gcOrphanedWorktrees(repo)
    expect(result.branchesDeleted).toBe(0)

    const branches = execFileSync('git', ['branch', '--list', 'agent/*'], {
      cwd: repo,
      encoding: 'utf-8',
    })
    expect(branches).toContain('agent/live-1')
  })

  it('is a no-op on directories that are not git repositories', () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'eyas-notrepo-'))
    try {
      const result = gcOrphanedWorktrees(notARepo)
      // Should not throw; pruned=false because git had nothing to do
      expect(result.pruned).toBe(false)
      expect(result.branchesDeleted).toBe(0)
    } finally {
      rmSync(notARepo, { recursive: true, force: true })
    }
  })

  it('is idempotent — running twice is safe', () => {
    const wtPath = join(repo, '.eyas-worktrees', 'agent-idem')
    execFileSync('git', ['worktree', 'add', '-b', 'agent/idem-1', wtPath, 'HEAD'], {
      cwd: repo,
      stdio: 'pipe',
    })
    rmSync(wtPath, { recursive: true, force: true })

    const first = gcOrphanedWorktrees(repo)
    const second = gcOrphanedWorktrees(repo)
    expect(first.branchesDeleted).toBeGreaterThanOrEqual(1)
    expect(second.branchesDeleted).toBe(0)
  })
})
