// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chmodSync, closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { scanDirectory, scanDirectoryEvents } from '@modules/data-port/scanners/scan-path'
import { DIRECTORY_CLASSES } from '@modules/data-port/types'
import { assembleSkillContent, buildSkillFromPackage } from '@modules/data-port/skill-package'

/**
 * `vi.spyOn(fs, 'readFileSync')` cannot work here — an ESM module namespace is
 * not configurable — so the two ways this scanner can touch a file's bytes are
 * recorded through a pass-through module mock instead. Nothing is stubbed: every
 * call reaches the real function.
 */
const fsCalls = vi.hoisted(() => ({
  read: [] as string[],
  open: [] as string[],
  vanish: new Set<string>(),
  /**
   * A-85/A-84: stand in for a platform that does not populate `st_blocks`. The
   * calibration subject is the running executable, out of tree, so a broken
   * platform can only be simulated at the platform level — an all-sparse tree no
   * longer simulates one, and should not.
   */
  blocksAlwaysZero: false,
}))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  /** A file listed by the walker and gone by the time the scanner opens it. */
  const raceIfVanished = (path: unknown): void => {
    if (!fsCalls.vanish.has(String(path))) return
    const err = new Error(`ENOENT: no such file or directory, open '${String(path)}'`) as Error & { code: string }
    err.code = 'ENOENT'
    throw err
  }
  return {
    ...actual,
    default: actual,
    readFileSync: (path: unknown, ...rest: unknown[]) => {
      fsCalls.read.push(String(path))
      raceIfVanished(path)
      return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest)
    },
    openSync: (path: unknown, ...rest: unknown[]) => {
      fsCalls.open.push(String(path))
      raceIfVanished(path)
      return (actual.openSync as (...a: unknown[]) => unknown)(path, ...rest)
    },
    statSync: (path: unknown, ...rest: unknown[]) => {
      const st = (actual.statSync as (...a: unknown[]) => { blocks: number }) (path, ...rest)
      // Only the number is doctored, and only when a case asks for it: the rest
      // of `Stats` — size, mtime, isFile — stays the real one.
      if (fsCalls.blocksAlwaysZero && st && typeof st === 'object') {
        return new Proxy(st, { get: (t, k) => (k === 'blocks' ? 0 : Reflect.get(t, k)) })
      }
      return st
    },
  }
})

/** `chmod 0o000` denies nothing to root, so those two cases only run unprivileged. */
const canDenyRead = typeof process.getuid !== 'function' || process.getuid() !== 0

