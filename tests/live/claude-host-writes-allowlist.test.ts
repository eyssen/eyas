// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The Claude Code host-write allowlist matcher the live lane judges every
// Claude run with (claude-host-writes.ts). Runs in the default suite — no
// binary, no network: real files in a temp HOME, diffed the way the lane
// diffs the hostile one.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  checkClaudeHostWrites,
  ClaudeHostWritesAllowlistSchema,
  globToRegExp,
  loadClaudeHostWritesAllowlist,
  type ClaudeHostWritesAllowlist,
} from './claude-host-writes.js'
import { diffSnapshots, snapshotTree, type TreeSnapshot } from './hostile-home.js'
import { CLI_VERIFIED_VERSIONS } from '@modules/model/cli-runtime/verified-versions.js'

const allowlist: ClaudeHostWritesAllowlist = loadClaudeHostWritesAllowlist()
const CANARY = 'EYAS-LANE-CANARY-0123456789'
const BEFORE_JSON = { mcpServers: { host: { command: '/bin/true' } }, numStartups: 3 }

let home: string
let before: TreeSnapshot

function put(rel: string, content: string): void {
  mkdirSync(dirname(join(home, rel)), { recursive: true })
  writeFileSync(join(home, rel), content)
}

function check(forbidden: string[] = [CANARY]) {
  return checkClaudeHostWrites({
    home,
    diff: diffSnapshots(before, snapshotTree(home)),
    claudeJsonBefore: BEFORE_JSON,
    allowlist,
    forbidden,
  })
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'eyas-allowlist-'))
  put('.claude.json', JSON.stringify(BEFORE_JSON))
  put('.claude/settings.json', '{}')
  before = snapshotTree(home)
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('the allowlist file', () => {
  it('parses, and names the Claude Code version the verified-version record names', () => {
    expect(ClaudeHostWritesAllowlistSchema.safeParse(allowlist).success).toBe(true)
    expect(allowlist.binaryVersion).toBe(CLI_VERIFIED_VERSIONS['claude-code'].version)
    expect(allowlist.verifiedAt).toBe(CLI_VERIFIED_VERSIONS['claude-code'].verifiedAt)
  })

  it('refuses an entry outside HOME or with an unknown rule', () => {
    const bad = (entry: Record<string, unknown>) =>
      ClaudeHostWritesAllowlistSchema.safeParse({ ...allowlist, entries: [entry] }).success
    expect(bad({ glob: '/etc/passwd', rule: 'credential', reason: 'x' })).toBe(false)
    expect(bad({ glob: '../outside', rule: 'dir', reason: 'x' })).toBe(false)
    expect(bad({ glob: '.claude/x', rule: 'anything-goes', reason: 'x' })).toBe(false)
  })
})

describe('globToRegExp', () => {
  it('* stays inside one folder, ** crosses folders', () => {
    expect(globToRegExp('.claude/shell-snapshots/*').test('.claude/shell-snapshots/snapshot-zsh-1.sh')).toBe(true)
    expect(globToRegExp('.claude/shell-snapshots/*').test('.claude/shell-snapshots/a/b.sh')).toBe(false)
    expect(globToRegExp('.claude/**').test('.claude/a/b/c')).toBe(true)
    expect(globToRegExp('.claude.json').test('.claudexjson')).toBe(false)
  })
})

