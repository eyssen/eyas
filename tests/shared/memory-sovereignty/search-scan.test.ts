// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K1/K2 — the bounded scan below a searched (or saved) folder. Two things
// are pinned here:
//   - its cost: one walk per folder for SEARCH_SCAN_TTL_MS, whatever the
//     search's globs are (a new glob never walks the folder again);
//   - its bound: places EYAS knows by name are found at any depth and behind
//     any number of folders; a place known only by its shape (a `.obsidian`
//     marker) is found only within the first 2,000 folders and 8 levels.
// Throw-away folders only; node:fs is passed through with a readdir counter.

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fsCalls = vi.hoisted(() => ({ readdir: 0 }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const readdirSync = ((...args: unknown[]) => {
    fsCalls.readdir++
    return (actual.readdirSync as (...a: unknown[]) => unknown)(...args)
  }) as typeof actual.readdirSync
  return { ...actual, readdirSync, default: { ...actual, readdirSync } }
})

const { createPathPolicy, workAreaRootsOf } = await import('@shared/memory-sovereignty/path-policy.js')
const { validateWorkingDirectories } = await import('@modules/tools/working-directories.js')
type PathPolicyOptions = import('@shared/memory-sovereignty/path-policy.js').PathPolicyOptions

let root: string
let home: string
let dataDir: string
let workspacesRoot: string

function mk(...parts: string[]): string {
  const dir = join(...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

function policy(overrides: Partial<PathPolicyOptions> = {}) {
  const ws = overrides.workspacesRoot ?? workspacesRoot
  const data = overrides.dataDir ?? dataDir
  return createPathPolicy({
    homeDir: home,
    env: {},
    dataDir: data,
    workspacesRoot: ws,
    workAreaRoots: workAreaRootsOf({ dataDir: data, workspacesDir: ws }),
    providerHomes: [join(data, 'cli-homes')],
    obsidianRegistryPaths: [],
    ...overrides,
  })
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'eyas-search-scan-'))
  home = mk(root, 'home')
  dataDir = mk(root, 'instance', 'data')
  workspacesRoot = mk(dataDir, 'workspaces')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the scan below a searched folder: one walk per folder, whatever the globs (K1)', () => {
  let project: string

  beforeAll(() => {
    project = mk(root, 'project')
    for (const dir of ['src/lib', 'src/ui', 'docs/guide', 'tests/unit']) mk(project, dir)
    writeFileSync(join(project, 'src', 'lib', 'a.ts'), 'export const a = 1\n')
    writeFileSync(join(project, 'README.md'), '# project\n')
  })

  it('(+) a second search of the same folder with another glob or tool reads no folder again', () => {
    const p = policy()
    const ctx = { workingDirectories: [project] }
    const before = fsCalls.readdir
    expect(p.evaluateToolInput('Grep', { pattern: 'x' }, ctx)).toBeNull()
    const walked = fsCalls.readdir - before
    expect(walked).toBeGreaterThan(0)
    expect(p.evaluateToolInput('Grep', { pattern: 'x', glob: '*.md' }, ctx)).toBeNull()
    expect(p.evaluateToolInput('Glob', { pattern: '**/*.ts' }, ctx)).toBeNull()
    expect(p.evaluateToolInput('Grep', { pattern: 'y', path: project, glob: 'src/**/*.ts' }, ctx)).toBeNull()
    expect(p.evaluateToolInput('Bash', { command: 'rg foo' }, ctx)).toBeNull()
    expect(p.evaluateToolInput('Bash', { command: 'grep -rn foo . --include=*.py' }, ctx)).toBeNull()
    expect(fsCalls.readdir - before).toBe(walked)
  })

  it('(−) a cached walk is not reused past its time, nor for another folder', () => {
    const p = policy()
    const ctx = { workingDirectories: [project] }
    const start = Date.now()
    const now = vi.spyOn(Date, 'now').mockReturnValue(start)
    p.evaluateToolInput('Grep', { pattern: 'x' }, ctx)
    let before = fsCalls.readdir
    p.evaluateToolInput('Grep', { pattern: 'x', path: join(project, 'src') }, ctx)
    expect(fsCalls.readdir).toBeGreaterThan(before)
    before = fsCalls.readdir
    now.mockReturnValue(start + 60_000)
    p.evaluateToolInput('Grep', { pattern: 'x', glob: '*.md' }, ctx)
    expect(fsCalls.readdir).toBeGreaterThan(before)
  })

  it('(+) a protected place found by the walk is still judged per glob from the cached walk', () => {
    const withVault = mk(root, 'with-vault')
    mk(withVault, 'code', 'src')
    mk(withVault, 'Notes', '.obsidian')
    const p = policy()
    const ctx = { workingDirectories: [project] }
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: withVault, glob: 'code/**' }, ctx)).toBeNull()
    const before = fsCalls.readdir
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: withVault, glob: '*.md' }, ctx))
      .toMatchObject({ kind: 'foreign-memory', rule: 'obsidian-vault', path: join(withVault, 'Notes'), searchRoot: withVault })
    expect(p.evaluateToolInput('Glob', { pattern: 'N*/**', path: withVault }, ctx)).toMatchObject({ searchRoot: withVault })
    expect(fsCalls.readdir).toBe(before)
  })
})