let root: string
const put = (rel: string, body: string | Buffer = 'x'): void => {
  const f = join(root, rel)
  mkdirSync(join(f, '..'), { recursive: true })
  writeFileSync(f, body)
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dp-stream-'))
  fsCalls.read.length = 0
  fsCalls.open.length = 0
  fsCalls.vanish.clear()
  fsCalls.blocksAlwaysZero = false
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('scanDirectory (R11)', () => {
  it('imports a 5 MiB note and a flagged .env file, each as a visible importable row', async () => {
    put('ai-memory/huge.md', `---\ntype: reference\n---\n${'alpha '.repeat(1024 * 1024)}`)
    put('.claude/.env', 'TOKEN=alphabravocharlie0001\n')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const huge = r.candidates.find((c) => c.relativePath === 'ai-memory/huge.md')!
    // The hash is streamed, so the secrets predicate saw the head only — the row
    // says so (A-8); the apply path recomputes it over every byte.
    expect(huge).toMatchObject({
      kind: 'memory',
      selectedByDefault: true,
      warnings: ['large-file', 'secrets-scan-head-only'],
    })
    expect(huge.bytes).toBeGreaterThan(4 * 1024 * 1024)
    expect(huge.sha256).toHaveLength(64)
    const env = r.candidates.find((c) => c.relativePath === '.claude/.env')!
    expect(env).toMatchObject({
      kind: 'knowledge',
      reasonCode: 'data-file',
      selectedByDefault: false,
      tags: ['contains-secrets'],
    })
    expect(env.target).not.toBe('none')
    expect(r.stats.largeFiles).toBe(1)
    expect(r.warnings.find((w) => w.code === 'large-files')?.params).toMatchObject({ count: 1 })
    expect(r.stats.filesSkipped).toBe(r.candidates.filter((c) => c.kind === 'noise').length)
  })

  /*
   * A-66. A cloud placeholder reports its full size with NO blocks allocated —
   * verified against a real OneDrive folder on the owner's machine, where every
   * placeholder read `size > 0, blocks: 0` while local files read
   * `blocks ≈ size / 512`. Reading one makes the provider fetch it: a scan of a
   * home directory pulled 9.7 GB that way before this existed.
   *
   * A sparse file made with `ftruncate` has exactly that shape, so the case
   * needs no cloud provider. And it discriminates: the bytes of a sparse file
   * read back as NULs, so a scanner that DID read it would call the row
   * `binary`. Reporting `not-downloaded` is proof it never looked.
   */
  it('lists a file whose bytes are not on this machine, and does not read it', async () => {
    const placeholder = join(root, 'Documents', 'held-in-the-cloud.md')
    mkdirSync(dirname(placeholder), { recursive: true })
    const fd = openSync(placeholder, 'w')
    ftruncateSync(fd, 5_000_000)
    closeSync(fd)
    // A control that IS on the machine, so this is a discrimination, not a blanket.
    put('Documents/on-this-machine.md', '---\ntype: reference\n---\n# alpha\n')

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const held = r.candidates.find((c) => c.relativePath === 'Documents/held-in-the-cloud.md')!
    expect(held, 'the placeholder must still be a visible row').toBeTruthy()
    expect(held.reasonCode).toBe('not-downloaded')
    // I-3: IMPORTABLE and unticked, the A-57 shape — never a noise row. The
    // signal is a macOS-verified proxy, and on a filesystem where a local
    // compressed file also reports no blocks an unticked row costs a click
    // while a noise row would cost the file.
    expect(held.target).not.toBe('none')
    expect(held.kind).not.toBe('noise')
    expect(held.selectedByDefault).toBe(false)
    // Everything `stat` knows is on the row; nothing that needs a read is.
    expect(held.bytes).toBe(5_000_000)
    expect(held.sha256).toBeUndefined()
    expect(held.reason).toMatch(/not downloaded/i)
    // Had it been read, the NULs would have made it `binary`.
    expect(held.reasonCode).not.toBe('binary')

    const local = r.candidates.find((c) => c.relativePath === 'Documents/on-this-machine.md')!
    expect(local).toMatchObject({ kind: 'memory', selectedByDefault: true })
    expect(local.sha256).toHaveLength(64)
  })

  /*
   * A-84. The whole placeholder mechanism keys on `st_blocks === 0` meaning "no
   * local bytes". That is verified on macOS and documented for Linux, but this
   * repo ships a Windows installer and its CI never runs one, so the premise is
   * untested on a platform we support. If some platform reported 0 for every
   * file, every non-empty file would read as a placeholder and an import there
   * would file almost nothing.
   *
   * So the scan proves the signal on itself: one file with bytes AND blocks
   * demonstrates the field is populated. Until something has, a zero-blocks file
   * is classified normally — the behaviour from before the signal existed.
   *
   * A tree of nothing but sparse files is exactly that platform's shape, which
   * is why it stands in for one here.
   */
  it('classifies normally when this platform never demonstrates that blocks are populated', async () => {
    // The platform itself reports zero blocks for everything, the executable
    // included — so neither the out-of-tree subject nor the in-tree fallback can
    // ever prove the signal, and the scan must not guess.
    fsCalls.blocksAlwaysZero = true
    for (const name of ['ai-memory/one.md', 'ai-memory/two.md', 'notes/three.md']) {
      const f = join(root, ...name.split('/'))
      mkdirSync(join(f, '..'), { recursive: true })
      const fd = openSync(f, 'w')
      ftruncateSync(fd, 2_000_000)
      closeSync(fd)
    }

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    // Not one row claims to be a placeholder…
    expect(r.candidates.filter((c) => c.reasonCode === 'not-downloaded')).toEqual([])
    // …every file is still a row, so nothing is lost either way…
    expect(r.stats.filesScanned).toBe(3)
    // …and the scan says how many it declined to guess about, so an operator can
    // see why the feature looks inactive instead of wondering.
    expect(r.stats.datalessUnverified).toBe(3)
  })

  /*
   * A-85. The calibration subject must be OUT of the scanned tree, because the
   * question is about the platform and not about the files. Calibrating from the
   * tree failed exactly where it mattered most: a scan pointed at a cloud folder
   * holds nothing but placeholders, so it never calibrated and then READ every
   * one of them — six downloads, A-66's hazard returning on the platform where
   * the signal works. And that gesture is one the docs invite in all six
   * languages, because D-9 never classifies the scan root.
   */
  it('recognises placeholders in a root that holds nothing else', async () => {
    for (const n of ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md']) {
      const f = join(root, 'notes', n)
      mkdirSync(join(f, '..'), { recursive: true })
      const fd = openSync(f, 'w')
      ftruncateSync(fd, 500_000)
      closeSync(fd)
    }

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates).toHaveLength(6)
    // Every one recognised, and not one read — reading them is the download.
    expect(r.candidates.every((c) => c.reasonCode === 'not-downloaded')).toBe(true)
    expect(r.candidates.some((c) => c.reasonCode === 'binary')).toBe(false)
    expect(r.candidates.every((c) => c.sha256 === undefined)).toBe(true)
    // Nothing was declined for want of calibration.
    expect(r.stats.datalessUnverified).toBeUndefined()
  })

  it('trusts the signal as soon as one ordinary file proves it, and not before', async () => {
    // The calibrating file comes first in listing order, so the placeholder
    // beside it is recognised.
    put('ai-memory/ordinary.md', '---\ntype: reference\n---\n# alpha\n')
    const held = join(root, 'ai-memory', 'zz-held.md')
    const fd = openSync(held, 'w')
    ftruncateSync(fd, 2_000_000)
    closeSync(fd)

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const row = r.candidates.find((c) => c.relativePath === 'ai-memory/zz-held.md')!
    expect(row.reasonCode).toBe('not-downloaded')
    // Calibrated, so nothing was left unverified.
    expect(r.stats.datalessUnverified).toBeUndefined()
    // …and the ordinary file is untouched by any of this.
    const ordinary = r.candidates.find((c) => c.relativePath === 'ai-memory/ordinary.md')!
    expect(ordinary.kind).toBe('memory')
    expect(ordinary.sha256).toHaveLength(64)
  })

  /*
   * I-4. The file-level check is not the only door: the skill-package asset
   * branch runs FIRST and reads, so a bundled placeholder was still fetched —
   * the same download, one level down. It is named on the package instead.
   */
  it('names a bundled file whose bytes are not on this machine, and never reads it', async () => {
    put('.claude/skills/deploy/SKILL.md', '---\nname: deploy\ndescription: Use when deploying\n---\n# Deploy\n')
    put('.claude/skills/deploy/scripts/run.sh', '#!/bin/sh\necho ship\n')
    const asset = join(root, '.claude', 'skills', 'deploy', 'reference.pdf')
    const fd = openSync(asset, 'w')
    ftruncateSync(fd, 3_000_000)
    closeSync(fd)

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const skill = r.candidates.find((c) => c.kind === 'skill')!
    expect(skill, 'the package must still import').toBeTruthy()

    // The placeholder is NAMED, with its size and why it was left out…
    const left = (skill.notBundled ?? []).find((f) => f.relPath === 'reference.pdf')
    expect(left, JSON.stringify(skill.notBundled)).toBeTruthy()
    expect(left!.bytes).toBe(3_000_000)
    expect(left!.reason).toMatch(/cloud/i)
    // …and it never became an asset, which is what reading it would have made it.
    expect((skill.assets ?? []).some((a) => a.relPath === 'reference.pdf')).toBe(false)
    // The local asset beside it is bundled as normal, so this is a
    // discrimination and not a blanket refusal of the package's files.
    expect((skill.assets ?? []).some((a) => a.relPath === 'scripts/run.sh')).toBe(true)

    // A-73: and it has its OWN row, importable and unticked — the same shape a
    // placeholder gets outside a package. Naming it on the document alone made
    // it unstickable here while the identical file one directory away could be
    // ticked, and made it vanish entirely on the two paths below.
    const own = r.candidates.find((c) => c.relativePath === '.claude/skills/deploy/reference.pdf')!
    expect(own, 'the bundled placeholder needs a row of its own').toBeTruthy()
    expect(own).toMatchObject({ reasonCode: 'not-downloaded', selectedByDefault: false })
    expect(own.target).not.toBe('none')
    expect(own.kind).not.toBe('noise')
    expect(own.sha256).toBeUndefined()
  })

  /*
   * A-73, the two paths where the document never becomes the skill row. Before
   * the row was emitted during the walk, `orphans()` walked `pkg.assets` — which
   * a dataless file is deliberately not in — so the file had no row anywhere and
   * was not in `filesSkipped` either. It simply disappeared, which is the one
   * outcome the import rule forbids.
   */
  /*
   * A-77. The flag has to survive the whole way from the scanner to the rendered
   * skill body. It used to travel only because the array passes by reference —
   * `buildSkillFromPackage`'s input type had dropped `notDownloaded`, so the
   * first person to `.map()` that list would have restored the wrong sentence
   * with every existing test still green. This pins the journey, not the type.
   */
  it('carries the not-downloaded flag from the scan through to the rendered skill body', async () => {
    put('.claude/skills/deploy/SKILL.md', '---\nname: deploy\ndescription: Use when deploying\n---\n# Deploy\n')
    const asset = join(root, '.claude', 'skills', 'deploy', 'reference.pdf')
    const fd = openSync(asset, 'w')
    ftruncateSync(fd, 3_000_000)
    closeSync(fd)

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const skill = r.candidates.find((c) => c.kind === 'skill')!
    const entry = (skill.notBundled ?? []).find((f) => f.relPath === 'reference.pdf')!
    expect(entry, 'the scanner must record it').toBeTruthy()
    expect(entry.notDownloaded, 'the scanner must FLAG it').toBe(true)

    // THROUGH the hop, not around it. `buildSkillFromPackage` is the step A-77
    // was raised to protect: its input type had dropped `notDownloaded`, so the
    // flag survived only because the array passes by reference. Rendering from
    // the scanner's own array would step over exactly that, and a `.map()` here
    // would go unnoticed — the property is optional, so a narrowed object stays
    // assignable and the compiler says nothing.
    const built = buildSkillFromPackage({
      relativePath: '.claude/skills/deploy/SKILL.md',
      raw: '---\nname: deploy\ndescription: Use when deploying\n---\n# Deploy\n',
      assets: [],
      notBundled: skill.notBundled ?? [],
    })
    expect(built.notBundled?.[0]?.notDownloaded, 'the flag must survive the hop').toBe(true)

    // …and the body is rendered from what the hop produced, so the sentence the
    // owner reads is the one the flag decided.
    const body = assembleSkillContent(built.content, [], null, built.notBundled ?? [])
    expect(body).toMatch(/NO local copy/i)
    expect(body).not.toMatch(/complete copy/i)
    expect(body).toContain('reference.pdf')
  })

  it('keeps a bundled placeholder visible when the package document is unreadable', async () => {
    const doc = join(root, '.claude', 'skills', 'deploy', 'SKILL.md')
    mkdirSync(join(doc, '..'), { recursive: true })
    writeFileSync(doc, '---\nname: deploy\ndescription: d\n---\n# Deploy\n')
    put('.claude/skills/deploy/scripts/run.sh', 'echo ship\n')
    const asset = join(root, '.claude', 'skills', 'deploy', 'reference.pdf')
    const fd = openSync(asset, 'w')
    ftruncateSync(fd, 3_000_000)
    closeSync(fd)
    chmodSync(doc, 0o000)

    try {
      const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
      expect(r.stats.filesScanned).toBe(3)
      const own = r.candidates.find((c) => c.relativePath.endsWith('reference.pdf'))!
      expect(own, 'no row for the placeholder when the document died').toBeTruthy()
      expect(own.reasonCode).toBe('not-downloaded')
      expect(own.target).not.toBe('none')
    } finally {
      chmodSync(doc, 0o644)
    }
  })

  it('keeps a bundled placeholder visible when the package is a duplicate of another', async () => {
    const body = '---\nname: deploy\ndescription: d\n---\n# Deploy\n'
    put('alpha/SKILL.md', body)
    put('bravo/SKILL.md', body)
    const held = join(root, 'bravo', 'held.pdf')
    const fd = openSync(held, 'w')
    ftruncateSync(fd, 1_500_000)
    closeSync(fd)
    put('alpha/notes.md', '# a\n')

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.stats.filesScanned).toBe(4)
    const own = r.candidates.find((c) => c.relativePath === 'bravo/held.pdf')!
    expect(own, 'no row for the placeholder in the duplicate package').toBeTruthy()
    expect(own.reasonCode).toBe('not-downloaded')
    expect(own.target).not.toBe('none')
  })

  it('lists a class directory as one counted row and nothing below it', async () => {
    put('alpha/node_modules/pkg/index.js')
    put('alpha/node_modules/pkg/README.md')
    put('alpha/node_modules/x.js')
    put('alpha/notes.md', '# n')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const row = r.candidates.find((c) => c.reasonCode === 'directory-skipped:node_modules')!
    expect(row).toMatchObject({
      kind: 'noise',
      target: 'none',
      selectedByDefault: false,
      bytes: 0,
      directory: { class: 'node_modules', files: 3, dirs: 1, unreadable: 0 },
    })
    expect(row.relativePath).toBe('alpha/node_modules')
    expect(r.candidates.some((c) => c.relativePath.startsWith('alpha/node_modules/'))).toBe(false)
    expect(r.stats.dirsSkipped.node_modules).toBe(1)
    expect(r.stats.filesInSkippedDirs).toBe(3)
    expect(Object.keys(r.stats.dirsSkipped).sort()).toEqual([...DIRECTORY_CLASSES].sort())
    expect(r.dirs.find((d) => d.path === 'alpha/node_modules')).toMatchObject({
      skippedClass: 'node_modules',
      fileCount: 3,
      parent: 'alpha',
    })
    expect(r.warnings.find((w) => w.code === 'directories-skipped')?.params).toMatchObject({ count: 1 })
  })

  it('never reads a binary-named file', async () => {
    put('notes/diagram.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    put('notes/alpha.md', '# alpha')
    fsCalls.read.length = 0
    fsCalls.open.length = 0
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const png = r.candidates.find((c) => c.relativePath === 'notes/diagram.png')!
    expect(png).toMatchObject({ kind: 'noise', reasonCode: 'binary', bytes: 4 })
    expect(png.sha256).toBeUndefined()
    expect(fsCalls.read.some((p) => p.endsWith('diagram.png'))).toBe(false)
    expect(fsCalls.open.some((p) => p.endsWith('diagram.png'))).toBe(false)
    // Positive control: the recorder does see the file that IS read, so the two
    // assertions above are a real negative and not a broken mock.
    expect(fsCalls.read.some((p) => p.endsWith('alpha.md'))).toBe(true)
  })

  it('lists .DS_Store as an app-state row without reading it', async () => {
    put('notes/.DS_Store', Buffer.alloc(16))
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath === 'notes/.DS_Store')).toMatchObject({
      kind: 'noise',
      reasonCode: 'app-state',
      bytes: 16,
    })
  })

  it('lists project transcripts of a home scan, selected, with sub-agent tags', async () => {
    const SID = '00000000-0000-4000-8000-00000000ab01'
    const line = (text: string): string =>
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: text },
        sessionId: SID,
        timestamp: '2026-01-02T10:00:00Z',
      })
    // Two transcripts, two bodies: byte-identical files ARE one another's
    // duplicate here, which is the point of the dedupe case below.
    put(`.claude/projects/slug/${SID}.jsonl`, `${line('ship alpha')}\n`)
    put(`.claude/projects/slug/${SID}/subagents/agent-1.jsonl`, `${line('review bravo')}\n`)
    put(`.claude/projects/slug/${SID}/tool-results/t1.txt`, 'output')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const top = r.candidates.find((c) => c.relativePath === `.claude/projects/slug/${SID}.jsonl`)!
    expect(top).toMatchObject({ kind: 'session', selectedByDefault: true, adapterId: 'claude-code', turns: 1 })
    expect(top.tags).toContain('claude-project:slug')
    const sub = r.candidates.find((c) => c.relativePath.endsWith('subagents/agent-1.jsonl'))!
    expect(sub.tags).toEqual(expect.arrayContaining(['subagent', `parent-session:${SID}`]))
    expect(r.candidates.find((c) => c.relativePath.endsWith('tool-results/t1.txt'))).toMatchObject({
      kind: 'session',
      reasonCode: 'session-artifact',
      selectedByDefault: false,
    })
    expect(r.warnings.some((w) => /transcript/i.test(w.message))).toBe(false)
    expect(top.content).toBeUndefined()
  })

  it('bundles an oversized and a flagged skill asset instead of dropping them', async () => {
    put('.claude/skills/deploy/SKILL.md', '---\nname: deploy\n---\n# Deploy\n')
    put('.claude/skills/deploy/references/dump.md', 'a'.repeat(5 * 1024 * 1024))
    put('.claude/skills/deploy/.env', 'OPENAI_API_KEY=sk-alpha_bravo-charlie0123456789\n')
    put('.claude/skills/deploy/scripts/fetch.py', 'password = keychain_lookup("alpha-db")\n')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'claude-code' })
    const skill = r.candidates.find((c) => c.kind === 'skill')!
    expect(skill.notBundled).toBeUndefined()
    expect(skill.assets!.map((a) => a.relPath)).toEqual(['.env', 'references/dump.md', 'scripts/fetch.py'])
    expect(skill.assets!.find((a) => a.relPath === '.env')!.containsSecrets).toBe(true)
    expect(skill.assets!.find((a) => a.relPath === 'scripts/fetch.py')!.containsSecrets).toBeUndefined()
    expect(skill.tags).toContain('contains-secrets')
    expect(skill.reason).toContain('(+3 bundled files)')
    expect(r.candidates.some((c) => c.relativePath.endsWith('references/dump.md'))).toBe(false)
  })

  it('bundles assets whatever order the listing gives them (assets created before the document)', async () => {
    put('.claude/skills/deploy/.env', 'TOKEN=alphabravocharlie0001\n')
    put('.claude/skills/deploy/README.md', '# readme')
    put('.claude/skills/deploy/SKILL.md', '---\nname: deploy\n---\n# Deploy\n')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'claude-code' })
    const skill = r.candidates.find((c) => c.kind === 'skill')!
    expect(skill.assets!.map((a) => a.relPath)).toEqual(['.env', 'README.md'])
    expect(r.candidates.filter((c) => c.relativePath.startsWith('.claude/skills/deploy/'))).toHaveLength(1)
  })

  it('strands the package of a duplicate SKILL.md as orphan rows that say why', async () => {
    put('.claude/skills/alpha/SKILL.md', '# same\n')
    put('.claude/skills/alpha/run.sh', 'echo a\n')
    put('.claude/skills/bravo/SKILL.md', '# same\n')
    put('.claude/skills/bravo/run.sh', 'echo a\n')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'claude-code' })
    const skills = r.candidates.filter((c) => c.kind === 'skill')
    expect(skills).toHaveLength(1)
    expect([...skills[0]!.paths!].sort()).toEqual([
      '.claude/skills/alpha/SKILL.md',
      '.claude/skills/bravo/SKILL.md',
    ])
    const dup = r.candidates.find((c) => c.reasonCode === 'duplicate-content')!
    expect(dup.relativePath).not.toBe(skills[0]!.relativePath)
    const orphan = r.candidates.find((c) => c.reasonCode === 'orphan-asset')!
    expect(orphan.relativePath).toBe(`${dup.relativePath.replace(/SKILL\.md$/, '')}run.sh`)
    expect(orphan.reason).toMatch(/Duplicate content of/)
    expect(r.stats.filesSkipped).toBe(2)
  })

  it('emits duplicates and alias paths as events, never by mutating a row it already yielded', async () => {
    put('a/x.md', '# same body\n')
    put('b/x.md', '# same body\n')
    put('real/n.md', '# n')
    symlinkSync(join(root, 'real'), join(root, 'link'))
    // Listing order is the filesystem's: whichever of a/b (or real/link) is
    // reached first is the kept row; assert order-agnostically.
    const events = [...scanDirectoryEvents({ rootPath: root, sourceProfile: 'auto' })]
    const xs = events.filter(
      (e) => e.type === 'candidate' && /^(a|b)\/x\.md$/.test(e.candidate.relativePath),
    ) as Array<Extract<(typeof events)[number], { type: 'candidate' }>>
    const kept = xs.find((e) => e.candidate.kind !== 'noise')!
    const dup = xs.find((e) => e.candidate.kind === 'noise')!
    expect(dup.candidate).toMatchObject({ reasonCode: 'duplicate-content' })
    expect(events.find((e) => e.type === 'candidate-patch')).toMatchObject({
      id: kept.candidate.id,
      addPath: dup.candidate.relativePath,
    })
    expect(kept.candidate.paths).toBeUndefined() // the yielded object was not touched afterwards
    const aliasAt = events.findIndex((e) => e.type === 'dir-alias')
    const doneAt = events.findIndex((e) => e.type === 'done')
    const alias = events[aliasAt] as Extract<(typeof events)[number], { type: 'dir-alias' }>
    expect([alias.realRel, alias.aliasRel].sort()).toEqual(['link', 'real'])
    expect(aliasAt).toBeLessThan(doneAt)
    expect(
      events.filter((e) => e.type === 'candidate' && e.candidate.relativePath.endsWith('n.md')),
    ).toHaveLength(1)
    // The collector applies both.
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(
      r.candidates.find((c) => /x\.md$/.test(c.relativePath) && c.kind !== 'noise')!.paths!.sort(),
    ).toEqual(['a/x.md', 'b/x.md'])
    expect(r.candidates.find((c) => c.relativePath.endsWith('n.md'))!.paths!.sort()).toEqual([
      'link/n.md',
      'real/n.md',
    ])
  })

  it('flags only the unit that holds a key inside a container', async () => {
    put(
      'chat/conversations.json',
      JSON.stringify([
        { uuid: 'u1', name: 'alpha', chat_messages: [{ sender: 'human', text: 'hi' }] },
        {
          uuid: 'u2',
          name: 'bravo',
          chat_messages: [{ sender: 'human', text: 'API_KEY=alphabravo0123456789' }],
        },
      ]),
    )
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'chat-export' })
    const units = r.candidates.filter((c) => c.relativePath === 'chat/conversations.json')
    expect(units.map((u) => u.tags?.includes('contains-secrets') ?? false)).toEqual([false, true])
  })

  it('keeps the units of one container contiguous in emission order', async () => {
    put(
      'chat/conversations.json',
      JSON.stringify(
        Array.from({ length: 5 }, (_, i) => ({
          uuid: `u${i}`,
          name: `alpha ${i}`,
          chat_messages: [{ sender: 'human', text: 'x' }],
        })),
      ),
    )
    put('notes/a.md', '# a')
    put('notes/z.md', '# z')
    const seqs: number[] = []
    let i = 0
    for (const ev of scanDirectoryEvents({ rootPath: root, sourceProfile: 'chat-export' })) {
      if (ev.type === 'candidate') {
        if (ev.candidate.relativePath === 'chat/conversations.json') seqs.push(i)
        i++
      }
    }
    expect(seqs).toEqual(Array.from({ length: 5 }, (_, k) => seqs[0]! + k))
  })

  it('yields to the event loop and reports progress on a large tree', async () => {
    for (let i = 0; i < 1200; i++) put(`notes/n${i}.md`, `# ${i}`)
    const progress: number[] = []
    const dirs: number[] = []
    const r = await scanDirectory({
      rootPath: root,
      sourceProfile: 'auto',
      onProgress: (p) => {
        progress.push(p.files)
        dirs.push(p.dirs)
      },
    })
    expect(progress.length).toBeGreaterThanOrEqual(2)
    expect(progress).toEqual([...progress].sort((a, b) => a - b))
    expect(progress.at(-1)).toBeGreaterThanOrEqual(1000)
    expect(Math.max(...dirs)).toBeGreaterThanOrEqual(1) // real walker counters, never zeros
    expect(r.candidates).toHaveLength(1200)
    expect(r.stats.scanMs).toBeGreaterThanOrEqual(0)
    expect(r.stats.dirsVisited).toBe(2)
  })

  it('maps a home-shaped root completely and warns about the classes, not the size', async () => {
    for (let i = 0; i < 80; i++) put(`GitHub/alpha/pkg-${i}/note.md`, `# ${i}`)
    put('GitHub/alpha/.git/HEAD', 'ref: x')
    put('GitHub/alpha/node_modules/m/index.js')
    put('Library/Caches/x', 'c')
    // Distinct bodies: three `{}` files would be one another's content duplicate.
    put('Library/Application Support/alpha/state.json', '{"window":1}')
    put('.grok/relocations/r1.json', '{"moved":"alpha"}')
    put('Documents/Vault/.obsidian/app.json', '{"theme":"dark"}')
    put('Documents/Vault/projects/alpha.md', '# alpha')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.filter((c) => /GitHub\/alpha\/pkg-\d+\/note\.md/.test(c.relativePath))).toHaveLength(80)
    expect(
      r.candidates
        .filter((c) => c.reasonCode.startsWith('directory-skipped:'))
        .map((c) => c.directory!.class)
        .sort(),
    ).toEqual(['node_modules', 'os-cache', 'vcs'])
    expect(r.candidates.find((c) => c.relativePath === '.grok/relocations/r1.json')).toMatchObject({
      kind: 'knowledge',
      reasonCode: 'config',
      selectedByDefault: false,
    })
    expect(r.candidates.find((c) => c.relativePath === 'Documents/Vault/projects/alpha.md')).toMatchObject({
      kind: 'memory',
      selectedByDefault: true,
    })
    // Obsidian state is text: visible, importable, unticked (D-8) — never hidden as app-state.
    expect(r.candidates.find((c) => c.relativePath === 'Documents/Vault/.obsidian/app.json')).toMatchObject({
      kind: 'knowledge',
      reasonCode: 'config',
      selectedByDefault: false,
    })
    expect(
      r.candidates.find((c) => c.relativePath === 'Documents/Vault/.obsidian/app.json')!.target,
    ).not.toBe('none')
    expect(r.warnings.map((w) => w.code)).toContain('directories-skipped')
    expect(r.warnings.map((w) => w.code)).not.toContain('home-root-mapped')
    expect(
      r.warnings.every((w) => typeof w.message === 'string' && !/smaller folder|scan cap/i.test(w.message)),
    ).toBe(true)
  })
})