describe('checkClaudeHostWrites', () => {
  it('accepts a ~/.claude.json diff limited to listed bookkeeping keys, its backup and the empty session folders', () => {
    put('.claude.json', JSON.stringify({ ...BEFORE_JSON, firstStartTime: 'now', userID: 'u', cachedGrowthBookFeatures: {} }))
    put('.claude/backups/.claude.json.backup.1790000000000', JSON.stringify(BEFORE_JSON))
    mkdirSync(join(home, '.claude/sessions'), { recursive: true })
    mkdirSync(join(home, '.claude/session-env/0cdc58f6-8d8d-4973-8043-f01d57edd0df'), { recursive: true })
    put('.claude/shell-snapshots/snapshot-zsh-1.sh', 'alias ll="ls -l"\n')
    expect(check()).toEqual([])
  })

  it('accepts the 2.1.281 start-up bookkeeping: empty marker folders, the npm log of `npm root --global`, a Bun cache entry', () => {
    for (const dir of ['.claude/seed-admin', '.claude/.cc-writes', '.claude/bridge-spawn', '.config/anthropic']) mkdirSync(join(home, dir), { recursive: true })
    put('.npm/_logs/2026-09-24T08_52_29_082Z-debug-0.log', '7 verbose argv "root" "--global"\n')
    put('Library/Caches/bun/@t@/7b74564f82540e71.pile', 'compiled')
    expect(check()).toEqual([])
  })

  it('rejects a canary in the npm log, a file in a marker folder and a symlink in the cache', () => {
    put('.npm/_logs/2026-09-24T08_52_29_082Z-debug-0.log', `argv "${CANARY}"\n`)
    put('.claude/seed-admin/state.json', '{}')
    mkdirSync(join(home, 'Library/Caches/bun'), { recursive: true })
    symlinkSync(join(home, '.claude.json'), join(home, 'Library/Caches/bun/link'))
    const v = check()
    expect(v).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '.npm/_logs/2026-09-24T08_52_29_082Z-debug-0.log', kind: 'forbidden-string' }),
      expect.objectContaining({ path: '.claude/seed-admin', kind: 'rule' }),
      expect.objectContaining({ path: '.claude/seed-admin/state.json', kind: 'unlisted' }),
      expect.objectContaining({ path: 'Library/Caches/bun/link', kind: 'rule' }),
    ]))
  })

  it('accepts a credential refresh without ever reading it', () => {
    put('.claude/.credentials.json', `{"token":"${CANARY}"}`)
    expect(check()).toEqual([])
  })

  it('rejects a new top-level key in ~/.claude.json', () => {
    put('.claude.json', JSON.stringify({ ...BEFORE_JSON, firstStartTime: 'now', projects: { '/work': { history: ['hi'] } } }))
    const v = check()
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({ path: '.claude.json', kind: 'rule' })
    expect(v[0].detail).toContain("new top-level key 'projects'")
  })

  it('rejects a changed or removed pre-existing key in ~/.claude.json', () => {
    put('.claude.json', JSON.stringify({ numStartups: 4 }))
    const [v] = check()
    expect(v.detail).toContain("changed top-level key 'numStartups'")
    expect(v.detail).toContain("removed top-level key 'mcpServers'")
  })

  it.each([
    '.claude/projects/-work-project/0cdc58f6.jsonl',
    '.claude/projects/-work-project/memory/MEMORY.md',
    '.claude/todos/0cdc58f6-agent.json',
    '.claude/file-history/0cdc58f6/abc@v1',
    '.claude/plans/plan.md',
    '.claude/history.jsonl',
    '.claude/session-env/0cdc58f6/hook-env.sh',
  ])('rejects content-bearing %s', (rel) => {
    put(rel, 'content')
    const v = check()
    expect(v.some((x) => x.path === rel && x.kind === 'content-bearing')).toBe(true)
  })

  it('rejects a session-env folder that is not empty', () => {
    put('.claude/session-env/0cdc58f6/env', 'X=1')
    const v = check()
    expect(v.some((x) => x.path === '.claude/session-env/0cdc58f6' && x.kind === 'rule')).toBe(true)
  })

  it('rejects a shell snapshot that contains the canary', () => {
    put('.claude/shell-snapshots/snapshot-zsh-1.sh', `echo ${CANARY}\n`)
    expect(check()).toEqual([expect.objectContaining({ path: '.claude/shell-snapshots/snapshot-zsh-1.sh', kind: 'forbidden-string' })])
  })

  it('rejects the canary inside an allowlisted ~/.claude.json key', () => {
    put('.claude.json', JSON.stringify({ ...BEFORE_JSON, seenNotifications: { last: CANARY } }))
    expect(check()).toEqual([expect.objectContaining({ path: '.claude.json', kind: 'forbidden-string' })])
  })

  it('rejects a backup holding keys ~/.claude.json never had', () => {
    put('.claude/backups/.claude.json.backup.1', JSON.stringify({ ...BEFORE_JSON, projects: {} }))
    expect(check()).toEqual([expect.objectContaining({ path: '.claude/backups/.claude.json.backup.1', kind: 'rule' })])
  })

  it('rejects an unlisted host path and a removed one', () => {
    put('.claude/statsig/cache.json', '{}')
    rmSync(join(home, '.claude/settings.json'))
    const v = check()
    expect(v).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '.claude/statsig', kind: 'unlisted' }),
      expect.objectContaining({ path: '.claude/settings.json', kind: 'removed' }),
    ]))
  })

  it('accepts the stale ~/.claude.json lock folder an earlier run left being cleared', () => {
    mkdirSync(join(home, '.claude.json.lock'))
    before = snapshotTree(home)
    rmSync(join(home, '.claude.json.lock'), { recursive: true })
    expect(check()).toEqual([])
  })

  it('rejects a lock folder that holds something', () => {
    put('.claude.json.lock/owner', `${process.pid}\n`)
    expect(check()).toEqual(expect.arrayContaining([expect.objectContaining({ path: '.claude.json.lock', kind: 'rule' })]))
  })

  it('still rejects the removal of an empty folder that is not a lock', () => {
    mkdirSync(join(home, '.claude/sessions'), { recursive: true })
    before = snapshotTree(home)
    rmSync(join(home, '.claude/sessions'), { recursive: true })
    expect(check()).toEqual([expect.objectContaining({ path: '.claude/sessions', kind: 'removed' })])
  })

  it('rejects a file where the allowlist expects an empty folder', () => {
    put('.claude/sessions', 'not a folder')
    expect(check()).toEqual([expect.objectContaining({ path: '.claude/sessions', kind: 'rule' })])
  })
})
