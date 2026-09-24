// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { collectWalk, walkTree, type WalkEntry } from '@modules/data-port/scanners/scan-path'

let root: string
let outside: string

const mk = (rel: string, body = 'x'): void => {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, body)
}
const dir = (rel: string): void => {
  mkdirSync(join(root, rel), { recursive: true })
}

/**
 * A home-shaped tree: assistant dot-directories, a vault, a source tree, a
 * `Library` with a class directory in it, and exactly ONE symlink pointing out
 * of the root. Built on demand so the cases that count every file of their own
 * fixture start from an empty root.
 */
const homeShaped = (): void => {
  mk('.claude/skills/x/SKILL.md', '---\nname: x\ndescription: d\n---\n# x\n')
  mk('.claude/projects/slug/memory/n.md', '---\ntype: user\n---\nme')
  mk('.claude/projects/slug/x.jsonl', '{"type":"user"}\n')
  mk('.grok/memory/alpha-note.md', '# grok fact\n')
  mk('Documents/Vault/.obsidian/app.json', '{"legacyEditor":false}')
  mk('Documents/Vault/notes/bravo-fact.md', '---\ntype: feedback\n---\nA durable note.\n')
  mk('GitHub/alpha/src/README.md', '# repo\n')
  for (let i = 0; i < 80; i++) mk(`GitHub/alpha/pkg-${i}/note.md`, `# pkg ${i}\n`)
  mk('Library/Caches/charlie.cache', 'cached')
  mk('Library/Application Support/alpha/state.json', '{"a":1}')
  // The one symlink: an ai-memory folder pointing at a note outside the root.
  writeFileSync(join(outside, 'linked-memory.md'), '# Linked from a vault\n')
  dir('notes/ai-memory')
  symlinkSync(join(outside, 'linked-memory.md'), join(root, 'notes/ai-memory/linked.md'))
}