/**
 * A file the walker can `lstat` but the process cannot open must be a row with
 * its reason, never an exception that ends the walk. R11.2: every skip is a row.
 */
describe('scanDirectory unreadable entries (C1)', () => {
  it.skipIf(!canDenyRead)('lists a file it cannot open and keeps scanning', async () => {
    put('alpha/locked.txt', 'fifteen bytes..')
    put('alpha/zulu.md', '# zulu')
    put('bravo/charlie.md', '# charlie')
    chmodSync(join(root, 'alpha/locked.txt'), 0o000)

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const locked = r.candidates.find((c) => c.relativePath === 'alpha/locked.txt')!
    expect(locked).toMatchObject({ kind: 'noise', target: 'none', reasonCode: 'unreadable', bytes: 15 })
    expect(locked.reason).toMatch(/EACCES|EPERM/)
    // The walk carried on: every other file still has its row.
    expect(r.candidates.find((c) => c.relativePath === 'alpha/zulu.md')?.kind).toBe('memory')
    expect(r.candidates.find((c) => c.relativePath === 'bravo/charlie.md')?.kind).toBe('memory')
  })

  it.skipIf(!canDenyRead)('lists a large file it cannot open on the streaming path', async () => {
    put('alpha/big.md', 'a'.repeat(5 * 1024 * 1024))
    put('alpha/zulu.md', '# zulu')
    chmodSync(join(root, 'alpha/big.md'), 0o000)

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath === 'alpha/big.md')).toMatchObject({
      kind: 'noise',
      reasonCode: 'unreadable',
      bytes: 5 * 1024 * 1024,
    })
    expect(r.candidates.find((c) => c.relativePath === 'alpha/zulu.md')?.kind).toBe('memory')
    // Nothing was counted for a file whose bytes were never read.
    expect(r.stats.largeFiles).toBe(0)
  })

  it('lists a file that disappears between the listing and the read', async () => {
    put('alpha/gone.md', '# gone')
    put('alpha/zulu.md', '# zulu')
    fsCalls.vanish.add(join(root, 'alpha/gone.md'))

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const gone = r.candidates.find((c) => c.relativePath === 'alpha/gone.md')!
    expect(gone).toMatchObject({ kind: 'noise', reasonCode: 'unreadable' })
    expect(gone.reason).toMatch(/ENOENT/)
    expect(r.candidates.find((c) => c.relativePath === 'alpha/zulu.md')?.kind).toBe('memory')
  })

  it.skipIf(!canDenyRead)('lists a directory it cannot enter and keeps scanning', async () => {
    put('alpha/shut/inside.md', '# inside')
    put('bravo/charlie.md', '# charlie')
    chmodSync(join(root, 'alpha/shut'), 0o000)
    try {
      const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
      expect(r.candidates.find((c) => c.relativePath === 'alpha/shut')).toMatchObject({
        kind: 'noise',
        reasonCode: 'unreadable',
      })
      expect(r.candidates.find((c) => c.relativePath === 'bravo/charlie.md')?.kind).toBe('memory')
      expect(r.stats.unreadable).toBeGreaterThanOrEqual(1)
    } finally {
      chmodSync(join(root, 'alpha/shut'), 0o755)
    }
  })

  it.skipIf(!canDenyRead)('lists a root it cannot even list, instead of throwing an errno', async () => {
    put('alpha/inside.md', '# inside')
    chmodSync(root, 0o000)
    try {
      const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
      expect(r.candidates.find((c) => c.relativePath === '.')).toMatchObject({
        kind: 'noise',
        reasonCode: 'unreadable',
      })
    } finally {
      chmodSync(root, 0o755)
    }
  })

  it.skipIf(!canDenyRead)('lists a symlink to an unreadable file once, with both its paths', async () => {
    put('alpha/locked.txt', 'fifteen bytes..')
    symlinkSync(join(root, 'alpha/locked.txt'), join(root, 'alpha/link.txt'))
    chmodSync(join(root, 'alpha/locked.txt'), 0o000)

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const rows = r.candidates.filter((c) => /alpha\/(locked|link)\.txt$/.test(c.relativePath))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'noise', reasonCode: 'unreadable' })
    expect(rows[0]!.paths?.slice().sort()).toEqual(['alpha/link.txt', 'alpha/locked.txt'])
  })

  it.skipIf(!canDenyRead)('strands the assets of a package whose document it cannot read', async () => {
    put('.claude/skills/deploy/SKILL.md', '---\nname: deploy\n---\n# Deploy\n')
    put('.claude/skills/deploy/run.sh', 'echo a\n')
    chmodSync(join(root, '.claude/skills/deploy/SKILL.md'), 0o000)

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'claude-code' })
    expect(r.candidates.some((c) => c.kind === 'skill')).toBe(false)
    expect(r.candidates.find((c) => c.relativePath.endsWith('SKILL.md'))).toMatchObject({
      reasonCode: 'unreadable',
    })
    const orphan = r.candidates.find((c) => c.reasonCode === 'orphan-asset')!
    expect(orphan.relativePath).toBe('.claude/skills/deploy/run.sh')
    expect(orphan.reason).toMatch(/Unreadable/)
  })
})