describe('the bound of the scan (K1/K2)', () => {
  // 2,100 sibling folders and a chain 12 levels deep: beyond both bounds of
  // the scan (2,000 folders, 8 levels).
  let wide: string
  let deep: string

  beforeAll(() => {
    wide = mk(root, 'wide')
    for (let k = 0; k < 2_100; k++) mkdirSync(join(wide, `d${String(k).padStart(4, '0')}`))
    deep = mk(wide, 'zz', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10', 'l11')
  })

  const refusedWhere = (p: ReturnType<typeof policy>, folder: string) => {
    const r = validateWorkingDirectories([folder], { policy: p, homeDir: home, eyasHome: join(root, 'eyas-home-elsewhere') })
    return r.ok ? { code: 'ok', found: null } : { code: r.code, found: r.found ?? null }
  }

  it('(+) places known by name are found at any depth, behind any number of folders: a registered vault, the data dir, a CLI home, a foreignMemoryPaths entry', () => {
    const vault = mk(deep, 'Registered Vault')
    const registry = join(root, 'obsidian.json')
    writeFileSync(registry, JSON.stringify({ vaults: { v: { path: vault } } }))
    const deepData = mk(deep, 'eyas-data')
    const cliHomes = mk(deep, 'cli-homes')
    const owner = mk(deep, 'owner-notes')

    const cases: Array<{ p: ReturnType<typeof policy>; place: string; kind: string; code: string }> = [
      { p: policy({ obsidianRegistryPaths: [registry] }), place: vault, kind: 'foreign-memory', code: 'containsVault' },
      { p: policy({ dataDir: deepData, workspacesRoot: join(deepData, 'workspaces') }), place: deepData, kind: 'eyas-data', code: 'containsEyasData' },
      { p: policy({ providerHomes: [cliHomes] }), place: cliHomes, kind: 'provider-home', code: 'containsProviderHome' },
      { p: policy({ extraForeignPaths: [owner] }), place: owner, kind: 'foreign-memory', code: 'containsVault' },
    ]
    for (const { p, place, kind, code } of cases) {
      const ctx = { workingDirectories: [join(root, 'project')] }
      expect(p.evaluateToolInput('Grep', { pattern: 'x', path: wide }, ctx), place).toMatchObject({ kind, path: place, searchRoot: wide })
      expect(p.evaluateToolInput('Glob', { pattern: '**/*.md', path: wide }, ctx), place).toMatchObject({ kind, searchRoot: wide })
      expect(p.evaluateToolInput('Bash', { command: `grep -r token ${wide}` }, ctx), place).toMatchObject({ kind, field: 'command' })
      expect(p.protectedWithin(wide), place).toMatchObject({ kind, path: place, searchRoot: wide })
      expect(refusedWhere(p, wide), place).toEqual({ code, found: place })
    }
  })

  it('(+) a vault known only by its .obsidian marker is found up to 8 levels down', () => {
    const shallow = mk(root, 'marker-8')
    const vault = mk(shallow, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'Vault')
    mk(vault, '.obsidian')
    const p = policy()
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: shallow }, { workingDirectories: [join(root, 'project')] }))
      .toMatchObject({ kind: 'foreign-memory', rule: 'obsidian-vault', path: vault, searchRoot: shallow })
    expect(refusedWhere(p, shallow)).toEqual({ code: 'containsVault', found: vault })
  })

  it('(documented residual) a vault known only by its .obsidian marker, 9 levels down, is not found by the scan', () => {
    // The handbook states this bound (admin/security-privacy.md: "Beyond that
    // bound only the named places are checked"; daily/conversations.md: "8
    // levels deep, at most 2,000 folders"). A deliberate change to
    // SEARCH_SCAN_MAX_DEPTH / SEARCH_SCAN_MAX_DIRS changes this case — update
    // the handbook in all six languages with it. A read INTO such a vault is
    // still refused path by path (its marker is found from the path itself).
    const shallow = mk(root, 'marker-9')
    const vault = mk(shallow, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'Vault')
    mk(vault, '.obsidian')
    writeFileSync(join(vault, 'note.md'), 'secret\n')
    const p = policy()
    const ctx = { workingDirectories: [join(root, 'project')] }
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: shallow }, ctx)).toBeNull()
    expect(p.protectedWithin(shallow)).toBeNull()
    expect(refusedWhere(p, shallow)).toEqual({ code: 'ok', found: null })
    expect(p.evaluateToolInput('Read', { file_path: join(vault, 'note.md') }, ctx)).toMatchObject({ kind: 'foreign-memory', rule: 'obsidian-vault' })
  })
})