const files = (
  scanRoot: string,
  opts?: { followSymlinks?: boolean },
): { files: string[]; entries: WalkEntry[]; summary: ReturnType<typeof collectWalk>['summary'] } => {
  const { entries, summary } = collectWalk(scanRoot, opts)
  return {
    files: entries.filter((e) => e.type === 'file').map((e) => e.path),
    entries,
    summary,
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eyas-walk-'))
  outside = mkdtempSync(join(tmpdir(), 'eyas-walk-out-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('data-port walker (R11.2)', () => {
  it('walks into .claude/skills and follows symlinks', () => {
    homeShaped()
    const r = files(root)
    expect(r.files.some((f) => f.endsWith('.claude/skills/x/SKILL.md'))).toBe(true)
    expect(r.files.some((f) => f.endsWith('notes/ai-memory/linked.md'))).toBe(true)
    expect(r.summary.symlinksFollowed).toBe(1)
    // collectWalk drops ticks
    expect(r.entries.some((e) => e.type === 'tick')).toBe(false)
  })

  it('carries the running counters on every tick', () => {
    for (let i = 0; i < 1100; i++) mk(`bulk/b${i}.md`)
    const ticks = [...walkTree(root)].filter((e) => e.type === 'tick') as Array<
      Extract<WalkEntry, { type: 'tick' }>
    >
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    expect(ticks.map((t) => t.filesSeen)).toEqual([...ticks.map((t) => t.filesSeen)].sort((a, b) => a - b))
    expect(ticks.at(-1)!.filesSeen).toBeGreaterThanOrEqual(1000)
    expect(ticks[0]!.dirsVisited).toBeGreaterThanOrEqual(1)
  })

  it('does not follow symlinks when the caller turns them off', () => {
    homeShaped()
    const r = files(root, { followSymlinks: false })
    expect(
      r.entries.find((e) => e.type === 'symlink-unfollowed' && e.path.endsWith('notes/ai-memory/linked.md')),
    ).toBeTruthy()
  })

  it('lists project transcripts of a home-shaped root', () => {
    homeShaped()
    expect(files(root).files.some((f) => f.endsWith('.claude/projects/slug/x.jsonl'))).toBe(true)
  })

  it('enters every dot-directory', () => {
    const rels = ['.grok/relocations/a.json', '.grok/memtrace/b.json', '.config/foo/bar.toml', '.ssh/config']
    for (const rel of rels) mk(rel)
    const list = files(root).files
    for (const rel of rels) expect(list.some((f) => f.endsWith(rel))).toBe(true)
  })

  it('maps every top-level folder of a home-shaped root', () => {
    homeShaped()
    const r = files(root)
    expect(r.files.filter((f) => /GitHub\/alpha\/pkg-\d+\/note\.md$/.test(f))).toHaveLength(80)
    expect(r.files.some((f) => f.endsWith('.grok/memory/alpha-note.md'))).toBe(true)
    expect(r.files.some((f) => f.endsWith('Library/Application Support/alpha/state.json'))).toBe(true)
    expect(r.entries.find((e) => e.type === 'directory-skipped' && e.cls === 'os-cache')).toBeTruthy()
    expect(r.summary.dirsVisited).toBeGreaterThanOrEqual(84)
  })

  it('lists a non-text file everywhere, as a file entry', () => {
    mk('notes/logo.png')
    mk('.claude/skills/x/SKILL.md')
    mk('.claude/skills/x/logo.png')
    const list = files(root).files
    expect(list.filter((f) => f.endsWith('logo.png'))).toHaveLength(2)
  })

  it('yields .DS_Store as a file entry', () => {
    mk('notes/.DS_Store')
    expect(files(root).files.some((f) => f.endsWith('.DS_Store'))).toBe(true)
  })

  it('yields a symlink cycle as an alias and terminates', () => {
    mk('a/b/n.md')
    symlinkSync(join(root, 'a'), join(root, 'a/b/up'))
    const r = files(root)
    expect(r.files.filter((f) => f.endsWith('n.md'))).toHaveLength(1)
    expect(r.entries.find((e) => e.type === 'directory-alias' && e.cycle)).toBeTruthy()
    expect(r.summary.symlinkCycles).toBe(1)
  })

  it('calls a link to its own parent a cycle, not a plain alias', () => {
    // The commonest cycle shape, and the one a strict-ancestor chain misses:
    // the target IS the parent, so it is never a member of that chain.
    mk('alpha/n.md')
    symlinkSync(join(root, 'alpha'), join(root, 'alpha/self'))
    const r = files(root)
    expect(r.files.filter((f) => f.endsWith('n.md'))).toHaveLength(1)
    expect(r.entries.find((e) => e.type === 'directory-alias' && e.path.endsWith('alpha/self'))).toMatchObject(
      { cycle: true, firstPath: join(root, 'alpha') },
    )
    expect(r.summary.symlinkCycles).toBe(1)
  })

  it('calls a second name for an unrelated directory an alias, not a cycle', () => {
    // The negative case that keeps the cycle test honest: a diamond, where the
    // same directory is reached twice but never from inside itself.
    mk('bravo/n.md')
    dir('charlie')
    symlinkSync(join(root, 'bravo'), join(root, 'charlie/link'))
    const r = files(root)
    expect(r.files.filter((f) => f.endsWith('n.md'))).toHaveLength(1)
    expect(r.entries.find((e) => e.type === 'directory-alias')).toMatchObject({ cycle: false })
    expect(r.summary.symlinkCycles).toBe(0)
  })

  it('counts an aliased class directory once in the summary and once per path in the rows', () => {
    mk('alpha/node_modules/m/index.js')
    mk('alpha/node_modules/d.js')
    dir('notes')
    symlinkSync(join(root, 'alpha/node_modules'), join(root, 'notes/deps'))
    const r = files(root)
    const skipped = r.entries.filter((e) => e.type === 'directory-skipped')
    // Two paths reach it, so two rows — each carrying the true count of the one tree.
    expect(skipped).toHaveLength(2)
    for (const e of skipped) expect(e).toMatchObject({ cls: 'node_modules', files: 2, dirs: 1 })
    expect(r.summary.dirsSkipped.node_modules).toBe(2)
    // …but the aggregate counts the tree behind them once.
    expect(r.summary.filesInSkippedDirs).toBe(2)
  })

  it('yields a broken symlink as a visible entry', () => {
    symlinkSync(join(root, 'nowhere'), join(root, 'dangling'))
    expect(files(root).entries.find((e) => e.type === 'symlink-broken')).toMatchObject({
      target: join(root, 'nowhere'),
    })
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'yields an unreadable directory',
    () => {
      dir('locked')
      mk('locked/x.md')
      chmodSync(join(root, 'locked'), 0o000)
      try {
        expect(files(root).entries.find((e) => e.type === 'directory-unreadable')).toBeTruthy()
      } finally {
        chmodSync(join(root, 'locked'), 0o755)
      }
    },
  )

  it('reaches every file of a 5-level tree with no cap', () => {
    for (let d = 0; d < 300; d++) for (let f = 0; f < 10; f++) mk(`l1/l2-${d % 10}/l3-${d}/l4/l5/f${f}.md`)
    const r = files(root)
    expect(r.files).toHaveLength(3000)
    expect(r.summary.filesSeen).toBe(3000)
  })
})