/**
 * P-18's buffering claim, measured. Sibling packages must not all be open at
 * once: the walker finishes an open package's subtree before it moves sideways,
 * so what the generator holds is bounded by package NESTING DEPTH (I1).
 */
describe('scanDirectory skill-package buffer (I1)', () => {
  it('holds one package at a time however many are siblings', async () => {
    const PACKAGES = 120
    for (let i = 0; i < PACKAGES; i++) {
      put(`skills/pkg-${i}/SKILL.md`, `---\nname: p${i}\n---\n# Package ${i}\n`)
      for (let a = 0; a < 3; a++) put(`skills/pkg-${i}/refs/a${a}.md`, `# asset ${i}-${a}\n`)
      put(`skills/pkg-${i}/refs/deep/d.md`, `# deep ${i}\n`)
    }
    let opened = 0
    let closed = 0
    let maxOpen = 0
    let firstRowAt = -1
    let events = 0
    for (const ev of scanDirectoryEvents({ rootPath: root, sourceProfile: 'claude-code' })) {
      if (ev.type === 'dir' && /pkg-\d+$/.test(ev.row.path)) opened++
      if (ev.type === 'candidate') {
        if (ev.candidate.kind === 'skill') closed++
        if (firstRowAt < 0) firstRowAt = events
      }
      maxOpen = Math.max(maxOpen, opened - closed)
      events++
    }
    expect(closed).toBe(PACKAGES)
    // The budget. Breadth-first sibling walking made this equal to PACKAGES.
    expect(maxOpen).toBeLessThanOrEqual(2)
    expect(firstRowAt).toBeLessThanOrEqual(8)
  })
})

