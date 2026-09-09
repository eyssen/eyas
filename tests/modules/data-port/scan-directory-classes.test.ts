// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { classifyDirectory, collectCount, countTree, nameClass } from '@modules/data-port/scanners/directory-classes'
import { collectWalk, walkTree } from '@modules/data-port/scanners/scan-path'

let root: string
const mk = (rel: string, body = 'x'): void => {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, body)
}
const dir = (rel: string): void => {
  mkdirSync(join(root, rel), { recursive: true })
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dp-classes-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const cls = (name: string, children: string[] = [], siblings: string[] = [], parent = '/alpha') =>
  classifyDirectory(name, `${parent}/${name}`, children, siblings, parent)

describe('cloud storage (A-66)', () => {
  /*
   * A scan of a home directory walked `~/Library/CloudStorage/OneDrive-…` and
   * began materialising placeholders: 1 018 files seen but 9.7 GB of bytes
   * counted in 125 seconds, against a 367 MB local footprint. The classifier
   * reads a head of every file, and for a dematerialised file that read is a
   * download the owner never asked for.
   *
   * It is a CLASS, not a refusal: one counted visible row, and a scan pointed
   * straight at the folder still walks it, because the root is never classified.
   */
  it('names the macOS File Provider roots by their place, not by their name', () => {
    expect(cls('CloudStorage', [], [], '/alpha/Library')).toBe('cloud-storage')
    expect(cls('Mobile Documents', [], [], '/alpha/Library')).toBe('cloud-storage')
    // The same names anywhere else are the owner's own folders.
    expect(cls('CloudStorage', [], [], '/alpha/Documents')).toBeNull()
    expect(cls('Mobile Documents', [], [], '/alpha/Projects')).toBeNull()
  })

  it('finds a legacy sync root by the provider marker inside it, never by its name', () => {
    expect(cls('Dropbox', ['.dropbox', 'Notes'])).toBe('cloud-storage')
    expect(cls('OneDrive - Alpha', ['.849C9593-D756-4E56-8D6E-42412F2A707B'])).toBe('cloud-storage')
    // A folder somebody happened to call Dropbox is theirs, and is walked.
    expect(cls('Dropbox', ['Notes', 'Photos'])).toBeNull()
    expect(cls('OneDrive - Alpha', ['Notes'])).toBeNull()
  })

  it('is one counted row in a walk, with its files never entered', () => {
    dir('Library/CloudStorage/OneDrive-Alpha/Deep')
    mk('Library/CloudStorage/OneDrive-Alpha/a.md', '# alpha')
    mk('Library/CloudStorage/OneDrive-Alpha/Deep/b.md', '# bravo')
    mk('Documents/keep.md', '# charlie')

    const { entries, summary } = collectWalk(root)
    const skipped = entries.filter((e) => e.type === 'directory-skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toMatchObject({ cls: 'cloud-storage', files: 2 })
    expect(summary.dirsSkipped['cloud-storage']).toBe(1)
    expect(summary.filesInSkippedDirs).toBe(2)
    // Nothing under it is a row of its own…
    expect(entries.some((e) => e.type === 'file' && e.path.includes('CloudStorage'))).toBe(false)
    // …and the rest of the tree is untouched.
    expect(entries.some((e) => e.type === 'file' && e.path.endsWith('keep.md'))).toBe(true)
  })
})

describe('classifyDirectory (D-9, P-4)', () => {
  it('names the bare-name classes', () => {
    expect(cls('node_modules')).toBe('node_modules')
    for (const v of ['.git', '.hg', '.svn']) expect(cls(v)).toBe('vcs')
    expect(cls('.cache')).toBe('cache')
    expect(cls('__pycache__')).toBe('pycache')
    expect(cls('.venv')).toBe('venv')
    expect(cls('venv')).toBe('venv')
    expect(cls('.Trash')).toBe('trash')
    expect(cls('$RECYCLE.BIN')).toBe('trash')
    expect(cls('Trash', [], [], '/alpha/.local/share')).toBe('trash')
    expect(cls('Trash', [], [], '/alpha/Documents')).toBeNull()
    expect(cls('Caches', [], [], '/alpha/Library')).toBe('os-cache')
    expect(cls('Caches', [], [], '/alpha/Documents')).toBeNull()
  })

  it('takes build outputs only beside a build manifest', () => {
    for (const b of ['dist', 'build', 'out', '.next', '.turbo', 'target']) {
      expect(cls(b, [], ['package.json'])).toBe('build-output')
      expect(cls(b, [], ['notes.md'])).toBeNull()
    }
    expect(cls('target', [], ['Cargo.toml'])).toBe('build-output')
  })

  it('recognises browser profiles by content markers wherever they sit', () => {
    expect(cls('Default', ['Preferences', 'History'])).toBe('browser-profile')
    expect(cls('profile', ['Local State', 'Default'])).toBe('browser-profile')
    expect(cls('abc.default-release', ['prefs.js', 'places.sqlite'])).toBe('browser-profile')
    expect(cls('Default', ['Preferences'])).toBeNull()
  })

  it('classifies nothing else', () => {
    for (const n of [
      'Library',
      'Applications',
      'Downloads',
      'Movies',
      'Music',
      'Pictures',
      'vendor',
      'coverage',
      'GitHub',
      '.tox',
      'relocations',
      'sessions',
      'plugins',
      '.config',
      '.ssh',
    ]) {
      expect(cls(n)).toBeNull()
    }
  })

  it('maps package caches, Photos libraries and tool ephemera as one counted class each', () => {
    expect(cls('.pub-cache')).toBe('package-cache')
    expect(cls('.rustup')).toBe('package-cache')
    expect(cls('.cargo')).toBe('package-cache')
    expect(cls('.bun')).toBe('package-cache')
    expect(cls('registry', [], [], '/alpha/.cargo')).toBe('package-cache')
    expect(cls('cache', [], [], '/alpha/.bun/install')).toBe('package-cache')
    expect(cls('site-packages')).toBe('package-cache')
    expect(cls('Photos Library.photoslibrary')).toBe('photos-library')
    expect(cls('session-stats', [], [], '/alpha/.claude')).toBe('tool-ephemera')
    expect(cls('marketplace-cache', [], [], '/alpha/.grok')).toBe('tool-ephemera')
    expect(cls('.tmp', [], [], '/alpha/.codex')).toBe('tool-ephemera')
    expect(cls('extensions', [], [], '/alpha/.vscode')).toBe('tool-ephemera')
    expect(cls('eyas-memory-backup-20260908-083518')).toBe('tool-ephemera')
    // A folder the owner named similarly is still theirs.
    expect(cls('session-stats', [], [], '/alpha/Documents')).toBeNull()
    expect(cls('extensions', [], [], '/alpha/Documents')).toBeNull()
    expect(cls('cache', [], [], '/alpha/Documents')).toBeNull()
  })

  it('does not enter a Photos library during a home walk', () => {
    dir('Pictures/Photos Library.photoslibrary/database/search')
    mk('Pictures/Photos Library.photoslibrary/database/search/a.txt', 'spotlight')
    mk('Documents/keep.md', '# keep')
    const { entries, summary } = collectWalk(root)
    expect(summary.dirsSkipped['photos-library']).toBe(1)
    expect(entries.some((e) => e.type === 'file' && e.path.includes('photoslibrary'))).toBe(false)
    expect(entries.some((e) => e.type === 'file' && e.path.endsWith('keep.md'))).toBe(true)
  })
})

describe('nameClass', () => {
  it('decides what is read, never what is listed', () => {
    expect(nameClass('.DS_Store')).toBe('app-state')
    expect(nameClass('notes.sqlite')).toBe('derived-db')
    expect(nameClass('logo.png')).toBe('binary')
    expect(nameClass('script')).toBe('unknown')
    expect(nameClass('.env.local')).toBe('text')
    expect(nameClass('run.log')).toBe('text')
    expect(nameClass('Makefile')).toBe('text')
    expect(nameClass('rules.mdc')).toBe('text')
  })
})

describe('countTree', () => {
  it('counts a class directory without descending it in the walk', () => {
    mk('alpha/node_modules/a/b/c.js')
    mk('alpha/node_modules/d.js')
    dir('alpha/node_modules/e')
    expect(collectCount(join(root, 'alpha/node_modules'))).toEqual({ files: 2, dirs: 3, unreadable: 0 })
    const { entries } = collectWalk(root)
    const skipped = entries.filter((e) => e.type === 'directory-skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toMatchObject({ cls: 'node_modules', files: 2, dirs: 3 })
    expect(entries.some((e) => e.type === 'file' && e.path.includes('node_modules'))).toBe(false)
  })

  it('counts a symlink inside a class directory as a file and never follows it', () => {
    mk('alpha/node_modules/x.js')
    symlinkSync(join(root, 'alpha/node_modules'), join(root, 'alpha/node_modules/loop'))
    expect(collectCount(join(root, 'alpha/node_modules'))).toEqual({ files: 2, dirs: 0, unreadable: 0 })
  })

  it('ticks while counting a big class directory, before the skipped entry is yielded', () => {
    // 300 folders x 5 files: more than PROGRESS_EVERY_DIRS directories under one class root.
    for (let d = 0; d < 300; d++) for (let f = 0; f < 5; f++) mk(`alpha/node_modules/p${d}/f${f}.js`)
    mk('alpha/notes.md', '# n')
    let ticks = 0
    const g = countTree(join(root, 'alpha/node_modules'))
    let n = g.next()
    while (!n.done) {
      ticks++
      n = g.next()
    }
    expect(ticks).toBeGreaterThanOrEqual(1)
    expect(n.value).toEqual({ files: 1500, dirs: 300, unreadable: 0 })
    // The walker forwards those ticks: at least one `tick` precedes the `directory-skipped` entry.
    const seen: string[] = []
    for (const e of walkTree(root)) {
      seen.push(e.type)
      if (e.type === 'directory-skipped') break
    }
    expect(seen.indexOf('tick')).toBeGreaterThanOrEqual(0)
    expect(seen.indexOf('tick')).toBeLessThan(seen.indexOf('directory-skipped'))
  })
})

describe('skill package roots', () => {
  it('names the nearest skill root on every file and says when the package is done, whatever the listing order', () => {
    mk('.claude/skills/deploy/.env', 'x')
    mk('.claude/skills/deploy/README.md', '# r')
    mk('.claude/skills/deploy/SKILL.md', '# s')
    mk('.claude/skills/deploy/scripts/run.sh', 'echo')
    mk('.claude/skills/deploy/nested/SKILL.md', '# inner')
    mk('.claude/skills/deploy/nested/a.txt', 'a')
    mk('notes/plain.md', '# p')
    const { entries } = collectWalk(root)
    const rootOf = (rel: string): string | null =>
      (entries.find((e) => e.type === 'file' && e.path.endsWith(rel)) as Extract<
        (typeof entries)[number],
        { type: 'file' }
      >).skillRoot
    const deploy = join(root, '.claude/skills/deploy')
    for (const rel of ['deploy/.env', 'deploy/README.md', 'deploy/SKILL.md', 'deploy/scripts/run.sh']) {
      expect(rootOf(rel)).toBe(deploy)
    }
    expect(rootOf('nested/a.txt')).toBe(join(deploy, 'nested'))
    expect(rootOf('notes/plain.md')).toBeNull()
    const types = entries.map((e) => e.type)
    const doneIdx = entries.findIndex((e) => e.type === 'skill-package-done' && e.root === deploy)
    expect(doneIdx).toBeGreaterThan(
      entries.findIndex((e) => e.type === 'file' && e.path.endsWith('scripts/run.sh')),
    )
    expect(types.filter((t) => t === 'skill-package-done')).toHaveLength(2)
  })
})

describe('walker and classes', () => {
  it('never classifies the scan root', () => {
    mk('index.js')
    const nm = join(root, 'node_modules')
    mkdirSync(nm)
    writeFileSync(join(nm, 'm.js'), 'x')
    const { entries } = collectWalk(nm)
    expect(entries.filter((e) => e.type === 'file').map((e) => e.path)).toEqual([join(nm, 'm.js')])
  })

  it('classifies a symlink by its real directory', () => {
    mk('alpha/node_modules/m/index.js')
    dir('notes')
    symlinkSync(join(root, 'alpha/node_modules'), join(root, 'notes/deps'))
    const { entries } = collectWalk(root)
    expect(entries.filter((e) => e.type === 'directory-skipped').map((e) => e.cls)).toEqual([
      'node_modules',
      'node_modules',
    ])
  })
})
