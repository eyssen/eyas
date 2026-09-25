// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Per-run scratch folders (formerly B6's resolveCliSessionCwd): a background or
// agent run with no folders works in <workspacesRoot>/_runs/<runId>, which is
// never inside a git work tree, and a TTL sweeper removes abandoned ones.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasGitAncestor } from '@core/instance.js'
import {
  CLI_QUERY_TMP_PREFIX,
  RUN_SCRATCH_DIR,
  RUN_SCRATCH_TTL_MS,
  cliQueryTmp,
  resolveCliCwd,
  runScratchCwd,
  startRunScratchSweeper,
  sweepRunScratch,
} from '@modules/model/cli-runtime/workspaces.js'

let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-runs-')))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function age(dir: string, ms: number): void {
  const at = (Date.now() - ms) / 1000
  utimesSync(dir, at, at)
}

describe('run scratch folders', () => {
  it('gives a background or agent run without folders <root>/_runs/<runId>', () => {
    const cwd = resolveCliCwd({ metadata: { runId: 'sess-1', origin: 'scheduled' } }, { root, dataDir: join(root, 'data') })
    expect(cwd).toBe(join(root, RUN_SCRATCH_DIR, 'sess-1'))
    expect(existsSync(cwd)).toBe(true)
  })

  it('has no git ancestor', () => {
    expect(hasGitAncestor(runScratchCwd('sess-2', { root }))).toBe(false)
  })

  it('gives two concurrent runs distinct folders', () => {
    const a = runScratchCwd('run-a', { root })
    const b = runScratchCwd('run-b', { root })
    expect(a).not.toBe(b)
    writeFileSync(join(a, 'out.txt'), 'a')
    expect(existsSync(join(b, 'out.txt'))).toBe(false)
  })

  it('returns the same folder for the same run, keeping what it wrote', () => {
    const first = runScratchCwd('run-c', { root })
    writeFileSync(join(first, 'draft.md'), 'x')
    expect(runScratchCwd('run-c', { root })).toBe(first)
    expect(existsSync(join(first, 'draft.md'))).toBe(true)
  })

  it('refuses an unsafe run id', () => {
    expect(() => runScratchCwd('../../x', { root })).toThrow(/invalid run id/)
  })
})

describe('sweepRunScratch', () => {
  it('removes folders untouched past the TTL', () => {
    const stale = runScratchCwd('old-run', { root })
    writeFileSync(join(stale, 'f'), 'x')
    age(stale, RUN_SCRATCH_TTL_MS + 60_000)
    expect(sweepRunScratch({ root })).toEqual([stale])
    expect(existsSync(stale)).toBe(false)
  })

  it('keeps live folders', () => {
    const live = runScratchCwd('live-run', { root })
    age(live, RUN_SCRATCH_TTL_MS - 60_000)
    expect(sweepRunScratch({ root })).toEqual([])
    expect(existsSync(live)).toBe(true)
  })

  it('a resolve touches the folder, so a long-running run is not swept', () => {
    const dir = runScratchCwd('long-run', { root })
    age(dir, RUN_SCRATCH_TTL_MS + 60_000)
    runScratchCwd('long-run', { root })
    expect(sweepRunScratch({ root })).toEqual([])
    expect(existsSync(dir)).toBe(true)
  })

  it('touches nothing outside _runs, and nothing that is not a run folder', () => {
    const conversation = join(root, 'conv-1')
    mkdirSync(conversation)
    age(conversation, RUN_SCRATCH_TTL_MS * 3)
    mkdirSync(join(root, RUN_SCRATCH_DIR, '.hidden'), { recursive: true })
    age(join(root, RUN_SCRATCH_DIR, '.hidden'), RUN_SCRATCH_TTL_MS * 3)
    expect(sweepRunScratch({ root })).toEqual([])
    expect(existsSync(conversation)).toBe(true)
    expect(existsSync(join(root, RUN_SCRATCH_DIR, '.hidden'))).toBe(true)
  })

  it('is a no-op when no run ever needed a folder', () => {
    expect(sweepRunScratch({ root: join(root, 'missing') })).toEqual([])
  })
})

describe('startRunScratchSweeper', () => {
  it('sweeps at start and logs what it removed; stop clears the timer', () => {
    const stale = runScratchCwd('boot-stale', { root })
    age(stale, RUN_SCRATCH_TTL_MS + 60_000)
    const logger = { warn: vi.fn(), info: vi.fn() }
    const stop = startRunScratchSweeper({ root, logger, intervalMs: 60_000 })
    expect(existsSync(stale)).toBe(false)
    expect(logger.info).toHaveBeenCalledWith({ count: 1 }, expect.any(String))
    stop()
  })
})

describe('cliQueryTmp — a CLI query\'s private temp folder', () => {
  it('(+) is its own folder in _runs, created 0700 only on create(), and release removes it with its content', () => {
    const tmp = cliQueryTmp({ root })
    expect(tmp.dir.startsWith(join(root, RUN_SCRATCH_DIR, CLI_QUERY_TMP_PREFIX))).toBe(true)
    expect(existsSync(tmp.dir)).toBe(false)
    expect(tmp.create()).toBe(tmp.dir)
    expect(statSync(tmp.dir).mode & 0o777).toBe(0o700)
    mkdirSync(join(tmp.dir, 'claude-501', 'slug', 'session', 'tasks'), { recursive: true })
    writeFileSync(join(tmp.dir, 'claude-501', 'slug', 'session', 'tasks', 'b1.output'), 'background output')
    tmp.release()
    expect(existsSync(tmp.dir)).toBe(false)
    // Idempotent, and never throws for a folder that is already gone.
    expect(() => tmp.release()).not.toThrow()
  })

  it('(−) two queries never share a folder', () => {
    expect(cliQueryTmp({ root }).dir).not.toBe(cliQueryTmp({ root }).dir)
  })

  it('(+) the sweep removes a temp folder made before this process started, however young', () => {
    const left = cliQueryTmp({ root })
    left.create()
    age(left.dir, 60_000)
    expect(sweepRunScratch({ root, processStartedAt: Date.now() - 1_000 })).toEqual([left.dir])
    expect(existsSync(left.dir)).toBe(false)
  })

  it('(−) the sweep keeps a temp folder of this process, and a young run folder beside it', () => {
    const live = cliQueryTmp({ root })
    live.create()
    const run = runScratchCwd('run-beside', { root })
    age(run, 60_000)
    expect(sweepRunScratch({ root, processStartedAt: Date.now() - 3_600_000 })).toEqual([])
    expect(existsSync(live.dir)).toBe(true)
    expect(existsSync(run)).toBe(true)
  })
})