/**
 * A symlink into a package, reached before the package itself, must not strip
 * the file out of it: membership follows the real path (I2). Depth decides the
 * order under a breadth-first walk, so both orders are exercised deterministically.
 */
describe('scanDirectory a symlink into a skill package (I2)', () => {
  const seedPackage = (): void => {
    put('.claude/skills/delta/SKILL.md', '---\nname: delta\n---\n# Delta\n')
    put('.claude/skills/delta/refs/shared.md', '# shared reference\n')
  }
  /**
   * What apply does with a package: `resolve(dirname(sourcePath), asset.relPath)`
   * (`service.ts`). The descriptors are relative to the REAL package directory,
   * so `sourcePath` has to name it too or every bundled file misses and the
   * skill imports with none of the files the wizard promised (N1).
   */
  const assetsResolve = (skill: { sourcePath?: string; assets?: Array<{ relPath: string }> }): string[] =>
    (skill.assets ?? [])
      .map((a) => resolve(dirname(skill.sourcePath!), a.relPath))
      .filter((at) => !existsSync(at))

  it('keeps the package when the alias is reached first (shallower)', async () => {
    seedPackage()
    symlinkSync(join(root, '.claude/skills/delta/SKILL.md'), join(root, 'delta-skill.md'))
    symlinkSync(join(root, '.claude/skills/delta/refs/shared.md'), join(root, 'shared.md'))

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'claude-code' })
    const skill = r.candidates.find((c) => c.kind === 'skill')!
    expect(skill).toBeTruthy()
    expect(skill.assets?.map((a) => a.relPath)).toEqual(['refs/shared.md'])
    expect(skill.paths?.slice().sort()).toEqual(['.claude/skills/delta/SKILL.md', 'delta-skill.md'])
    // The asset rides on the package; it is never a note of its own.
    expect(r.candidates.some((c) => c.relativePath.endsWith('shared.md') && c.kind === 'memory')).toBe(false)
    expect(assetsResolve(skill)).toEqual([])
  })

  it('keeps the package when the package is reached first (alias deeper)', async () => {
    seedPackage()
    mkdirSync(join(root, 'a/b/c/d'), { recursive: true })
    symlinkSync(join(root, '.claude/skills/delta/SKILL.md'), join(root, 'a/b/c/d/delta-skill.md'))
    symlinkSync(join(root, '.claude/skills/delta/refs/shared.md'), join(root, 'a/b/c/d/shared.md'))

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'claude-code' })
    const skill = r.candidates.find((c) => c.kind === 'skill')!
    expect(skill.relativePath).toBe('.claude/skills/delta/SKILL.md')
    expect(skill.assets?.map((a) => a.relPath)).toEqual(['refs/shared.md'])
    expect(skill.paths?.slice().sort()).toEqual([
      '.claude/skills/delta/SKILL.md',
      'a/b/c/d/delta-skill.md',
    ])
    expect(assetsResolve(skill)).toEqual([])
  })
})

describe('scanDirectory duplicate transcripts (M8)', () => {
  it('lists a byte-identical second transcript as a duplicate carrying its unit', async () => {
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: 'ship alpha' } })
    put('.claude/projects/slug/aaa.jsonl', `${line}\n`)
    put('.claude/projects/slug/subagents-copy.jsonl', `${line}\n`)
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'claude-code' })
    const sessions = r.candidates.filter((c) => c.kind === 'session')
    expect(sessions).toHaveLength(1)
    const dup = r.candidates.find((c) => c.reasonCode === 'duplicate-content')!
    expect(dup.unit).toBe('transcript')
    expect(sessions[0]!.paths?.slice().sort()).toEqual([
      '.claude/projects/slug/aaa.jsonl',
      '.claude/projects/slug/subagents-copy.jsonl',
    ])
  })
})

describe('scanDirectory an alias of a duplicated file (M1)', () => {
  it('gives the alias path to the survivor, not to the row that lost', async () => {
    put('ai-memory/keeper.md', '# the very same fact\n')
    put('zzz/loser.md', '# the very same fact\n')
    symlinkSync(join(root, 'zzz/loser.md'), join(root, 'zzz/loser-link.md'))

    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const kept = r.candidates.find((c) => c.kind !== 'noise' && c.relativePath.endsWith('.md'))!
    expect(kept.relativePath).toBe('ai-memory/keeper.md')
    expect(kept.paths?.slice().sort()).toEqual(['ai-memory/keeper.md', 'zzz/loser-link.md', 'zzz/loser.md'])
    expect(r.candidates.find((c) => c.reasonCode === 'duplicate-content')?.paths).toBeUndefined()
  })
})

/**
 * `auto` has to name the provider from the root itself, before a single file is
 * classified. Every marker is a path SEGMENT, so a probe of bare listing names
 * detects nothing and the whole tree goes through the generic adapter (A-43).
 */
describe('scanDirectory profile detection under auto (A-43)', () => {
  const detect = async (): Promise<string> =>
    (await scanDirectory({ rootPath: root, sourceProfile: 'auto' })).detectedProfile

  it('names Claude Code from a .claude tree', async () => {
    put('.claude/projects/slug/memory/n.md', '---\ntype: user\n---\nme\n')
    put('.claude/skills/deploy/SKILL.md', '---\nname: deploy\n---\n# Deploy\n')
    expect(await detect()).toBe('claude-code')
  })

  it('names Grok CLI from a .grok tree', async () => {
    put('.grok/memory/alpha/feedback_alpha.md', '---\ntype: feedback\n---\nShort answers.\n')
    expect(await detect()).toBe('grok-cli')
  })

  it('names Cursor from a .cursor tree', async () => {
    put('.cursor/rules/alpha.mdc', '---\nglobs: src/**/*.ts\n---\nUse strict mode.\n')
    expect(await detect()).toBe('cursor')
  })

  it('names Codex from a .codex tree', async () => {
    put('.codex/AGENTS.md', '# Codex instructions\nAlways write tests.\n')
    put('.codex/prompts/review.md', '# Review\nCheck the diff.\n')
    expect(await detect()).toBe('codex')
  })

  it('names Obsidian from a vault', async () => {
    put('.obsidian/app.json', '{"theme":"dark"}')
    put('notes/alpha.md', '# alpha')
    expect(await detect()).toBe('obsidian')
  })

  it('falls back to generic markdown for a plain folder of notes', async () => {
    put('notes/alpha.md', '# alpha')
    put('notes/bravo.md', '# bravo')
    expect(await detect()).toBe('generic-md')
  })
})
